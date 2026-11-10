import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { sendTextToLeadChannel, sendMediaToLeadChannel } from '../modules/messages/outboundText.service';
import { describeSendError } from '../utils/sendError';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

const Schema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  messageId: z.string().min(1),
});

/** Códigos donde reintentar no sirve: se explica en vez de reenviar. */
const NO_RETRY: Record<string, string> = {
  '131049': 'Meta frenó este mensaje por su límite de mensajes de marketing a este contacto. Reintentar no ayuda: espera a que el cliente escriba o usa una plantilla de utilidad.',
  '131047': 'Pasaron más de 24 horas desde el último mensaje del cliente. Envíale una plantilla aprobada para reabrir la conversación.',
  '131026': 'Este número no puede recibir el mensaje (no tiene WhatsApp, o tiene una versión que no lo admite).',
  '131050': 'El cliente pidió no recibir mensajes de marketing de esta línea.',
};

/**
 * Reenvía un mensaje saliente que quedó "No entregado" (p. ej. el error temporal 131000
 * de Meta). Usa el mismo texto o archivo y actualiza el mismo mensaje del chat, para que
 * el acuse de entrega del reintento lo marque como entregado o leído.
 */
export const retryFailedMessage = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const parsed = Schema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Datos incompletos para reintentar el mensaje.');
  const { companyId, leadId, messageId } = parsed.data;
  assertCompany(ctx, companyId);

  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
  if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Solo puedes reintentar mensajes de leads asignados a ti.');
  }

  const ref = db.doc(`companies/${companyId}/leads/${leadId}/messages/${messageId}`);
  const snap = await ref.get();
  const message = snap.data() as {
    direction?: string; status?: string; content?: string; failureCode?: string;
    twilioMessageSid?: string; mediaUrl?: string; mediaType?: string; fileName?: string;
    metadata?: { mediaUrl?: string; mediaType?: string; fileName?: string };
  } | undefined;
  if (!message || message.direction !== 'outbound') throw new HttpsError('not-found', 'Mensaje no encontrado.');
  if (message.status !== 'failed') throw new HttpsError('failed-precondition', 'Este mensaje no está marcado como no entregado.');
  const blocked = message.failureCode ? NO_RETRY[message.failureCode] : undefined;
  if (blocked) throw new HttpsError('failed-precondition', blocked);

  const mediaUrl  = message.mediaUrl ?? message.metadata?.mediaUrl;
  const mediaType = message.mediaType ?? message.metadata?.mediaType;
  const fileName  = message.fileName ?? message.metadata?.fileName;
  const content   = (message.content ?? '').trim();
  if (!mediaUrl && !content) throw new HttpsError('failed-precondition', 'El mensaje no tiene texto ni archivo para reenviar.');

  let externalMsgId: string | undefined;
  try {
    const sendLead = { ...lead, companyId };
    const result = mediaUrl && mediaType
      ? await sendMediaToLeadChannel(sendLead, mediaUrl, mediaType, content || undefined, fileName || undefined, ctx.uid)
      : await sendTextToLeadChannel(sendLead, content, ctx.uid);
    externalMsgId = result.externalMsgId;
  } catch (err) {
    logger.warn('[Retry] No se pudo reenviar el mensaje', { companyId, leadId, messageId, error: String(err) });
    throw new HttpsError('unavailable', describeSendError(err));
  }

  await ref.update({
    status: 'sent',
    ...(externalMsgId ? { twilioMessageSid: externalMsgId } : {}),
    ...(message.twilioMessageSid ? { previousMessageSids: FieldValue.arrayUnion(message.twilioMessageSid) } : {}),
    failureCode: FieldValue.delete(),
    failureReason: FieldValue.delete(),
    retryCount: FieldValue.increment(1),
    lastRetryAt: Timestamp.now(),
    lastRetryBy: ctx.uid,
    updatedAt: Timestamp.now(),
  });
  logger.info('[Retry] Mensaje reenviado', { companyId, leadId, messageId, externalMsgId });
  return { ok: true as const };
});
