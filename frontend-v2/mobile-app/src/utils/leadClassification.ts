import type { Lead } from '../types';

/** Fuente de los leads que escriben DIRECTO al WhatsApp del asesor (no por el 317). */
export const ADVISOR_WHATSAPP_SOURCE = 'advisor_whatsapp';

/** Etiqueta amigable de esa fuente para mostrar en la UI. */
export const ADVISOR_WHATSAPP_LABEL = 'WhatsApp asesor';

/**
 * ¿Este lead entró directo al WhatsApp de un asesor (NO por la línea 317)?
 * Se reconoce por la fuente propia o por la marca que dejó el bridge al reflejarlo
 * (esta última cubre los leads creados antes de introducir la fuente). Espejo del
 * predicado del backend: functions/src/modules/leads/leadClassification.ts.
 */
export function isDirectAdvisorLead(lead: Pick<Lead, 'source' | 'metadata'>): boolean {
  return lead.source === ADVISOR_WHATSAPP_SOURCE
    || lead.metadata?.advisorWhatsappMirror === 'true';
}

/** ¿Cuenta como dato del negocio? (para estadísticas del tablero). */
export function countsAsBusinessLead(lead: Pick<Lead, 'source' | 'metadata'>): boolean {
  return !isDirectAdvisorLead(lead);
}
