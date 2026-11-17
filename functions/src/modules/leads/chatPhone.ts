/**
 * Celular colombiano escrito por el cliente en el chat ("302 2062481", "3022062481",
 * "+57 302-206-2481"). Se usa con los leads que entraron solo con usuario de WhatsApp
 * (sin número): si comparten su celular, el CRM lo guarda para que el asesor pueda
 * escribirle desde su propia línea sin que se cree otro lead.
 *
 * Devuelve el número en E.164 ("+573022062481") o '' si no hay uno claro. Para no
 * confundir precios con teléfonos, no acepta cifras con puntos/comas de miles
 * ("3.500.000.000") ni precedidas de "$".
 */
export function extractColombianMobile(text: string | undefined | null): string {
  if (!text) return '';
  const re = /(?<![\d$.,])(?:\+?\s?57[\s-]?)?\(?(3\d{2})\)?[\s-]?(\d{3})[\s-]?(\d{4})(?!\d)(?![.,]\d)/g;
  const found = new Set<string>();
  for (const m of text.matchAll(re)) found.add(`+57${m[1]}${m[2]}${m[3]}`);
  // Dos números distintos en el mismo mensaje: no se adivina cuál es el suyo.
  return found.size === 1 ? [...found][0] : '';
}
