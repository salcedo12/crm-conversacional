import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db }     from '../lib/admin';
import { logger } from '../utils/logger';
import { sendReactionToLeadChannel } from '../modules/messages/outboundText.service';
import { leadsRepository } from '../modules/leads/leads.repository';
import { describeSendError } from '../utils/sendError';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

const ReactSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  messageId: z.string().min(1),
  // emoji vacío = quitar la reacción. Hasta 16 chars para cubrir emojis compuestos
  // (tono de piel, secuencias ZWJ como 🙏🏼).
  emoji:     z.string().max(16).default(''),
});

/**
 * Callable Function: el asesor reacciona (emoji) a un mensaje del lead, tal como
 * en WhatsApp. Envía la reacción por YCloud referenciando el wamid del mensaje
 * (guardado en `twilioMessageSid`) y la persiste en el propio doc del mensaje
 * (`reaction`) para mostrarla pegada a la burbuja. emoji vacío la quita.
 *
 * Solo se puede reaccionar a mensajes ENTRANTES del lead por WhatsApp.
 */
export const reactToMessage = onCall(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, messageId, emoji } = ReactSchema.parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes reaccionar a leads asignados a ti.');
    }

    if ((lead.channel ?? 'whatsapp') !== 'whatsapp') {
      throw new HttpsError('failed-precondition', 'Las reacciones solo están disponibles en WhatsApp.');
    }

    const msgRef = db
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) throw new HttpsError('not-found', 'Mensaje no encontrado.');

    const msg = msgSnap.data() as { direction?: string; twilioMessageSid?: string };
    if (msg.direction !== 'inbound') {
      throw new HttpsError('failed-precondition', 'Solo puedes reaccionar a mensajes del cliente.');
    }
    const wamid = msg.twilioMessageSid;
    if (!wamid) {
      throw new HttpsError('failed-precondition', 'Este mensaje no admite reacción (sin referencia de WhatsApp).');
    }

    try {
      await sendReactionToLeadChannel(lead, wamid, emoji);
    } catch (err) {
      logger.error('[ReactToMessage] Error enviando reacción', {
        leadId, messageId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', describeSendError(err));
    }

    const now = Timestamp.now();
    await msgRef.update(
      emoji
        ? { reaction: emoji, reactionBy: ctx.uid, reactionAt: now }
        : { reaction: FieldValue.delete(), reactionBy: FieldValue.delete(), reactionAt: FieldValue.delete() }
    );

    logger.info('[ReactToMessage] Reacción aplicada', {
      leadId, messageId, emoji: emoji || '(quitada)', by: ctx.uid,
    });
    return { ok: true };
  }
);
