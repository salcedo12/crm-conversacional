import { env } from '../../config/env';

/**
 * Índice de "planos con disponibilidad" generados por el proyecto de disponibilidad
 * (tour-meraki). Cada club de campo (o etapa, en Laguna Mar) tiene un PDF que se
 * regenera solo cuando cambia el inventario y vive en una URL pública estable.
 *
 * Es el MISMO índice que consume la Bandeja del frontend (planos.service.ts); aquí
 * lo leemos desde las Functions para que la IA pueda enviar el plano correcto sola.
 *
 * Endpoint: Cloud Function `planosIndex` del proyecto disponibilidad-e8a81.
 * Se puede sobreescribir con la env var PLANOS_INDEX_URL.
 */
export interface PlanoIndexItem {
  planoId:     string;        // id único del plano (club o etapa), p. ej. "mar-santorini"
  projectId:   string;        // id del club, p. ej. "laguna-mar"
  projectName: string;        // nombre del club, p. ej. "Laguna Mar"
  stageName:   string | null; // etapa si aplica, p. ej. "Mar Santorini"
  name:        string;        // nombre visible del plano
  url:         string;        // URL pública del PDF (la descarga WhatsApp)
  generatedAt: string | null; // ISO
}

// El índice cambia poco (se regenera en segundo plano); cacheamos unos minutos.
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: PlanoIndexItem[] } | null = null;

export async function fetchPlanosIndex(): Promise<PlanoIndexItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const resp = await fetch(env.planosIndexUrl(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`planosIndex HTTP ${resp.status}`);
  const json = (await resp.json()) as { planos?: PlanoIndexItem[] };
  const data = Array.isArray(json?.planos) ? json.planos : [];

  cache = { at: Date.now(), data };
  return data;
}

/** Normaliza un nombre para emparejar sin importar acentos, mayúsculas ni símbolos. */
function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Lista de nombres de clubes únicos disponibles (para mensajes de error de la IA). */
function availableProjects(planos: PlanoIndexItem[]): string[] {
  return [...new Set(planos.map((p) => p.projectName))];
}

export type PlanoMatch =
  | { status: 'ok'; plano: PlanoIndexItem }
  | { status: 'need_stage'; projectName: string; stages: string[] }
  | { status: 'not_found'; available: string[] };

/**
 * Empareja el club (y etapa) que la IA pidió con un plano del índice.
 *
 * - Si el club tiene varias etapas (Laguna Mar) y no se dio una válida → 'need_stage'.
 * - Si no se encuentra el club → 'not_found' (con la lista de disponibles).
 */
export function matchPlano(
  planos: PlanoIndexItem[],
  club:   string,
  etapa?: string
): PlanoMatch {
  const nClub = norm(club);
  if (!nClub) return { status: 'not_found', available: availableProjects(planos) };

  const inProject = planos.filter((p) => {
    const np = norm(p.projectName);
    return np !== '' && (nClub.includes(np) || np.includes(nClub));
  });

  if (inProject.length === 0) {
    return { status: 'not_found', available: availableProjects(planos) };
  }

  // Club de una sola pieza (sin etapas) → directo.
  if (inProject.length === 1) {
    return { status: 'ok', plano: inProject[0] };
  }

  // Club con varias etapas (Laguna Mar): hay que elegir una.
  if (etapa && norm(etapa)) {
    const nEt = norm(etapa);
    const hit = inProject.find((p) => {
      const ns = norm(p.stageName ?? '');
      return ns !== '' && (nEt.includes(ns) || ns.includes(nEt));
    });
    if (hit) return { status: 'ok', plano: hit };
  }

  return {
    status:      'need_stage',
    projectName: inProject[0].projectName,
    stages:      inProject.map((p) => p.stageName ?? p.name),
  };
}

/** Nombre de archivo con el que WhatsApp mostrará el PDF del plano. */
export function planoFileName(plano: PlanoIndexItem): string {
  return plano.stageName
    ? `Plano ${plano.projectName} - ${plano.stageName}.pdf`
    : `Plano ${plano.projectName}.pdf`;
}

/** Etiqueta legible del plano enviado (para logs / respuesta a la IA). */
export function planoLabel(plano: PlanoIndexItem): string {
  return plano.stageName ? `${plano.projectName} — ${plano.stageName}` : plano.projectName;
}

export const _test = { norm };
