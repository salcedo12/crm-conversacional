import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requirePlatformAdmin } from '../lib/authContext';
import {
  listChannelRoutes,
  upsertChannelRoute,
  type ChannelProvider,
} from '../modules/companies/companyRouting';

const CompanySchema = z.object({
  companyId: z.string().trim().min(2).max(80).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(160),
  environment: z.enum(['demo', 'production']).default('production'),
  active: z.boolean().default(true),
  smartHomeEnabled: z.boolean().default(false),
});

const ChannelRouteSchema = z.object({
  companyId: z.string().trim().min(2).max(80),
  provider: z.enum(['ycloud', 'dapta', 'twilio', 'messenger', 'instagram', 'meta']),
  identifier: z.string().trim().min(3).max(180),
  label: z.string().trim().max(120).optional(),
  active: z.boolean().default(true),
  // Línea de asesor en coexistencia (WhatsApp Business App + Cloud API en el mismo
  // número). Requiere advisorId (el dueño de la línea).
  kind: z.enum(['main', 'advisor_coexistence']).optional(),
  advisorId: z.string().trim().min(1).max(128).optional(),
}).refine(
  (d) => d.kind !== 'advisor_coexistence' || !!d.advisorId,
  { message: 'Una línea de asesor (advisor_coexistence) requiere advisorId.', path: ['advisorId'] },
);

const CALLABLE_OPTIONS = { region: 'us-central1', timeoutSeconds: 30, cors: true } as const;

async function requirePlatformAdminAccess(request: Parameters<typeof requireAuth>[0]) {
  const ctx = requireAuth(request);
  if (ctx.platformAdmin) return ctx;

  const userSnap = await db
    .collection('companies')
    .doc(ctx.companyId)
    .collection('users')
    .doc(ctx.uid)
    .get();
  const userData = userSnap.data();
  const firestorePlatformAdmin =
    userData?.platformAdmin === true ||
    userData?.platformAdmin === 'true' ||
    userData?.role === 'platformAdmin';

  if (firestorePlatformAdmin) return ctx;

  requirePlatformAdmin(ctx);
  return ctx;
}

function toMillis(value: unknown): number | null {
  return typeof (value as { toMillis?: unknown })?.toMillis === 'function'
    ? (value as FirebaseFirestore.Timestamp).toMillis()
    : null;
}

export const listPlatformCompanies = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    await requirePlatformAdminAccess(request);

    const [companiesSnap, routes] = await Promise.all([
      db.collection('companies').orderBy('name').get(),
      listChannelRoutes(),
    ]);

    const routesByCompany = new Map<string, unknown[]>();
    for (const route of routes) {
      const rows = routesByCompany.get(route.companyId) ?? [];
      rows.push({
        id: route.id,
        provider: route.provider,
        identifier: route.identifier,
        label: route.label ?? '',
        active: route.active !== false,
        createdAt: toMillis(route.createdAt),
        updatedAt: toMillis(route.updatedAt),
      });
      routesByCompany.set(route.companyId, rows);
    }

    const companiesById = new Map(companiesSnap.docs.map((doc) => {
      const data = doc.data();
      return [doc.id, {
        id: doc.id,
        name: data.name ?? doc.id,
        environment: data.environment ?? (doc.id === 'empresa_demo' ? 'demo' : 'production'),
        active: data.active !== false,
        smartHomeEnabled: data.smartHomeEnabled === true,
        createdAt: toMillis(data.createdAt),
        updatedAt: toMillis(data.updatedAt),
        channelRoutes: routesByCompany.get(doc.id) ?? [],
      }];
    }));

    for (const route of routes) {
      if (companiesById.has(route.companyId)) continue;
      companiesById.set(route.companyId, {
        id: route.companyId,
        name: route.companyId === 'empresa_demo' ? 'Sistemas Meraki' : route.companyId,
        environment: route.companyId === 'empresa_demo' ? 'demo' : 'production',
        active: true,
        smartHomeEnabled: false,
        createdAt: null,
        updatedAt: null,
        channelRoutes: routesByCompany.get(route.companyId) ?? [],
      });
    }

    if (!companiesById.has('empresa_demo')) {
      companiesById.set('empresa_demo', {
        id: 'empresa_demo',
        name: 'Sistemas Meraki',
        environment: 'demo',
        active: true,
        smartHomeEnabled: false,
        createdAt: null,
        updatedAt: null,
        channelRoutes: routesByCompany.get('empresa_demo') ?? [],
      });
    }

    const companies = [...companiesById.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return { companies };
  }
);

export const savePlatformCompany = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    await requirePlatformAdminAccess(request);
    const data = CompanySchema.parse(request.data);
    const ref = db.collection('companies').doc(data.companyId);
    const snap = await ref.get();
    const now = Timestamp.now();

    await ref.set({
      name: data.name,
      environment: data.environment,
      active: data.active,
      smartHomeEnabled: data.smartHomeEnabled,
      updatedAt: now,
      ...(snap.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return { companyId: data.companyId };
  }
);

export const saveChannelRoute = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    await requirePlatformAdminAccess(request);
    const data = ChannelRouteSchema.parse(request.data);
    const companySnap = await db.collection('companies').doc(data.companyId).get();
    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'La empresa no existe.');
    }

    const route = await upsertChannelRoute({
      companyId: data.companyId,
      provider: data.provider as ChannelProvider,
      identifier: data.identifier,
      label: data.label,
      active: data.active,
      kind: data.kind,
      advisorId: data.advisorId,
    });

    return {
      route: {
        id: route.id,
        provider: route.provider,
        identifier: route.identifier,
        label: route.label ?? '',
        active: route.active,
        companyId: route.companyId,
        ...(route.kind ? { kind: route.kind } : {}),
        ...(route.advisorId ? { advisorId: route.advisorId } : {}),
        createdAt: toMillis(route.createdAt),
        updatedAt: toMillis(route.updatedAt),
      },
    };
  }
);
