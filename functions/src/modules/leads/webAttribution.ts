/**
 * Utilidades compartidas de atribución de tráfico web (UTMs + click-ids).
 *
 * Las usan los DOS caminos por los que un lead puede llegar desde la página web:
 *   1. El FORMULARIO (leadWebhook → webLeadIntake): manda la atribución en el body.
 *   2. El BOTÓN de WhatsApp de la web: el sitio la mete como tag `[meraki-ref:…]`
 *      en el texto precargado y el ycloudWebhook la parsea.
 *
 * Así ambos caminos guardan los MISMOS campos de metadata y la ficha del lead
 * ("Origen del tráfico") los muestra igual.
 */

export type WebAttribution = Record<string, string | undefined>;

/**
 * A partir de la atribución (UTM/fbclid/gclid/referrer), deduce de dónde vino el
 * visitante en lenguaje simple para mostrarlo en el CRM.
 */
export function resolveTrafficOrigin(a: WebAttribution): string | undefined {
  const src = (a.utm_source ?? '').toLowerCase();
  const ref = (a.referrer ?? '').toLowerCase();
  const isMeta =
    !!a.fbclid ||
    ['facebook', 'fb', 'meta', 'instagram', 'ig'].some((s) => src.includes(s)) ||
    /facebook|instagram|fb\.com|l\.facebook/.test(ref);
  const isGoogle = !!a.gclid || src.includes('google') || /google\./.test(ref);
  if (isMeta)   return 'Meta (Facebook/Instagram)';
  if (isGoogle) return 'Google';
  if (a.utm_source) return a.utm_source;
  return undefined;
}

/**
 * Mapea la atribución cruda a las claves de `metadata` que lee la ficha del lead
 * (LeadDrawer → panel "Origen del tráfico"). Solo incluye lo que tenga valor.
 */
export function webAttributionToMetadata(a: WebAttribution): Record<string, string> {
  const meta: Record<string, string> = {};
  if (a.utm_source)   meta.webUtmSource   = a.utm_source;
  if (a.utm_medium)   meta.webUtmMedium   = a.utm_medium;
  if (a.utm_campaign) meta.webUtmCampaign = a.utm_campaign;
  if (a.utm_content)  meta.webUtmContent  = a.utm_content;
  if (a.utm_term)     meta.webUtmTerm     = a.utm_term;
  if (a.fbclid)       meta.webFbclid      = a.fbclid;
  if (a.gclid)        meta.webGclid       = a.gclid;
  if (a.referrer)     meta.webReferrer    = a.referrer;
  const cameFrom = resolveTrafficOrigin(a);
  if (cameFrom)       meta.webCameFrom    = cameFrom;
  return meta;
}

/**
 * Extrae y LIMPIA el tag de atribución `[meraki-ref: k=v&k=v]` que el botón de
 * WhatsApp de la web añade al texto precargado (solo cuando el visitante llegó de
 * una pauta). Un wa.me normal solo conserva el `text`, así que este tag es el
 * único canal para no perder el origen en el botón.
 *
 * Devuelve la atribución parseada y el texto SIN el tag (para no ensuciar el chat).
 */
export function parseWebRefTag(text: string): { attribution: WebAttribution; cleanText: string } {
  const m = text.match(/\[meraki-ref:\s*([^\]]*)\]/i);
  if (!m) return { attribution: {}, cleanText: text };

  const attribution: WebAttribution = {};
  const allowed = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'gclid', 'referrer',
  ]);
  for (const pair of (m[1] ?? '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (val && allowed.has(key)) attribution[key] = val.slice(0, 255);
  }

  // Quitar el tag (y espacios/saltos de línea que quedan colgando) del mensaje.
  const cleanText = text.replace(/\s*\[meraki-ref:[^\]]*\]\s*$/i, '').trim();
  return { attribution, cleanText };
}
