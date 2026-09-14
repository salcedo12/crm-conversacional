import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { env } from '../../config/env';

export type ChannelProvider = 'ycloud' | 'dapta' | 'twilio' | 'messenger' | 'instagram' | 'meta';

export interface ChannelRoute {
  id: string;
  provider: ChannelProvider;
  identifier: string;
  companyId: string;
  label?: string;
  active: boolean;
  /**
   * Tipo de línea. `main` (o ausente) = línea principal del negocio (317).
   * `advisor_coexistence` = número personal de un asesor conectado por
   * COEXISTENCIA de YCloud (WhatsApp Business App + Cloud API en el mismo
   * número). Los leads que entran DIRECTO a esa línea se marcan como
   * `advisor_whatsapp`, se asignan solo a ese asesor y quedan fuera de las
   * estadísticas y del reparto. Ver [[ycloudWebhook]] y [[leadClassification]].
   */
  kind?: 'main' | 'advisor_coexistence';
  /** uid del asesor dueño de la línea (solo cuando kind === 'advisor_coexistence'). */
  advisorId?: string;
  /**
   * WABA al que pertenece este número. La coexistencia suele quedar en un WABA
   * DISTINTO al del 317, y las plantillas son POR WABA — se usa para sincronizar
   * y listar las plantillas de la línea del asesor. Ver [[templates]].
   */
  wabaId?: string;
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

function normalizePhoneIdentifier(value: string): string {
  return value.replace(/[^\d]/g, '');
}

export function normalizeChannelIdentifier(provider: ChannelProvider, value: string): string {
  const raw = value.trim();
  if (provider === 'ycloud' || provider === 'twilio') return normalizePhoneIdentifier(raw);
  return raw.toLowerCase();
}

export function channelRouteId(provider: ChannelProvider, identifier: string): string {
  const normalized = normalizeChannelIdentifier(provider, identifier);
  return `${provider}_${normalized.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export async function resolveCompanyIdForChannel(
  provider: ChannelProvider,
  identifier?: string | null
): Promise<string> {
  if (!identifier) return env.defaultCompanyId();

  const route = await getChannelRoute(provider, identifier);
  if (!route || route.active === false || !route.companyId) return env.defaultCompanyId();

  return route.companyId;
}

// Caché en memoria por instancia. Las rutas cambian rara vez y el webhook las
// consulta en CADA mensaje entrante y CADA envío (para elegir el número `from`);
// sin caché serían dos lecturas de Firestore por mensaje. Se limpia al guardar.
// `null` cachea también "no existe" para no re-leer rutas ausentes (p. ej. la 317,
// cuyo inbox coincide con el número por defecto y no tiene ruta de asesor).
const routeCache = new Map<string, ChannelRoute | null>();

/** Lee una ruta de canal (con caché). Devuelve null si no existe. */
export async function getChannelRoute(
  provider: ChannelProvider,
  identifier: string
): Promise<ChannelRoute | null> {
  const normalized = normalizeChannelIdentifier(provider, identifier);
  if (!normalized) return null;
  const id = channelRouteId(provider, normalized);

  if (routeCache.has(id)) return routeCache.get(id) ?? null;

  const snap = await db.collection('channelRoutes').doc(id).get();
  const route = snap.exists ? ({ id, ...snap.data() } as ChannelRoute) : null;
  routeCache.set(id, route);
  return route;
}

/**
 * Si el número es una LÍNEA DE ASESOR en coexistencia, devuelve la empresa y el
 * asesor dueño; si no, null. Lo usa el webhook para marcar el lead como
 * `advisor_whatsapp` y asignárselo solo a ese asesor (sin reparto).
 */
export async function getAdvisorLine(
  provider: ChannelProvider,
  identifier?: string | null
): Promise<{ companyId: string; advisorId: string } | null> {
  if (!identifier) return null;
  const route = await getChannelRoute(provider, identifier);
  if (!route || route.active === false) return null;
  if (route.kind !== 'advisor_coexistence' || !route.advisorId || !route.companyId) return null;
  return { companyId: route.companyId, advisorId: route.advisorId };
}

export function clearChannelRouteCache(): void {
  routeCache.clear();
  allRoutesCache = null;
}

// Caché de la lista completa (la colección es diminuta: un puñado de números).
let allRoutesCache: ChannelRoute[] | null = null;
async function getAllRoutes(): Promise<ChannelRoute[]> {
  if (allRoutesCache) return allRoutesCache;
  allRoutesCache = await listChannelRoutes();
  return allRoutesCache;
}

/**
 * Línea de coexistencia registrada a nombre de un asesor concreto. La usa el
 * envío manual: cuando el asesor elige "Mi WhatsApp", el mensaje sale por SU
 * número vía YCloud (ya no por Baileys). Devuelve el número (+E.164) y su WABA.
 */
export async function getAdvisorLineForAdvisor(
  companyId: string,
  advisorId: string,
): Promise<{ number: string; wabaId?: string } | null> {
  const routes = await getAllRoutes();
  const r = routes.find(
    (x) => x.provider === 'ycloud'
      && x.companyId === companyId
      && x.kind === 'advisor_coexistence'
      && x.advisorId === advisorId
      && x.active !== false,
  );
  if (!r) return null;
  return { number: `+${r.identifier}`, ...(r.wabaId ? { wabaId: r.wabaId } : {}) };
}

/** Todas las líneas de coexistencia de una empresa (para sync de plantillas por WABA). */
export async function listAdvisorLines(
  companyId: string,
): Promise<{ number: string; advisorId?: string; wabaId?: string; label?: string }[]> {
  const routes = await getAllRoutes();
  return routes
    .filter((x) => x.provider === 'ycloud' && x.companyId === companyId
      && x.kind === 'advisor_coexistence' && x.active !== false)
    .map((x) => ({ number: `+${x.identifier}`, advisorId: x.advisorId, wabaId: x.wabaId, label: x.label }));
}

export async function upsertChannelRoute(input: {
  provider: ChannelProvider;
  identifier: string;
  companyId: string;
  label?: string;
  active?: boolean;
  kind?: 'main' | 'advisor_coexistence';
  advisorId?: string;
  wabaId?: string;
}): Promise<ChannelRoute> {
  const identifier = normalizeChannelIdentifier(input.provider, input.identifier);
  const id = channelRouteId(input.provider, identifier);
  const now = Timestamp.now();
  const ref = db.collection('channelRoutes').doc(id);
  const snap = await ref.get();

  const route = {
    provider: input.provider,
    identifier,
    companyId: input.companyId,
    label: input.label ?? '',
    active: input.active !== false,
    ...(input.kind ? { kind: input.kind } : {}),
    // advisorId solo aplica a líneas de asesor; en una línea principal se limpia.
    ...(input.kind === 'advisor_coexistence' && input.advisorId
      ? { advisorId: input.advisorId }
      : {}),
    ...(input.wabaId ? { wabaId: input.wabaId } : {}),
    updatedAt: now,
    ...(snap.exists ? {} : { createdAt: now }),
  };

  await ref.set(route, { merge: true });
  clearChannelRouteCache();
  return { id, ...route };
}

export async function listChannelRoutes(): Promise<ChannelRoute[]> {
  const snap = await db.collection('channelRoutes').get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as ChannelRoute))
    .sort((a, b) => `${a.provider}:${a.identifier}`.localeCompare(`${b.provider}:${b.identifier}`));
}
