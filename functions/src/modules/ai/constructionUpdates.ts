import { inventoryDb } from '../inventory/inventory.client';
import { logger } from '../../utils/logger';

/**
 * Avances de obra semanales que publica el sitio de disponibilidad (colección
 * `avances_obra` del proyecto disponibilidad-e8a81, la misma que muestra la web de
 * cada club). La IA envía el último informe con algunas fotos.
 */
export interface ConstructionUpdate {
  id:          string;
  projectSlug: string;
  date:        string;   // texto, p. ej. "Semana del 3 al 6 de noviembre del 2026"
  text:        string;
  images:      string[];
  createdAt:   string;   // ISO
}

const norm = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export type ConstructionClub =
  | { slug: string; label: string }
  | { slug: null; label: string };

/** Club pedido → informe publicado. Llano Grande y Sobre Montañas no publican informes. */
export function resolveConstructionClub(club: string): ConstructionClub | null {
  const c = norm(club);
  if (/\b(CANON|ARIZONA|TEXAS|COLORADO|VEGAS|ANGELES|FRANCISCO)\b/.test(c)) return { slug: 'cañon-arizona', label: 'Cañón de Arizona' };
  if (/\b(LAGUNA|SANTORINI|CANARIAS|MELGAR)\b/.test(c)) return { slug: 'laguna-mar', label: 'Laguna Mar' };
  if (/\b(RIO|CLARO|MARIQUITA|LAGUNILLA|MEDINA)\b/.test(c)) return { slug: 'rio-claro', label: 'Río Claro' };
  if (/\b(LLANO|GRANDE|ABURRA|SAN ANTONIO)\b/.test(c)) return { slug: null, label: 'Llano Grande' };
  if (/\b(SOBRE|MONTANAS|ALDEA)\b/.test(c)) return { slug: null, label: 'Sobre Montañas' };
  return null;
}

/** El informe más reciente del club (por fecha de publicación). */
export function latestUpdate(updates: ConstructionUpdate[], slug: string): ConstructionUpdate | null {
  return updates
    .filter((u) => u.projectSlug === slug && u.text.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Recorta el resumen en un final de frase para no cortar a mitad de palabra. */
export function summarizeUpdate(text: string, max = 700): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastPeriod = cut.lastIndexOf('. ');
  return lastPeriod > max * 0.5 ? cut.slice(0, lastPeriod + 1) : `${cut.trimEnd()}…`;
}

/** Elige hasta `count` fotos repartidas a lo largo del informe (no solo las primeras). */
export function pickPhotos(images: string[], count = 4): string[] {
  // WhatsApp solo acepta JPEG y PNG como imagen.
  const valid = images.filter((url) => /^https:\/\//.test(url) && /\.(jpe?g|png)(\?|$)/i.test(decodeURIComponent(url)));
  if (valid.length <= count) return valid;
  const step = valid.length / count;
  return Array.from({ length: count }, (_, i) => valid[Math.floor(i * step)]);
}

/** Tipo de imagen según la extensión del archivo. */
export function photoMimeType(url: string): string {
  return /\.png(\?|$)/i.test(decodeURIComponent(url)) ? 'image/png' : 'image/jpeg';
}

export async function loadLatestConstructionUpdate(slug: string): Promise<ConstructionUpdate | null> {
  try {
    const snap = await inventoryDb().collection('avances_obra').where('projectSlug', '==', slug).get();
    const updates = snap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const created = d.createdAt as { toDate?: () => Date } | string | undefined;
      return {
        id:          doc.id,
        projectSlug: String(d.projectSlug ?? ''),
        date:        String(d.date ?? ''),
        text:        String(d.text ?? ''),
        images:      Array.isArray(d.images) ? d.images.map(String) : [],
        createdAt:   typeof created === 'string' ? created : created?.toDate?.().toISOString() ?? '',
      };
    });
    return latestUpdate(updates, slug);
  } catch (err) {
    logger.warn('[AI] No se pudieron leer los avances de obra', { slug, error: String(err) });
    return null;
  }
}

/** Página del club en la web, donde están todos los informes con fotos. */
export const CLUB_PAGE_URLS: Record<string, string> = {
  'cañon-arizona': 'https://grupoconstructormeraki.com.co/proyectos/ca%C3%B1on-arizona',
  'laguna-mar':    'https://grupoconstructormeraki.com.co/proyectos/laguna-mar',
  'rio-claro':     'https://grupoconstructormeraki.com.co/proyectos/rio-claro',
};
export const CLUBS_WITH_UPDATES: Array<{ slug: string; label: string }> = [
  { slug: 'cañon-arizona', label: 'Cañón de Arizona' },
  { slug: 'laguna-mar', label: 'Laguna Mar' },
  { slug: 'rio-claro', label: 'Río Claro' },
];

/** El lead preguntó por la obra (no basta con que pregunte por un club). */
export function asksAboutConstruction(texts: string[]): boolean {
  const t = texts.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    // Preguntas sobre qu\u00e9 se puede construir en el terreno (reglas, licencia, casas):
    // no son sobre el avance de la obra. "\u00bfLa construcci\u00f3n es libre?" respond\u00eda con el avance.
    .replace(/\b(la )?construccion (es |sera )?libre\b|\b(puedo|se puede|podria|pueden) construir\b|\bque (puedo|se puede) construir\b|\blicencia de construccion\b|\barea (de |maxima de )?construccion\b|\bconstruir (mi|una|la|el)\b|\bconstruccion de (la|mi|una|las) casas?\b|\bmano de obra\b/g, ' ');
  return /\b(obra|obras|avance|avances|avanzando|construyendo|construido|construyen|progreso|como van?|como esta(n)? (la|el|los|las)? ?(obra|proyecto|club)|(como|cuando) (va|van|empieza|empiezan|inicia|termina) (la )?construccion|(avance|estado|inicio) de (la )?construccion|ya (empezaron|comenzaron|arrancaron)|estado del (proyecto|club))\b/.test(t);
}

/** Informes del club publicados en los últimos `days` días (máximo `max`, del más nuevo al más viejo). */
export function recentUpdates(updates: ConstructionUpdate[], slug: string, days = 31, max = 5, now = Date.now()): ConstructionUpdate[] {
  const since = now - days * 86_400_000;
  return updates
    .filter((u) => u.projectSlug === slug && u.text.trim() && Date.parse(u.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export async function loadRecentConstructionUpdates(slug: string, days = 31, max = 5): Promise<ConstructionUpdate[]> {
  try {
    const snap = await inventoryDb().collection('avances_obra').where('projectSlug', '==', slug).get();
    const updates = snap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const created = d.createdAt as { toDate?: () => Date } | string | undefined;
      return {
        id:          doc.id,
        projectSlug: String(d.projectSlug ?? ''),
        date:        String(d.date ?? ''),
        text:        String(d.text ?? ''),
        images:      [],
        createdAt:   typeof created === 'string' ? created : created?.toDate?.().toISOString() ?? '',
      };
    });
    return recentUpdates(updates, slug, days, max);
  } catch (err) {
    logger.warn('[AI] No se pudieron leer los avances de obra', { slug, error: String(err) });
    return [];
  }
}
