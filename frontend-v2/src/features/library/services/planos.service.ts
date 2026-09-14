import type { LibraryItem } from '../types';

/**
 * Índice de "planos con disponibilidad" generados por el proyecto de disponibilidad
 * (tour-meraki). Cada proyecto tiene un PDF (una página por sector) que se regenera
 * solo cuando cambia el inventario y vive en una URL pública estable. Aquí solo lo
 * leemos para ofrecerlo en el selector "Enviar documento" de la Bandeja.
 *
 * Endpoint: Cloud Function `planosIndex` del proyecto disponibilidad-e8a81.
 * Se puede sobreescribir la URL con VITE_PLANOS_INDEX_URL.
 */

export interface PlanoIndexItem {
  planoId:     string;   // id único del plano (proyecto o etapa), p. ej. "mar-santorini"
  projectId:   string;   // id del proyecto, p. ej. "laguna-mar"
  projectName: string;   // nombre del proyecto, p. ej. "Laguna Mar" — se usa para agrupar
  stageName:   string | null; // nombre de la etapa si aplica, p. ej. "Mar Santorini"
  name:        string;   // nombre visible del plano (etapa o proyecto)
  url:         string;   // URL pública del PDF (la envía YCloud)
  generatedAt: string | null; // ISO
}

const PLANOS_INDEX_URL =
  (import.meta.env.VITE_PLANOS_INDEX_URL as string | undefined) ||
  'https://us-central1-disponibilidad-e8a81.cloudfunctions.net/planosIndex';

// El índice cambia poco (se regenera en segundo plano); cacheamos por sesión.
let _cache: Promise<PlanoIndexItem[]> | null = null;

export function fetchPlanosIndex(force = false): Promise<PlanoIndexItem[]> {
  if (!_cache || force) {
    _cache = fetch(PLANOS_INDEX_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => (Array.isArray(data?.planos) ? (data.planos as PlanoIndexItem[]) : []))
      .catch((err) => {
        console.error('[planos.service] No se pudo leer el índice de planos:', err);
        return [];
      });
  }
  return _cache;
}

/** Normaliza un nombre de proyecto para emparejar CRM ("CAÑON…") con tour ("Cañon…"). */
export function normalizeProjectName(name: string): string {
  return String(name ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** "hace 3 min", "hace 2 h", "hace 1 día" — para mostrar la frescura del plano. */
export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'actualizado hace instantes';
  if (mins < 60) return `actualizado hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `actualizado hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `actualizado hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/** ID sintético de un ítem de plano dentro del selector (único por plano/etapa). */
export const planoItemId = (planoId: string) => `__plano_${planoId}`;
export const isPlanoItem = (item: Pick<LibraryItem, 'id'>) => item.id.startsWith('__plano_');

/**
 * Construye un LibraryItem "virtual" para el plano, de modo que fluya por el mismo
 * `itemToMedia` y `sendManualMessage` que un documento normal (sin cambios en el
 * composer ni en Cloud Functions del CRM). `storagePath` va vacío: no se envía ni
 * se borra. Para etapas (Laguna Mar) el título muestra la etapa.
 */
export function planoToLibraryItem(
  plano: PlanoIndexItem,
  companyId: string,
  groupName: string,
): LibraryItem {
  const label = plano.stageName
    ? `Plano actualizado — ${plano.stageName}`
    : 'Plano actualizado — disponibilidad';
  const fileName = plano.stageName
    ? `Plano ${plano.projectName} - ${plano.stageName}.pdf`
    : `Plano ${plano.projectName}.pdf`;
  return {
    id:          planoItemId(plano.planoId),
    companyId,
    project:     groupName,
    title:       label,
    fileName,
    storagePath: '',
    downloadUrl: plano.url,
    contentType: 'application/pdf',
    sizeBytes:   0,
  };
}
