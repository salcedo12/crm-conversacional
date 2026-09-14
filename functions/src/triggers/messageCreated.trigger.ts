import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import { orchestrateAiResponse } from '../modules/ai/aiOrchestrator.service';
import { followUpsRepository } from '../modules/followups/followups.repository';
import { leadsRepository } from '../modules/leads/leads.repository';
import { sendInboundLeadPush } from '../modules/messages/pushNotifications.service';
import { recordMessageInLeadStats } from '../modules/leads/leadStats.service';
import { getYcloudConfigForCompany } from '../modules/companies/channelCredentials.repository';
import { normalizeBusinessNumber } from '../modules/whatsapp/inbox';
import type { Message } from '../modules/messages/messages.types';

const SALES_INBOX_PHONE = '+573176820728';

function metaString(message: Message, key: string): string | undefined {
  const value = message.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function shouldNotifyInbound(leadInboxId: string | undefined, message: Message): boolean {
  const deliveryChannel = metaString(message, 'deliveryChannel');
  const origin = metaString(message, 'origin');
  const businessPhone = metaString(message, 'businessPhone') ?? leadInboxId;

  if (deliveryChannel === 'advisor_whatsapp' || origin?.startsWith('advisor_whatsapp')) {
    return false;
  }

  return businessPhone === SALES_INBOX_PHONE;
}

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

    // Mantener los contadores denormalizados del lead (lead.stats) con CADA
    // mensaje, sin importar su tipo. Alimenta getAdvisorReports sin que este
    // tenga que releer los mensajes. No bloquea ni afecta el flujo de IA.
    await recordMessageInLeadStats(companyId, leadId, data);

    // Asociar la LÍNEA de la empresa a leads "salientes primero" (formulario web,
    // lead ads, contacto manual) que nunca recibieron un entrante y por eso no
    // tienen inboxId. Sin esto la burbuja del chat muestra "Sin número" en vez de
    // la línea real desde la que se envió (p. ej. "Ventas 317"). Usamos el mismo
    // fromNumber que YCloud usa para enviar, así que la etiqueta es exacta. No
    // aplica a la línea personal del asesor (esa se rotula "Mi WhatsApp").
    if (data.direction === 'outbound') {
      const deliveryChannel = metaString(data, 'deliveryChannel');
      const origin = metaString(data, 'origin');
      const isAdvisorPersonal =
        deliveryChannel === 'advisor_whatsapp' || origin?.startsWith('advisor_whatsapp');
      if (!isAdvisorPersonal) {
        const outboundLead = await leadsRepository.findById(companyId, leadId);
        if (outboundLead && !outboundLead.inboxId) {
          const line =
            normalizeBusinessNumber(metaString(data, 'businessPhone')) ??
            normalizeBusinessNumber((await getYcloudConfigForCompany(companyId)).fromNumber);
          if (line) {
            await leadsRepository.update(companyId, leadId, { inboxId: line }).catch((err) => {
              logger.warn('[Trigger] No se pudo fijar inboxId del lead saliente', {
                companyId, leadId, err: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      }
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
    if (lead && shouldNotifyInbound(lead.inboxId, data)) {
      await sendInboundLeadPush(companyId, lead, data).catch((err) => {
        logger.warn('[Trigger] No se pudo enviar push inbound', {
          companyId,
          leadId,
          messageId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    } else if (lead) {
      logger.info('[Trigger] Push inbound silenciado por canal', {
        companyId,
        leadId,
        messageId,
        inboxId: lead.inboxId,
        deliveryChannel: metaString(data, 'deliveryChannel'),
        origin: metaString(data, 'origin'),
        businessPhone: metaString(data, 'businessPhone'),
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
