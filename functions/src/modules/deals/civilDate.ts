import { numeroALetras } from './numeroALetras';

/**
 * Fechas civiles 'YYYY-MM-DD' del plan de pagos y los contratos. Se manejan como
 * año/mes/día sin hora para que nunca se corran un día por la zona horaria.
 */

export interface CivilDate {
  year:  number;
  month: number;   // 1-12
  day:   number;
}

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseCivilDate(value: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Fecha inválida (se espera YYYY-MM-DD): ${value}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > diasDelMes(year, month)) {
    throw new RangeError(`Fecha inválida: ${value}`);
  }
  return { year, month, day };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: CivilDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * Suma meses conservando el día; si el mes no lo tiene, usa el último día
 * (30 de enero + 1 mes = 28/29 de febrero). Calcular siempre desde la fecha
 * inicial (no encadenado) para que marzo vuelva al día 30.
 */
export function addMonths(value: string, months: number): string {
  const { year, month, day } = parseCivilDate(value);
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return toIsoDate({ year: nextYear, month: nextMonth, day: Math.min(day, diasDelMes(nextYear, nextMonth)) });
}

/** '30/05/2026' */
export function formatDMY(value: string): string {
  const { year, month, day } = parseCivilDate(value);
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** '06 DE FEBRERO DE 2026' (encabezado FECHA de la preventa). */
export function fechaCorta(value: string): string {
  const { year, month, day } = parseCivilDate(value);
  return `${pad(day)} DE ${MESES[month - 1].toUpperCase()} DE ${year}`;
}

export interface FechaEnLetras {
  dia:         string;  // '29'
  diaLetras:   string;  // 'veintinueve'
  mes:         string;  // '01'
  mesNombre:   string;  // 'enero'
  anio:        string;  // '2026'
  anioLetras:  string;  // 'dos mil veintiséis'
  /** 'a los veintinueve (29) días del mes de enero (01) del año dos mil veintiséis (2026)' */
  texto:       string;
}

export function fechaEnLetras(value: string): FechaEnLetras {
  const { year, month, day } = parseCivilDate(value);
  const diaLetras = day === 1 ? 'primer' : numeroALetras(day, true);
  const mesNombre = MESES[month - 1];
  const anioLetras = numeroALetras(year);
  const inicio = day === 1 ? `al primer (01) día` : `a los ${diaLetras} (${pad(day)}) días`;
  return {
    dia: pad(day),
    diaLetras,
    mes: pad(month),
    mesNombre,
    anio: String(year),
    anioLetras,
    texto: `${inicio} del mes de ${mesNombre} (${pad(month)}) del año ${anioLetras} (${year})`,
  };
}
