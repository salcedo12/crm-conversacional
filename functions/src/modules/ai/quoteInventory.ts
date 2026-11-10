import { inventoryDb } from '../inventory/inventory.client';
import { logger } from '../../utils/logger';

/**
 * Disponibilidad para la cotización de la IA, leída directamente del inventario
 * (proyectos_resumen). No depende de los nombres que use la hoja de precios: ahí
 * San Francisco se llama "Sn.FRANCISCO" y el cotizador no lo encontraba en el
 * inventario, así que cotizaba terrenos vendidos.
 */
export interface InventoryLot {
  n:    string;  // número de terreno
  sec:  string;  // sector
  s:    string;  // estado
  a?:   number;  // área en m²
}

const norm = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/** Número de terreno comparable: sin espacios y sin ceros a la izquierda ("07" = "7"). */
const lotKey = (value: unknown): string => norm(value).replace(/\s+/g, '').replace(/^0+(?=\d)/, '');

const SECTORS: Array<[RegExp, string, string]> = [
  [/\bTEXAS\b/, 'cañon-arizona', 'TEXAS'],
  [/\bCOLORADO\b/, 'cañon-arizona', 'COLORADO'],
  [/\bLAS VEGAS\b/, 'cañon-arizona', 'LAS VEGAS'],
  [/\bLOS ANGELES\b/, 'cañon-arizona', 'LOS ANGELES'],
  [/\b(SN|SAN) FRANCISCO\b/, 'cañon-arizona', 'SAN FRANCISCO'],
  [/\bLAGUNILLA\b/, 'rio-claro', 'RIO LAGUNILLA'],
  [/\bMEDINA\b/, 'rio-claro', 'RIO MEDINA'],
  [/\bABURRA\b/, 'llano-grande', 'VALLE DE ABURRA'],
  [/\bSAN ANTONIO\b/, 'llano-grande', 'SAN ANTONIO'],
  [/\bSANTORINI\b/, 'laguna-mar', 'MAR SANTORINI'],
  [/\bCANARIAS\b/, 'laguna-mar', 'MAR CANARIAS'],
];

/** Proyecto y sector del inventario para el sector que envía la IA. */
export function inventorySectorFor(sector: string): { projectId: string; sector: string } | null {
  const n = norm(sector);
  const hit = SECTORS.find(([pattern]) => pattern.test(n));
  return hit ? { projectId: hit[1], sector: hit[2] } : null;
}

/** Estado del terreno en el inventario, o null si no aparece. */
export function lotStatus(lots: InventoryLot[], sector: string, terreno: string): string | null {
  const key = lotKey(terreno);
  const lot = lots.find((l) => norm(l.sec) === sector && lotKey(l.n) === key);
  return lot ? norm(lot.s || 'DISPONIBLE') : null;
}

export function isLlanoGrandeSector(sector: string): boolean {
  return /^(LLANO( GRANDE)?|VALLE DE ABURRA|ABURRA|SAN ANTONIO)$/.test(norm(sector));
}

/** Sector de Llano Grande que el lead nombró en sus mensajes (solo si nombró uno). */
export function namedLlanoGrandeSector(leadTexts: string[]): 'VALLE DE ABURRA' | 'SAN ANTONIO' | null {
  const text = norm(leadTexts.join(' '));
  const valle = /\b(VALLE|ABURRA)\b/.test(text);
  const sanAntonio = /\bSAN ANTONIO\b/.test(text);
  if (valle === sanAntonio) return null;
  return valle ? 'VALLE DE ABURRA' : 'SAN ANTONIO';
}

export type LlanoGrandePick =
  | { kind: 'ok'; sector: 'VALLE DE ABURRA' | 'SAN ANTONIO' }
  | { kind: 'ask' }
  | { kind: 'none' };

/**
 * Los números se repiten entre Valle de Aburrá y San Antonio (p. ej. el 12 está en
 * los dos), así que el sector se deduce por el número: si existe en uno solo, es
 * ese; si existe en los dos y solo uno está disponible, es el disponible; si no, hay
 * que preguntar. Si el lead nombró un sector y el número existe ahí, manda el lead.
 */
export function pickLlanoGrandeSector(
  lots: InventoryLot[],
  terreno: string,
  named: 'VALLE DE ABURRA' | 'SAN ANTONIO' | null
): LlanoGrandePick {
  const key = lotKey(terreno);
  const candidates = lots.filter((l) =>
    lotKey(l.n) === key && ['VALLE DE ABURRA', 'SAN ANTONIO'].includes(norm(l.sec)));
  if (candidates.length === 0) return { kind: 'none' };
  const sectorOf = (l: InventoryLot) => norm(l.sec) as 'VALLE DE ABURRA' | 'SAN ANTONIO';
  if (named && candidates.some((l) => sectorOf(l) === named)) return { kind: 'ok', sector: named };
  if (candidates.length === 1) return { kind: 'ok', sector: sectorOf(candidates[0]) };
  const available = candidates.filter((l) => norm(l.s || 'DISPONIBLE') === 'DISPONIBLE');
  if (available.length === 1) return { kind: 'ok', sector: sectorOf(available[0]) };
  return { kind: 'ask' };
}

const TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; lots: InventoryLot[] }>();

/** Lotes de un proyecto del inventario (caché de 1 min). null si no se pudo leer. */
export async function loadProjectLots(projectId: string): Promise<InventoryLot[] | null> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lots;
  try {
    const snap = await inventoryDb().collection('proyectos_resumen').doc(projectId).get();
    const raw = (snap.data()?.lots ?? {}) as Record<string, { n?: unknown; sec?: unknown; s?: unknown; a?: unknown }>;
    const lots = Object.values(raw).map((l) => ({
      n: String(l.n ?? ''), sec: String(l.sec ?? ''), s: String(l.s ?? ''),
      a: Number(String((l as { a?: unknown }).a ?? '').replace(',', '.')) || 0,
    }));
    cache.set(projectId, { at: Date.now(), lots });
    return lots;
  } catch (err) {
    logger.warn('[AI] No se pudo leer el inventario para cotizar', { projectId, error: String(err) });
    return null;
  }
}

const m2 = (n: number) => `${Math.round(n).toLocaleString('es-CO')} m²`;

/** "de 471 a 1.900 m²" con los terrenos DISPONIBLES (área > 0), o null si no hay. */
export function availableAreaRange(lots: InventoryLot[], sectorFilter?: (sector: string) => boolean): string | null {
  const areas = lots
    .filter((l) => norm(l.s || 'DISPONIBLE') === 'DISPONIBLE' && (l.a ?? 0) > 0 && (!sectorFilter || sectorFilter(norm(l.sec))))
    .map((l) => l.a as number)
    .sort((x, y) => x - y);
  if (!areas.length) return null;
  return areas[0] === areas[areas.length - 1] ? m2(areas[0]) : `de ${m2(areas[0])} a ${m2(areas[areas.length - 1])}`;
}

/** Texto con las áreas disponibles hoy por club, para que la IA no use rangos viejos. */
export async function inventoryAreasText(): Promise<string> {
  const [canon, laguna, llano, rio, sobre] = await Promise.all(
    ['cañon-arizona', 'laguna-mar', 'llano-grande', 'rio-claro', 'sobre-montañas'].map(loadProjectLots)
  );
  const parts: string[] = [];
  const add = (label: string, range: string | null) => { if (range) parts.push(`${label}: ${range}`); };
  if (canon) add('Cañón de Arizona', availableAreaRange(canon));
  if (laguna) {
    add('Laguna Mar - Mar Santorini', availableAreaRange(laguna, (s) => s === 'MAR SANTORINI'));
    add('Laguna Mar - Mar Canarias', availableAreaRange(laguna, (s) => s === 'MAR CANARIAS'));
  }
  if (llano) add('Llano Grande', availableAreaRange(llano));
  if (rio) add('Río Claro', availableAreaRange(rio));
  if (sobre) add('Sobre Montañas (aldeas)', availableAreaRange(sobre));
  return parts.join('; ');
}
