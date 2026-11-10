import { InventoryLot } from './quoteInventory';

/**
 * Estado determinista de la cotización a partir de la conversación: qué terreno nombró
 * el lead después del plano, qué forma de pago eligió y si ya se le cotizó. Sirve para
 * no depender de que el modelo "decida" cotizar: si ya están terreno y forma de pago,
 * el sistema fuerza la cotización (el modelo se quedaba preguntando o prometía enviarla).
 */

export interface ChatTurn {
  from:    'lead' | 'ai';
  text:    string;
  origin?: string;   // metadata.origin de los mensajes de la IA (ai_plano, ai_cotizacion…)
  hasImage?: boolean; // el lead envió una imagen (p. ej. el plano con un terreno marcado)
}

export interface QuoteState {
  terreno:         string | null;
  color:           string | null;
  sectorHint:      string | null;   // sector que la IA leyó de la imagen ("Lagunilla")
  pago:            'contado' | 'cuotas' | null;
  meses?:          number;
  quoted:          boolean;   // ya se cotizó este terreno con esta forma de pago
  planoSent:       boolean;
  lotThisTurn:     boolean;   // el último mensaje del lead nombró el terreno
  paymentThisTurn: boolean;   // el último mensaje del lead dio la forma de pago
}

const norm = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const COLORS = 'ROJO|VINO|AZUL OSCURO|AZUL CLARO|AZUL|NARANJA|AMARILLO|VERDE|MORADO|ROSADO|GRIS';

/** Plazos que ofreció la IA en su pregunta de forma de pago (vacío si no la hizo). */
function offeredMonths(aiText: string): number[] {
  const t = norm(aiText);
  if (/\b12 18 O 24 MESES\b/.test(t)) return [12, 18, 24];
  if (/\b20 30 O 40 MESES\b/.test(t)) return [20, 30, 40];
  return [];
}

/** Forma de pago dicha por el lead. `afterPaymentQuestion` permite un número suelto ("30"). */
export function parsePaymentReply(
  leadText: string,
  lastAiText: string
): { pago: 'contado' | 'cuotas'; meses?: number } | null {
  const t = norm(leadText);
  if (/\b(CONTADO|EFECTIVO|UN SOLO PAGO)\b/.test(t)) return { pago: 'contado' };
  const offered = offeredMonths(lastAiText);
  const allowed = offered.length ? offered : [20, 30, 40, 12, 18, 24];
  const explicit = t.match(/\b(\d{2})\s+(?:MESES|MESAS|MES|CUOTAS)\b/);
  if (explicit && allowed.includes(Number(explicit[1]))) return { pago: 'cuotas', meses: Number(explicit[1]) };
  // Número suelto solo si la IA acaba de preguntar la forma de pago o confirmar el plazo.
  const askedPayment = offered.length > 0 || /\bPLAZOS?\b.*\b\d{2} MESES\b/.test(norm(lastAiText));
  if (!askedPayment) return null;
  const bare = t.match(/^(?:(?:SI|SII|OK|DALE|A|EN|DE|POR FAVOR|MEJOR|PLAZOS?|CUOTAS?)\s+)*(\d{2})(?:\s+(?:POR FAVOR|GRACIAS))?$/);
  const n = Number(bare?.[1]);
  const pool = offered.length ? offered : [20, 30, 40, 12, 18, 24];
  return pool.includes(n) ? { pago: 'cuotas', meses: n } : null;
}

/** Terreno que nombra el lead ("228", "el 30 verde", "terreno 59 rojo"), si lo nombra. */
export function parseLotReply(leadText: string): { terreno: string; color: string | null } | null {
  const t = norm(leadText);
  const m = t.match(new RegExp(
    `^(?:(?:ME INTERESA|QUIERO|PREFIERO|MEJOR|Y|EL|LA|DEL|TERRENO|LOTE|NUMERO|NRO|NO|N)\\s+)*(\\d{1,3})` +
    `(?:\\s+(?:DE\\s+)?(?:COLOR\\s+)?(${COLORS}))?(?:\\s+(?:POR FAVOR|GRACIAS))?$`
  ));
  if (!m) return null;
  return { terreno: String(Number(m[1])), color: m[2] ?? null };
}

const SECTOR_WORDS: Array<[RegExp, string]> = [
  [/\bTEXAS\b/, 'TEXAS'], [/\bCOLORADO\b/, 'COLORADO'], [/\bLAS VEGAS\b/, 'LAS VEGAS'], [/\bLOS ANGELES\b/, 'LOS ANGELES'],
  [/\b(SN|SAN) FRANCISCO\b/, 'SAN FRANCISCO'], [/\bLAGUNILLA\b/, 'RIO LAGUNILLA'], [/\bMEDINA\b/, 'RIO MEDINA'],
  [/\bABURRA\b/, 'VALLE DE ABURRA'], [/\bSAN ANTONIO\b/, 'SAN ANTONIO'], [/\bSANTORINI\b/, 'MAR SANTORINI'], [/\bCANARIAS\b/, 'MAR CANARIAS'],
];

/** Terreno (y sector) que la IA dice haber leído en la imagen del lead. */
export function readLotFromAiText(aiText: string): { terreno: string; sector: string | null } | null {
  const t = norm(aiText);
  const m = t.match(/\bTERRENO (?:MARCADO |SENALADO |QUE MARCO )?(?:ES )?(?:EL )?(?:NUMERO |NO |N )?(\d{1,3})\b/);
  if (!m) return null;
  const sector = SECTOR_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
  return { terreno: String(Number(m[1])), sector };
}

/** El último mensaje de la IA invita a elegir un terreno (y no es una lista de horarios). */
function aiAskedForLot(lastAiText: string, lastAiOrigin?: string): boolean {
  if (lastAiOrigin === 'ai_plano') return true;
  const t = norm(lastAiText);
  return /\b(TERRENOS?|LOTES?)\b/.test(t) && !/\bHORARIOS?\b/.test(t);
}

/** Recorre la conversación (en orden) y deduce el estado de la cotización. */
export function deriveQuoteState(turns: ChatTurn[]): QuoteState {
  const state: QuoteState = {
    terreno: null, color: null, sectorHint: null, pago: null, quoted: false, planoSent: false,
    lotThisTurn: false, paymentThisTurn: false,
  };
  let lastAiText = '';
  let lastAiOrigin: string | undefined;
  let lastLeadImage = false;
  turns.forEach((turn, i) => {
    const isLast = i === turns.length - 1;
    if (turn.from === 'ai') {
      if (turn.origin === 'ai_plano') { state.planoSent = true; state.terreno = null; state.color = null; state.quoted = false; }
      if (turn.origin === 'ai_cotizacion') state.quoted = true;
      // El lead mandó el plano marcado: la IA lo leyó ("El terreno marcado es el número 09, sector Lagunilla").
      if (lastLeadImage && state.planoSent) {
        const read = readLotFromAiText(turn.text);
        if (read && read.terreno !== state.terreno) {
          state.terreno = read.terreno; state.color = null; state.sectorHint = read.sector; state.quoted = false;
        }
      }
      lastLeadImage = false;
      if (turn.text.trim() || turn.origin) { lastAiText = turn.text; lastAiOrigin = turn.origin; }
      return;
    }
    if (isLast) { state.lotThisTurn = false; state.paymentThisTurn = false; }
    lastLeadImage = !!turn.hasImage;
    const payment = parsePaymentReply(turn.text, lastAiText);
    if (payment) {
      if (payment.pago !== state.pago || payment.meses !== state.meses) state.quoted = false;
      state.pago = payment.pago;
      state.meses = payment.meses;
      if (isLast) state.paymentThisTurn = true;
      return;
    }
    const lot = state.planoSent && aiAskedForLot(lastAiText, lastAiOrigin) ? parseLotReply(turn.text) : null;
    if (lot) {
      if (lot.terreno !== state.terreno) state.quoted = false;
      state.terreno = lot.terreno;
      state.color = lot.color;
      state.sectorHint = null;
      if (isLast) state.lotThisTurn = true;
    }
  });
  return state;
}

/** Respuesta corta de seguimiento ("ok", "sí", "listo", "y el precio?"). */
export function isShortFollowUp(text: string): boolean {
  const t = norm(text);
  if (/\b(PRECIO|VALOR|COTIZACION|CUANTO|COSTO)\b/.test(t)) return true;
  return /^(SI|SII|OK|OKEY|OKAY|DALE|LISTO|CLARO|CORRECTO|ESO|PERFECTO|DE ACUERDO|BUENO|VALE|GRACIAS|SI SENOR|SI SENORA|SI POR FAVOR|AJA|EXACTO|ESE)( [A-Z]+)?$/.test(t);
}

// ── Inventario del terreno nombrado ────────────────────────────────────────────

const CLUB_SECTORS: Record<string, string[]> = {
  'cañon-arizona': ['TEXAS', 'COLORADO', 'LAS VEGAS', 'LOS ANGELES', 'SAN FRANCISCO'],
  'rio-claro':     ['RIO LAGUNILLA', 'RIO MEDINA'],
  'llano-grande':  ['VALLE DE ABURRA', 'SAN ANTONIO'],
  'laguna-mar':    ['MAR SANTORINI', 'MAR CANARIAS'],
};

const SECTOR_LABELS: Record<string, string> = {
  'TEXAS': 'Texas', 'COLORADO': 'Colorado', 'LAS VEGAS': 'Las Vegas', 'LOS ANGELES': 'Los Angeles',
  'SAN FRANCISCO': 'San Francisco', 'RIO LAGUNILLA': 'Lagunilla', 'RIO MEDINA': 'Medina',
  'VALLE DE ABURRA': 'Valle de Aburrá', 'SAN ANTONIO': 'San Antonio',
  'MAR SANTORINI': 'Mar Santorini', 'MAR CANARIAS': 'Mar Canarias',
};

export const sectorLabelOf = (sector: string): string => SECTOR_LABELS[sector] ?? sector;

/** Sector según el color del plano (solo clubes donde el color define el sector). */
function sectorByColor(club: string, color: string | null): string | null {
  if (!color) return null;
  if (club === 'cañon-arizona') {
    if (/ROJO|VINO/.test(color)) return 'LOS ANGELES';
    if (color === 'AZUL OSCURO') return 'COLORADO';
    if (/AZUL/.test(color)) return 'TEXAS';
    if (color === 'NARANJA') return 'LAS VEGAS';
    if (color === 'AMARILLO') return 'SAN FRANCISCO';
  }
  if (club === 'rio-claro') {
    if (/AZUL/.test(color)) return 'RIO LAGUNILLA';
    if (color === 'VERDE') return 'RIO MEDINA';
  }
  return null;
}

/** Sector de la etapa del plano de Laguna Mar ("Mar Santorini"). */
function sectorByStage(stageName: string | null | undefined): string | null {
  const s = norm(stageName);
  if (/SANTORINI/.test(s)) return 'MAR SANTORINI';
  if (/CANARIAS/.test(s)) return 'MAR CANARIAS';
  return null;
}

const isAvailable = (lot: InventoryLot) => norm(lot.s || 'DISPONIBLE') === 'DISPONIBLE';
const lotNum = (lot: InventoryLot) => Number(norm(lot.n).replace(/\s+/g, ''));

export type LotCheck =
  | { kind: 'found'; sector: string; available: boolean; status: string; area?: number; nearby: string[] }
  | { kind: 'ambiguous'; options: Array<{ sector: string; available: boolean }> }
  | { kind: 'missing'; nearby: string[] };

/** Disponibles más cercanos al número pedido, dentro del sector. */
function nearbyAvailable(lots: InventoryLot[], sectors: string[], terreno: string, max = 6): string[] {
  const target = Number(terreno);
  return lots
    .filter((l) => sectors.includes(norm(l.sec)) && isAvailable(l) && Number.isFinite(lotNum(l)))
    .sort((a, b) => Math.abs(lotNum(a) - target) - Math.abs(lotNum(b) - target) || lotNum(a) - lotNum(b))
    .slice(0, max)
    .map((l) => String(lotNum(l)))
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * Busca el terreno en el inventario del club del plano: el sector sale de la etapa del
 * plano (Laguna Mar), del color (Cañón, Río Claro) o del número; si el número existe en
 * varios sectores y solo uno está disponible, es ese.
 */
export function checkLotInInventory(
  lots: InventoryLot[],
  club: string,
  stageName: string | null | undefined,
  terreno: string,
  color: string | null,
  sectorHint: string | null = null
): LotCheck | null {
  const sectors = CLUB_SECTORS[club];
  if (!sectors) return null;
  const hinted = sectorHint && sectors.includes(sectorHint) ? sectorHint : null;
  const preferred = hinted ?? (club === 'laguna-mar' ? sectorByStage(stageName) : sectorByColor(club, color));
  const pool = preferred ? [preferred] : sectors;
  const candidates = lots.filter((l) => pool.includes(norm(l.sec)) && String(lotNum(l)) === String(Number(terreno)));
  if (candidates.length === 0) return { kind: 'missing', nearby: nearbyAvailable(lots, pool, terreno) };
  let pick: InventoryLot | null = candidates.length === 1 ? candidates[0] : null;
  if (!pick) {
    const available = candidates.filter(isAvailable);
    if (available.length === 1) pick = available[0];
  }
  if (!pick) {
    return { kind: 'ambiguous', options: candidates.map((l) => ({ sector: norm(l.sec), available: isAvailable(l) })) };
  }
  const sector = norm(pick.sec);
  const available = isAvailable(pick);
  return {
    kind: 'found', sector, available, status: norm(pick.s || 'DISPONIBLE'),
    area: pick.a || undefined,
    nearby: available ? [] : nearbyAvailable(lots, [sector], terreno),
  };
}

/** Nota de sistema para la IA con el resultado del inventario. */
export function lotCheckNote(check: LotCheck, terreno: string, clubLabel: string): string {
  if (check.kind === 'found') {
    const where = `el terreno ${terreno} de ${sectorLabelOf(check.sector)} (${clubLabel})`;
    if (check.available) {
      return `INVENTARIO: ${where} está DISPONIBLE${check.area ? ` (${Math.round(check.area)} m²)` : ''}. ` +
        'Si el lead aún no eligió forma de pago, pregúntasela; si ya la eligió, cotiza.';
    }
    return `INVENTARIO: ${where} NO está disponible (${check.status.toLowerCase()}). Díselo con amabilidad y ofrécele estos disponibles cercanos del mismo sector: ` +
      `${check.nearby.join(', ') || 'revisa el plano'}. NO le preguntes la forma de pago de un terreno que no está disponible.`;
  }
  if (check.kind === 'ambiguous') {
    const opts = check.options.map((o) => `${sectorLabelOf(o.sector)} (${o.available ? 'disponible' : 'no disponible'})`).join(' y ');
    return `INVENTARIO: el número ${terreno} existe en ${opts} de ${clubLabel}. Pregúntale al lead cuál es (por el color o sector del plano).`;
  }
  return `INVENTARIO: el terreno ${terreno} no aparece en el plano de ${clubLabel}. Pídele que confirme el número${check.nearby.length ? `; disponibles cercanos: ${check.nearby.join(', ')}` : ''}.`;
}
