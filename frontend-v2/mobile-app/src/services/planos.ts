import type { LibraryItem } from '../types';

export interface PlanoIndexItem {
  planoId:     string;
  projectId:   string;
  projectName: string;
  stageName:   string | null;
  name:        string;
  url:         string;
  generatedAt: string | null;
}

const PLANOS_INDEX_URL = 'https://us-central1-disponibilidad-e8a81.cloudfunctions.net/planosIndex';

let _cache: Promise<PlanoIndexItem[]> | null = null;

export function fetchPlanosIndex(force = false): Promise<PlanoIndexItem[]> {
  if (!_cache || force) {
    _cache = fetch(`${PLANOS_INDEX_URL}?_t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => (Array.isArray(data?.planos) ? (data.planos as PlanoIndexItem[]) : []))
      .catch((err) => {
        console.error('[planos.service] No se pudo leer el índice de planos:', err);
        return [];
      });
  }
  return _cache;
}

export function normalizeProjectName(name: string): string {
  return String(name ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

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

export const planoItemId = (planoId: string) => `__plano_${planoId}`;
export const isPlanoItem = (item: Pick<LibraryItem, 'id'>) => item.id.startsWith('__plano_');

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
    project:     groupName,
    title:       label,
    fileName,
    storagePath: '',
    downloadUrl: plano.url,
    contentType: 'application/pdf',
    sizeBytes:   0,
  };
}
