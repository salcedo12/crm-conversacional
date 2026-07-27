import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import { orchestrateAiResponse } from '../modules/ai/aiOrchestrator.service';
import { followUpsRepository } from '../modules/followups/followups.repository';
import { leadsRepository } from '../modules/leads/leads.repository';
import { sendInboundLeadPush } from '../modules/messages/pushNotifications.service';
import type { Message } from '../modules/messages/messages.types';

/**
 * Trigger de Firestore: se activa cuando se crea un nuevo mensaje.
 * Ruta: companies/{companyId}/leads/{leadId}/messages/{messageId}
 *
 * Responsabilidades:
 * 1. Verificar que el mensaje es inbound (del lead).
 * 2. Verificar que no fue ya procesado (aiProcessed: false).
 * 3. Llamar al orquestador de IA.
 *
 * Ventajas de este patrón sobre el background-work anterior:
 * - El webhook responde a Twilio en < 3 segundos (solo Firestore).
 * - Este trigger tiene su propio timeout de 300s para OpenAI.
 * - Firestore garantiza la entrega del evento (at-least-once).
 * - Si el trigger falla, el mensaje ya está en Firestore y el asesor puede responder manualmente.
 * - La idempotencia (aiProcessed) evita doble respuesta si el trigger se ejecuta dos veces.
 */
export const onMessageCreated = onDocumentCreated(
  {
    document:       'companies/{companyId}/leads/{leadId}/messages/{messageId}',
    region:         'us-central1',
    timeoutSeconds: 300,    // OpenAI puede tardar hasta ~60s con prompts largos
    memory:         '512MiB',
  },
  async (event) => {
    const { companyId, leadId, messageId } = event.params;
    const data = event.data?.data() as Message | undefined;

    if (!data) {
      logger.warn('[Trigger] Documento vacío', { companyId, leadId, messageId });
      return;
    }

    // Solo procesar mensajes inbound del lead
    if (data.direction !== 'inbound' || data.senderType !== 'lead') {
      return;
    }

    // Cancelar follow-ups pendientes: el lead respondió
    await followUpsRepository.cancelPendingForLead(companyId, leadId).catch((err) => {
      logger.warn('[Trigger] No se pudieron cancelar follow-ups', { leadId, err });
    });

    const lead = await leadsRepository.findById(companyId, leadId);
    if (lead) {
      await sendInboundLeadPush(companyId, lead, data).catch((err) => {
        logger.warn('[Trigger] No se pudo enviar push inbound', {
          companyId,
          leadId,
          messageId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Si ya fue procesado (idempotencia), saltar
    if (data.aiProcessed === true) {
      logger.info('[Trigger] Mensaje ya procesado — skipping', { messageId });
      return;
    }

    logger.info('[Trigger] Procesando mensaje inbound', {
      companyId,
      leadId,
      messageId,
      contentLength: data.content?.length,
    });

    await orchestrateAiResponse({
      companyId,
      leadId,
      messageId,
      userMessage: data.content ?? '',
      mediaUrl:   data.mediaUrl,
      mediaType:  data.mediaType,
    });
  }
);
