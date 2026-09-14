import { env } from '../../config/env';

/**
 * Resuelve la zona horaria aproximada de un lead a partir del prefijo
 * internacional de su número (E.164) para llamarlo solo en horario diurno de SU
 * país y evitar quejas por llamadas a deshoras.
 *
 * Limitación conocida: países con múltiples husos (EE.UU./Canadá con +1, Brasil,
 * México) se mapean a una zona representativa; no se afina por lada/área. Para el
 * mercado objetivo (LATAM, mayormente un huso por país) es suficiente. Si el
 * prefijo no se reconoce, se cae a la zona por defecto de la empresa.
 */

// Prefijos ordenados por longitud (se prueba el más largo primero para no
// confundir +1 con +1809, o +5 con +57).
const CALLING_CODE_TZ: Record<string, string> = {
  // ── 3 dígitos ──
  '593': 'America/Guayaquil',      // Ecuador
  '591': 'America/La_Paz',         // Bolivia
  '595': 'America/Asuncion',       // Paraguay
  '598': 'America/Montevideo',     // Uruguay
  '507': 'America/Panama',         // Panamá
  '506': 'America/Costa_Rica',     // Costa Rica
  '502': 'America/Guatemala',      // Guatemala
  '503': 'America/El_Salvador',    // El Salvador
  '504': 'America/Tegucigalpa',    // Honduras
  '505': 'America/Managua',        // Nicaragua
  '351': 'Europe/Lisbon',          // Portugal
  // ── 2 dígitos ──
  '57': 'America/Bogota',          // Colombia
  '52': 'America/Mexico_City',     // México
  '51': 'America/Lima',            // Perú
  '56': 'America/Santiago',        // Chile
  '54': 'America/Argentina/Buenos_Aires', // Argentina
  '58': 'America/Caracas',         // Venezuela
  '53': 'America/Havana',          // Cuba
  '55': 'America/Sao_Paulo',       // Brasil
  '34': 'Europe/Madrid',           // España
  '44': 'Europe/London',           // Reino Unido
  '39': 'Europe/Rome',             // Italia
  '49': 'Europe/Berlin',           // Alemania
  '33': 'Europe/Paris',            // Francia
  // ── 1 dígito ──
  '1': 'America/New_York',         // EE.UU./Canadá (zona representativa)
};

const SORTED_CODES = Object.keys(CALLING_CODE_TZ).sort((a, b) => b.length - a.length);

/** Zona IANA estimada para un teléfono E.164. Cae a la zona de la empresa si no se reconoce. */
export function timezoneForPhone(phone: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  for (const code of SORTED_CODES) {
    if (digits.startsWith(code)) return CALLING_CODE_TZ[code];
  }
  return env.calendarTimeZone();
}

/** Hora local (0–23) del lead según su país, para la fecha dada. */
export function localHourForPhone(phone: string, date: Date): number {
  const tz = timezoneForPhone(phone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  return Number(hour);
}

/** ¿La hora local del lead está dentro de [startHour, endHour)? */
export function isWithinCallWindow(
  phone: string,
  date: Date,
  startHour: number,
  endHour: number
): boolean {
  const h = localHourForPhone(phone, date);
  return h >= startHour && h < endHour;
}

/**
 * Próximo instante (>= from) en el que la ventana diurna del lead está abierta.
 * Si `from` ya está dentro de la ventana, devuelve `from`. Busca en pasos de 15
 * min hasta 4 días adelante (tope de seguridad); si no encuentra, devuelve `from`.
 */
export function nextCallWindowOpen(
  phone: string,
  from: Date,
  startHour: number,
  endHour: number
): Date {
  const STEP_MS = 15 * 60_000;
  const MAX_STEPS = (4 * 24 * 60) / 15; // 4 días
  let t = from.getTime();
  for (let i = 0; i < MAX_STEPS; i++) {
    if (isWithinCallWindow(phone, new Date(t), startHour, endHour)) return new Date(t);
    t += STEP_MS;
  }
  return from;
}
