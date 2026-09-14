/**
 * Deduce el país de un teléfono E.164 a partir de su indicativo, para mostrar una
 * banderita en la bandeja e identificar de un vistazo de dónde escribe el lead.
 * Cubre LATAM + España + Norteamérica + algunos de Europa (los mercados típicos).
 */

// Indicativo → { ISO 3166 alfa-2, nombre en español }. Longest-prefix primero.
const CALLING_CODES: Record<string, { iso: string; name: string }> = {
  // Norteamérica (NANP) — se agrupa como EE.UU./Canadá
  '1':   { iso: 'US', name: 'EE.UU. / Canadá' },
  // LATAM
  '52':  { iso: 'MX', name: 'México' },
  '57':  { iso: 'CO', name: 'Colombia' },
  '51':  { iso: 'PE', name: 'Perú' },
  '58':  { iso: 'VE', name: 'Venezuela' },
  '56':  { iso: 'CL', name: 'Chile' },
  '54':  { iso: 'AR', name: 'Argentina' },
  '55':  { iso: 'BR', name: 'Brasil' },
  '593': { iso: 'EC', name: 'Ecuador' },
  '591': { iso: 'BO', name: 'Bolivia' },
  '595': { iso: 'PY', name: 'Paraguay' },
  '598': { iso: 'UY', name: 'Uruguay' },
  '507': { iso: 'PA', name: 'Panamá' },
  '506': { iso: 'CR', name: 'Costa Rica' },
  '502': { iso: 'GT', name: 'Guatemala' },
  '503': { iso: 'SV', name: 'El Salvador' },
  '504': { iso: 'HN', name: 'Honduras' },
  '505': { iso: 'NI', name: 'Nicaragua' },
  // Europa
  '34':  { iso: 'ES', name: 'España' },
  '351': { iso: 'PT', name: 'Portugal' },
  '44':  { iso: 'GB', name: 'Reino Unido' },
  '39':  { iso: 'IT', name: 'Italia' },
  '33':  { iso: 'FR', name: 'Francia' },
  '49':  { iso: 'DE', name: 'Alemania' },
};

/**
 * Devuelve el país del teléfono como código ISO (minúsculas, para la clase CSS de
 * flag-icons `fi fi-<iso>`) + nombre. Se usan imágenes SVG (flag-icons) y NO emojis
 * porque Windows no renderiza los emojis de bandera (muestra "CO", "ES"…).
 */
export function phoneCountry(phone?: string): { iso: string; name: string } | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  // Coincidencia por prefijo más largo (3 → 2 → 1 dígitos).
  for (const len of [3, 2, 1]) {
    const c = CALLING_CODES[digits.slice(0, len)];
    if (c) return { iso: c.iso.toLowerCase(), name: c.name };
  }
  return null;
}
