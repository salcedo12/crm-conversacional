import type { DealLot } from '../deals/deals.types';

/**
 * Reglas de reserva de lotes sobre el inventario de disponibilidad (proyecto
 * disponibilidad-e8a81, app tour-meraki). Mismo formato que escribe tour-meraki:
 *   inventario/{proyecto-SECTORSINESPACIOS-numero}
 *   proyectos_resumen/{proyecto}.lots[{id}] = { s, a, n, sec, c, e, o, f, x }
 *
 * Un negocio reserva su lote en NEGOCIACION (24 h, como el asesor en tour-meraki);
 * `liberarLotes` de tour-meraki lo devuelve a DISPONIBLE al vencer.
 */

export const RESERVATION_STATUS = 'NEGOCIACION';
export const RESERVATION_MINUTES = 24 * 60;
export const TRAMITE_STATUS = 'TRAMITE';
const HELD_STATUSES = new Set(['NEGOCIACION', 'TRAMITE']);

/** Nombres de proyecto del inventario (PROJECT_OPTIONS de tour-meraki). */
export const INVENTORY_PROJECT_NAMES: Record<string, string> = {
  'rio-claro': 'Río Claro',
  'cañon-arizona': 'Cañón de Arizona',
  'arizona-1': 'Arizona 1',
  'arizona-2': 'Arizona 2',
  'gran-arizona': 'Gran Arizona',
  'laguna-mar': 'Laguna Mar',
  'sobre-montañas': 'Sobre Montañas',
  'llano-grande': 'Llano Grande',
};

export interface InventoryLotDoc {
  proyecto:          string;
  sector?:           string;
  numeroTerreno?:    string | number;
  lote?:             string | number;
  code?:             string;
  codigo?:           string;
  areaM2?:           number;
  area?:             number | string;
  esquinero?:        boolean;
  status?:           string;
  observaciones?:    string;
  fechaSeparacion?:  string;
  fechaVencimiento?: string;
  crmDealId?:        string;
  crmCompanyId?:     string;
}

/** Entrada del mapa de proyectos_resumen. */
export interface SummaryEntry {
  s:   string;   // estado
  a:   number;   // área
  n:   string;   // número de terreno
  sec: string;   // sector
  c:   string;   // código
  e:   boolean;  // esquinero
  o:   string;   // observaciones
  f:   string;   // fechaSeparacion
  x:   string;   // fechaVencimiento
}

export interface AvailableLot {
  id:     string;
  sector: string;
  number: string;
  code:   string;
  areaM2: number;
  corner: boolean;
}

export function normalizeStatus(status: unknown): string {
  return String(status ?? 'DISPONIBLE').trim().toUpperCase() || 'DISPONIBLE';
}

/** '400,05' → 400.05 (el inventario mezcla números y textos con coma decimal). */
export function parseArea(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  // Con coma: '1.258,40' (punto de miles, coma decimal). Sin coma: '313.60' es decimal.
  const n = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(n) ? n : 0;
}

export function lotNumber(lot: InventoryLotDoc): string {
  return String(lot.numeroTerreno ?? lot.lote ?? '');
}

export type ReserveCheck = { ok: true } | { ok: false; reason: string };

/** Se puede reservar si está DISPONIBLE, o si ya lo tiene este mismo negocio (renovar). */
export function checkReservable(lot: InventoryLotDoc | undefined, dealId: string): ReserveCheck {
  if (!lot) return { ok: false, reason: 'El lote no existe en el inventario.' };
  const status = normalizeStatus(lot.status);
  if (status === 'DISPONIBLE') return { ok: true };
  if (HELD_STATUSES.has(status) && lot.crmDealId === dealId) return { ok: true };
  return { ok: false, reason: `El lote ya no está disponible (estado: ${status}).` };
}

/** Solo se libera un lote que este negocio tenga apartado (nunca uno VENDIDO). */
export function canRelease(lot: InventoryLotDoc | undefined, dealId: string): boolean {
  return !!lot && lot.crmDealId === dealId && HELD_STATUSES.has(normalizeStatus(lot.status));
}

export interface ReservationInfo {
  dealId:      string;
  companyId:   string;
  advisorName: string;
}

export function reservationFields(now: Date, info: ReservationInfo) {
  const expiresAt = new Date(now.getTime() + RESERVATION_MINUTES * 60_000);
  return {
    status: RESERVATION_STATUS,
    fechaSeparacion: now.toISOString(),
    fechaVencimiento: expiresAt.toISOString(),
    tramiteReminderSentAt: '',
    updatedAt: now.toISOString(),
    crmDealId: info.dealId,
    crmCompanyId: info.companyId,
    crmAdvisorName: info.advisorName,
  };
}

/**
 * Contrato en firma: el lote pasa a TRAMITE sin vencimiento (`crmSignature` le dice a
 * `liberarLotes` de tour-meraki que no lo libere mientras el negocio esté en firma).
 */
export function tramiteFields(now: Date, info: ReservationInfo) {
  return {
    status: TRAMITE_STATUS,
    fechaSeparacion: now.toISOString(),
    fechaVencimiento: '',
    tramiteReminderSentAt: '',
    updatedAt: now.toISOString(),
    crmDealId: info.dealId,
    crmCompanyId: info.companyId,
    crmAdvisorName: info.advisorName,
    crmSignature: true,
  };
}

export function releaseFields(now: Date) {
  return {
    status: 'DISPONIBLE',
    fechaSeparacion: '',
    fechaVencimiento: '',
    tramiteReminderSentAt: '',
    updatedAt: now.toISOString(),
    crmDealId: '',
    crmCompanyId: '',
    crmAdvisorName: '',
    crmSignature: false,
  };
}

/** Misma forma que escribe syncProjectSummary de tour-meraki. */
export function summaryEntry(lot: InventoryLotDoc): SummaryEntry {
  return {
    s: normalizeStatus(lot.status),
    a: parseArea(lot.area ?? lot.areaM2),
    n: lotNumber(lot),
    sec: lot.sector || 'GENERAL',
    c: lot.code || lot.codigo || '',
    e: !!lot.esquinero,
    o: lot.observaciones || '',
    f: lot.fechaSeparacion || '',
    x: lot.fechaVencimiento || '',
  };
}

/** Lotes DISPONIBLES del resumen del proyecto, ordenados por sector y número. */
export function availableLotsFromSummary(lots: Record<string, Partial<SummaryEntry>> | undefined): AvailableLot[] {
  return Object.entries(lots ?? {})
    .filter(([, l]) => normalizeStatus(l.s) === 'DISPONIBLE')
    .map(([id, l]) => ({
      id,
      sector: String(l.sec || 'GENERAL'),
      number: String(l.n ?? ''),
      code: String(l.c ?? ''),
      areaM2: parseArea(l.a),
      corner: !!l.e,
    }))
    .sort((a, b) =>
      a.sector.localeCompare(b.sector, 'es') ||
      a.number.localeCompare(b.number, 'es', { numeric: true }));
}

export function toDealLot(id: string, lot: InventoryLotDoc, reservedUntil: string): DealLot {
  return {
    projectId: lot.proyecto,
    sector: lot.sector || 'GENERAL',
    lotNumber: lotNumber(lot),
    lotCode: lot.code || lot.codigo || '',
    inventoryLotId: id,
    areaM2: parseArea(lot.area ?? lot.areaM2),
    corner: !!lot.esquinero,
    reservedUntil,
  };
}
