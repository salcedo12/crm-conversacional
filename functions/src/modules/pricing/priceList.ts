import { logger } from '../../utils/logger';

/**
 * Lista de precios por lote y plazo: el mismo Google Sheet publicado que usa el
 * cotizador de tour-meraki y `cotizacionNow`. Columnas: SECTOR, NUMERO DEL TERRENO,
 * AREA M2, ..., "0 MESES", "20 MESES", ... con valores "$ 141.094.100".
 *
 * El precio es una sugerencia para el plan: el asesor puede ajustar el valor del terreno.
 */

const DEFAULT_PRICE_LIST_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSiRb90dTzB4BoIWFuUPO-lTQUuZbo09oZLziZ5W-CLtCtDj1Kfeia-0BpNGGWAzg/pub?gid=1769519994&single=true&output=csv';
const CACHE_MS = 10 * 60 * 1000;

export interface PriceRow {
  sector: string;
  lot:    string;
  areaM2: number;
  /** meses → precio; 0 = de contado. */
  prices: Record<number, number>;
}

export interface PriceOption {
  termMonths: number;
  price:      number;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(current.trim()); current = ''; }
    else current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseMoney(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export function parsePriceList(csv: string): PriceRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const iSector = headers.indexOf('SECTOR');
  const iLot = headers.indexOf('NUMERO DEL TERRENO');
  const iArea = headers.indexOf('AREA M2');
  const termCols: Array<[number, number]> = [];
  headers.forEach((h, i) => {
    const m = /(\d+)\s*MESES/.exec(h);
    if (m) termCols.push([Number(m[1]), i]);
  });

  return lines.slice(1).flatMap((line) => {
    const cols = parseCsvLine(line);
    const sector = cols[iSector] ?? '';
    const lot = cols[iLot] ?? '';
    if (!sector || !lot) return [];
    const prices: Record<number, number> = {};
    for (const [months, i] of termCols) {
      const price = parseMoney(cols[i] ?? '');
      if (price > 0) prices[months] = price;
    }
    return [{ sector, lot, areaM2: Number(String(cols[iArea] ?? '').replace(/\./g, '').replace(',', '.')) || 0, prices }];
  });
}

/** 'Sn.FRANCISCO' → 'SAN FRANCISCO'; 'Mar Canarias' → 'MAR CANARIAS'. */
export function normalizeSector(value: string): string {
  return value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\bSN\b/g, 'SAN')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameSector(inventorySector: string, priceSector: string): boolean {
  const a = normalizeSector(inventorySector);
  const b = normalizeSector(priceSector);
  // El inventario dice "RIO LAGUNILLA" y la lista "LAGUNILLA": emparejar por inclusión.
  return a === b || a.includes(b) || b.includes(a);
}

/** Opciones de plazo y precio para un lote ('0' de contado primero). */
export function priceOptionsFor(rows: PriceRow[], sector: string, lot: string): PriceOption[] {
  const lotKey = String(Number(lot) || lot).trim();
  const row = rows.find((r) => String(Number(r.lot) || r.lot).trim() === lotKey && sameSector(sector, r.sector));
  if (!row) return [];
  return Object.entries(row.prices)
    .map(([months, price]) => ({ termMonths: Number(months), price }))
    .sort((a, b) => a.termMonths - b.termMonths);
}

let _cache: { at: number; rows: PriceRow[] } | null = null;

export async function loadPriceList(): Promise<PriceRow[]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.rows;
  const url = process.env.PRICE_LIST_CSV_URL || DEFAULT_PRICE_LIST_URL;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parsePriceList(await res.text());
    _cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    logger.warn('[PriceList] No se pudo cargar la lista de precios', { error: String(err) });
    return _cache?.rows ?? [];
  }
}
