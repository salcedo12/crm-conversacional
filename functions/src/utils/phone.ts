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
