import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { logger }          from '../utils/logger';
import { sendTextToLeadChannel, sendMediaToLeadChannel } from '../modules/messages/outboundText.service';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { messagesRepository } from '../modules/messages/messages.repository';
import { describeSendError }  from '../utils/sendError';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';

const SendMessageSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  content:   z.string().max(1600).default(''),
  // Media opcional — Firebase serializa undefined como null, usamos nullish()
  mediaUrl:  z.string().url().nullish(),
  mediaType: z.string().nullish(),
}).refine(
  (d) => (d.content?.trim().length ?? 0) > 0 || !!d.mediaUrl,
  { message: 'Se requiere content o mediaUrl' }
);

/**
 * Callable Function: envía un mensaje manual desde el CRM al lead, por el canal
 * que corresponda (WhatsApp/YCloud, Messenger o Instagram Direct — ver `lead.channel`).
 *
 * Responsabilidades:
 * 1. (Fase 1) Validar usuario autenticado — actualmente permisivo hasta que se implemente Auth.
 * 2. Validar input con Zod.
 * 3. Verificar que el lead existe y pertenece a la empresa.
 * 4. Enviar mensaje por el canal del lead (sendTextToLeadChannel/sendMediaToLeadChannel).
 * 5. Guardar mensaje en Firestore como senderType: 'advisor'.
 * 6. Actualizar lastMessage del lead.
 *
 * El frontend NUNCA envía directamente a WhatsApp/Meta — siempre pasa por esta Function.
 */
export const sendManualMessage = onCall(
  {
    region:         'us-central1',
    timeoutSeconds: 60,
    memory:         '256MiB',
  },
  async (request) => {
    // ── Auth: usuario autenticado, con empresa, y rol con permiso de escritura ──
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    // ── Validar input ─────────────────────────────────────────────────────────
    const parseResult = SendMessageSchema.safeParse(request.data);
    if (!parseResult.success) {
      const errs = JSON.stringify(parseResult.error.flatten());
      logger.warn('[ManualMessage] Validación fallida', { errors: errs, data: request.data });
      throw new HttpsError('invalid-argument', `Datos inválidos: ${errs}`);
    }

    const { companyId, leadId, content, mediaUrl, mediaType } = parseResult.data;

    // Impedir operar sobre datos de otra empresa
    assertCompany(ctx, companyId);

    // ── Verificar lead ────────────────────────────────────────────────────────
    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) {
      throw new HttpsError('not-found', 'Lead no encontrado.');
    }

    const now        = Timestamp.now();
    const advisorId  = ctx.uid;

    let externalMsgId: string | undefined;
    try {
      if (mediaUrl && mediaType) {
        const r = await sendMediaToLeadChannel(lead, mediaUrl, mediaType, content || undefined);
        externalMsgId = r.externalMsgId;
      } else {
        const r = await sendTextToLeadChannel(lead, content);
        externalMsgId = r.externalMsgId;
      }
    } catch (err) {
      logger.error('[ManualMessage] Error enviando mensaje', {
        leadId,
        via:   lead.channel ?? 'whatsapp',
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', describeSendError(err));
    }

    // ── Guardar mensaje en Firestore ─────────────────────────────────────────
    const message = await messagesRepository.create({
      companyId,
      leadId,
      direction:        'outbound',
      senderType:       'advisor',
      content,
      channel:          lead.channel ?? 'whatsapp',
      status:           'sent',
      twilioMessageSid: externalMsgId,
      advisorId,
      ...(mediaUrl  ? { mediaUrl }  : {}),
      ...(mediaType ? { mediaType } : {}),
      createdAt:        now,
    });

    // ── Actualizar lastMessage del lead ──────────────────────────────────────
    const mt = mediaType ?? '';
    const previewText = content.trim() || (mt.startsWith('image') ? '📷 Imagen' : mt.startsWith('video') ? '🎥 Video' : mt.startsWith('audio') ? '🎵 Audio' : '📎 Archivo');
    await leadsRepository.update(companyId, leadId, {
      lastMessageText: previewText,
      lastMessageAt:   now,
    });

    logger.info('[ManualMessage] Mensaje enviado', {
      leadId,
      messageId: message.id,
      advisorId,
    });

    return { messageId: message.id, status: 'sent' };
  }
);
