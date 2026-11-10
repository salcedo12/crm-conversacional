/**
 * Números a letras en español de Colombia, como los escriben la preventa y la promesa:
 *   145.000.000 → "CIENTO CUARENTA Y CINCO MILLONES DE PESOS"
 *   2.241.950   → "DOS MILLONES DOSCIENTOS CUARENTA Y UN MIL NOVECIENTOS CINCUENTA PESOS"
 *
 * `apocope` = forma corta antes de sustantivo ("un", "veintiún") en vez de "uno", "veintiuno".
 */

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

function menorQueCien(n: number, apocope: boolean): string {
  if (n === 1) return apocope ? 'un' : 'uno';
  if (n === 21) return apocope ? 'veintiún' : 'veintiuno';
  if (n < 30) return UNIDADES[n];
  const unidad = n % 10;
  const decena = DECENAS[Math.floor(n / 10)];
  if (!unidad) return decena;
  return `${decena} y ${unidad === 1 ? (apocope ? 'un' : 'uno') : UNIDADES[unidad]}`;
}

function menorQueMil(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (centena) partes.push(CENTENAS[centena]);
  if (resto) partes.push(menorQueCien(resto, apocope));
  return partes.join(' ');
}

function menorQueMillon(n: number, apocope: boolean): string {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (miles === 1) partes.push('mil');
  else if (miles) partes.push(`${menorQueMil(miles, true)} mil`);
  if (resto) partes.push(menorQueMil(resto, apocope));
  return partes.join(' ');
}

/** Entero ≥ 0 hasta 999.999.999.999, en minúsculas. */
export function numeroALetras(n: number, apocope = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) {
    throw new RangeError(`numeroALetras: valor fuera de rango (${n})`);
  }
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const partes: string[] = [];
  if (millones === 1) partes.push('un millón');
  else if (millones) partes.push(`${menorQueMillon(millones, true)} millones`);
  if (resto) partes.push(menorQueMillon(resto, apocope));
  return partes.join(' ');
}

/** Valor en pesos en letras mayúsculas: "... MILLONES DE PESOS" si son millones exactos. */
export function pesosEnLetras(n: number): string {
  if (n === 1) return 'UN PESO';
  const letras = numeroALetras(n, true);
  const dePesos = n >= 1_000_000 && n % 1_000_000 === 0;
  return `${letras} ${dePesos ? 'de pesos' : 'pesos'}`.toUpperCase();
}

/** "$ 145.000.000" (separador de miles con punto, sin decimales). */
export function formatoPesos(n: number): string {
  const entero = Math.round(n);
  const signo = entero < 0 ? '-' : '';
  const digitos = String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${signo}$ ${digitos}`;
}
