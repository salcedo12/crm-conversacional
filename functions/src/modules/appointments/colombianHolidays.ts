/**
 * Festivos de Colombia calculados automáticamente.
 *
 * Incluye los 18 festivos nacionales: fijos, los que se trasladan al lunes
 * siguiente (Ley Emiliani 51/1983) y los basados en la Pascua.
 * Cada festivo tiene una `key` estable (no cambia de año a año) para poder
 * marcar "se trabaja" de forma recurrente.
 */

export interface ColombianHoliday {
  key:  string;  // identificador estable, ej. 'dia_raza'
  name: string;  // nombre legible
  date: string;  // 'YYYY-MM-DD' del año consultado
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Traslada al lunes siguiente si no cae en lunes (Ley Emiliani). */
function nextMonday(d: Date): Date {
  const day = d.getUTCDay();
  return addDays(d, (8 - day) % 7);
}

/** Domingo de Pascua (algoritmo de Butcher/Meeus). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const listCache = new Map<number, ColombianHoliday[]>();
const dateMapCache = new Map<number, Map<string, string>>(); // date → key

function computeList(year: number): ColombianHoliday[] {
  const D = (mo: number, da: number) => new Date(Date.UTC(year, mo - 1, da));
  const easter = easterSunday(year);
  const items: ColombianHoliday[] = [];
  const add = (key: string, name: string, date: Date) => items.push({ key, name, date: ymd(date) });

  // Fijos
  add('ano_nuevo',      'Año Nuevo',              D(1, 1));
  add('dia_trabajo',    'Día del Trabajo',        D(5, 1));
  add('independencia',  'Independencia',          D(7, 20));
  add('batalla_boyaca', 'Batalla de Boyacá',      D(8, 7));
  add('inmaculada',     'Inmaculada Concepción',  D(12, 8));
  add('navidad',        'Navidad',                D(12, 25));

  // Trasladables al lunes (Ley Emiliani)
  add('reyes',                   'Reyes Magos',                 nextMonday(D(1, 6)));
  add('san_jose',                'San José',                    nextMonday(D(3, 19)));
  add('san_pedro_pablo',         'San Pedro y San Pablo',       nextMonday(D(6, 29)));
  add('asuncion',                'Asunción de la Virgen',       nextMonday(D(8, 15)));
  add('dia_raza',                'Día de la Raza',              nextMonday(D(10, 12)));
  add('todos_santos',            'Todos los Santos',            nextMonday(D(11, 1)));
  add('independencia_cartagena', 'Independencia de Cartagena',  nextMonday(D(11, 11)));

  // Basados en la Pascua
  add('jueves_santo',    'Jueves Santo',         addDays(easter, -3));
  add('viernes_santo',   'Viernes Santo',        addDays(easter, -2));
  add('ascension',       'Ascensión del Señor',  nextMonday(addDays(easter, 39)));
  add('corpus_christi',  'Corpus Christi',       nextMonday(addDays(easter, 60)));
  add('sagrado_corazon', 'Sagrado Corazón',      nextMonday(addDays(easter, 68)));

  return items.sort((x, y) => x.date.localeCompare(y.date));
}

/** Lista de festivos del año (con nombre y fecha), memoizada y ordenada. */
export function getColombianHolidayList(year: number): ColombianHoliday[] {
  let list = listCache.get(year);
  if (!list) { list = computeList(year); listCache.set(year, list); }
  return list;
}

function dateMap(year: number): Map<string, string> {
  let m = dateMapCache.get(year);
  if (!m) {
    m = new Map(getColombianHolidayList(year).map((h) => [h.date, h.key]));
    dateMapCache.set(year, m);
  }
  return m;
}

/** Si la fecha es festivo nacional, devuelve su `key`; si no, `null`. */
export function colombianHolidayKey(dateStr: string): string | null {
  const year = Number(dateStr.slice(0, 4));
  if (!year) return null;
  return dateMap(year).get(dateStr) ?? null;
}

/** ¿La fecha 'YYYY-MM-DD' es festivo en Colombia? */
export function isColombianHoliday(dateStr: string): boolean {
  return colombianHolidayKey(dateStr) !== null;
}
