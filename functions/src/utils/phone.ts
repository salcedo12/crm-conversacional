/**
 * Normaliza números de teléfono.
 * Twilio envía: "whatsapp:+573213443603"
 * El sistema almacena: "+573213443603"
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/^whatsapp:/i, '').trim();
}

/** Convierte a formato Twilio: "whatsapp:+573213443603" */
export function toTwilioPhone(phone: string): string {
  const clean = normalizePhone(phone);
  return `whatsapp:${clean}`;
}

/**
 * Versión lowercase sin caracteres especiales para buscar
 * sin colisiones (e.g. "+57" vs "0057").
 * Mantiene el "+" para E.164.
 */
export function toNormalizedPhone(phone: string): string {
  return normalizePhone(phone).toLowerCase();
}

/**
 * Últimos 9 dígitos del teléfono, para deduplicar a la MISMA persona aunque el
 * indicativo difiera. Caso típico: el formulario de Meta guarda el número con un
 * indicativo distinto (+1 3204720106) y por WhatsApp llega con el real
 * (+57 3204720106) → mismo `phoneTail`. Se usan 9 (no 10) para cubrir también
 * España (número nacional de 9 dígitos, p.ej. +34 612345678). Colombia (10
 * dígitos, siempre inician en 3) no colisiona: el 9º dígito ya identifica único.
 * Devuelve '' si hay <9 dígitos.
 */
export function phoneTail(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}
