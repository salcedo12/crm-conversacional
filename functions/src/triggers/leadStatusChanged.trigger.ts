import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { sendConversionEvent } from '../integrations/meta/metaCapi.client';
import type { Lead, LeadStatus } from '../modules/leads/leads.types';

/**
 * Estado del lead → evento estándar de Meta que se envía como conversión.
 * Solo los estados que representan avance comercial real.
 */
const STATUS_EVENT: Partial<Record<LeadStatus, string>> = {
  qualified: 'Lead',      // lead calificado
  scheduled: 'Schedule',  // agendó cita
  closed:    'Purchase',  // venta cerrada
};

/**
 * Al cambiar el estado de un lead que vino de un anuncio "Click to WhatsApp",
 * devuelve la conversión a Meta (CAPI) usando su ctwa_clid. Así Meta aprende a
 * optimizar la pauta hacia gente que realmente agenda/cierra, no solo que abre
 * WhatsApp. Idempotente por lead + nombre de evento.
 */
export const onLeadStatusChanged = onDocumentUpdated(
  { document: 'companies/{companyId}/leads/{leadId}', region: 'us-central1' },
  async (event) => {
    if (!env.metaCapiConfigured()) return;

    const before = event.data?.before.data() as Lead | undefined;
    const after  = event.data?.after.data() as Lead | undefined;
    if (!before || !after) return;

    // Solo actuar cuando cambia el estado (el doc se actualiza por muchos motivos).
    if (before.status === after.status) return;

    const eventName = STATUS_EVENT[after.status];
    if (!eventName) return;

    // Sin ctwa_clid no hay forma de atribuir la conversión al anuncio.
    const ctwaClid = after.sourceMeta?.ctwaClid;
    if (!ctwaClid) return;

    // Idempotencia: no reenviar el mismo evento para este lead.
    if (after.capiEvents?.[eventName]) return;

    const { companyId, leadId } = event.params;

    const ok = await sendConversionEvent({
      eventName,
      ctwaClid,
      eventId: `${leadId}:${eventName}`,   // dedupe en Meta
    });

    if (!ok) return;  // se reintentará en el próximo cambio de estado; no se marca

    await event.data!.after.ref.update({
      [`capiEvents.${eventName}`]: Timestamp.now(),
    });

    logger.info('[CAPI] Conversión de lead enviada a Meta', {
      companyId, leadId, eventName, from: before.status, to: after.status,
    });
  }
);
