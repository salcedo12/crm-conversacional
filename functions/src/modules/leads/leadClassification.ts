import type { Lead } from './leads.types';

/**
 * Fuente asignada a los leads que escriben DIRECTO al WhatsApp personal de un
 * asesor sin haber pasado por la línea principal (317). Ver [[advisorWhatsapp]].
 */
export const ADVISOR_WHATSAPP_SOURCE = 'advisor_whatsapp' as const;

/**
 * ¿Este lead entró directo al WhatsApp de un asesor (NO por la línea 317)?
 *
 * Se reconoce por dos señales, para cubrir también los leads creados ANTES de
 * introducir la fuente propia:
 *  - `source === 'advisor_whatsapp'` (leads nuevos y los ya reclasificados), o
 *  - `metadata.advisorWhatsappMirror === 'true'` (marca que el webhook del bridge
 *    siempre puso al crear el lead reflejado).
 *
 * Estos leads NO deben contar en las estadísticas del negocio (tablero, pauta,
 * informes) ni en el reparto/asignación de datos, pero SÍ siguen visibles en el
 * CRM y asignados a su asesor.
 */
export function isDirectAdvisorLead(lead: Pick<Lead, 'source' | 'metadata'>): boolean {
  if (lead.source === ADVISOR_WHATSAPP_SOURCE) return true;
  const meta = lead.metadata as { advisorWhatsappMirror?: unknown } | undefined;
  return meta?.advisorWhatsappMirror === 'true' || meta?.advisorWhatsappMirror === true;
}

/** Inverso de {@link isDirectAdvisorLead}: ¿este lead cuenta como dato del negocio? */
export function countsAsBusinessLead(lead: Pick<Lead, 'source' | 'metadata'>): boolean {
  return !isDirectAdvisorLead(lead);
}

/**
 * Fuentes que representan tráfico REAL a nuestra línea principal (317): la pauta
 * (anuncios click-to-WhatsApp y Meta Lead Ads → `meta_ads`), los formularios /
 * botón de la web (→ `web`) y el WhatsApp orgánico directo al 317 (→ `whatsapp`).
 *
 * Deja fuera Messenger/Instagram orgánico (`facebook`/`instagram`), los leads
 * creados a mano (`manual`) y el WhatsApp personal del asesor (`advisor_whatsapp`).
 */
export const LINE_317_SOURCES = new Set<Lead['source']>(['whatsapp', 'web', 'meta_ads']);

/**
 * ¿Este lead entró por la línea 317 (pauta, formulario o WhatsApp directo al 317)?
 *
 * Es una lista blanca más estricta que {@link countsAsBusinessLead}: se usa en el
 * informe por asesor y en el reparto/asignación de datos para medir SOLO nuestra
 * pauta/formularios al 317, sin contar otros canales.
 */
export function countsAs317LineLead(lead: Pick<Lead, 'source' | 'metadata'>): boolean {
  return !isDirectAdvisorLead(lead) && LINE_317_SOURCES.has(lead.source);
}
