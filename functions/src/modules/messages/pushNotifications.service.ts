import { createHash } from 'crypto';
import { db, messaging } from '../../lib/admin';
import { logger } from '../../utils/logger';
import type { Lead } from '../leads/leads.types';
import type { Message } from './messages.types';

interface PushTokenDoc {
  token: string;
}

function leadName(lead: Lead): string {
  return lead.name?.trim() || lead.phone || 'Lead';
}

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function preview(message: Message): string {
  const content = message.content?.trim();
  if (content) return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  if (message.mediaKind) return 'Archivo adjunto';
  return 'Nuevo mensaje entrante';
}

/**
 * Envía una notificación push a todos los dispositivos de un asesor.
 * Limpia tokens inválidos. Núcleo reutilizable (mensajes inbound, recordatorios…).
 */
export async function sendAdvisorPush(
  companyId: string,
  advisorId: string | undefined,
  payload: { title: string; body: string; url: string; type: string; leadId?: string }
): Promise<void> {
  if (!advisorId) return;

  const snap = await db
    .collection('companies').doc(companyId)
    .collection('users').doc(advisorId)
    .collection('pushTokens')
    .get();

  const tokens = snap.docs
    .map((doc) => (doc.data() as PushTokenDoc).token)
    .filter(Boolean);

  if (tokens.length === 0) return;

  const response = await messaging.sendEachForMulticast({
    tokens,
    webpush: { headers: { Urgency: 'high' } },
    data: {
      companyId,
      ...(payload.leadId ? { leadId: payload.leadId } : {}),
      type:  payload.type,
      title: payload.title,
      body:  payload.body,
      url:   payload.url,
    },
  });

  const staleTokens = response.responses
    .map((result, index) => ({ result, token: tokens[index] }))
    .filter(({ result }) => {
      const code = result.error?.code;
      return code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token';
    })
    .map(({ token }) => token);

  await Promise.all(staleTokens.map((token) =>
    db
      .collection('companies').doc(companyId)
      .collection('users').doc(advisorId)
      .collection('pushTokens').doc(tokenId(token))
      .delete()
      .catch(() => {})
  ));

  logger.info('[Push] Notificacion enviada', {
    companyId, advisorId, type: payload.type,
    successCount: response.successCount,
    failureCount: response.failureCount,
    staleCount: staleTokens.length,
  });
}

export async function sendInboundLeadPush(companyId: string, lead: Lead, message: Message): Promise<void> {
  await sendAdvisorPush(companyId, lead.assignedTo, {
    title:  `Nuevo mensaje de ${leadName(lead)}`,
    body:   preview(message),
    url:    `/dashboard/inbox?lead=${lead.id}`,
    type:   'inbound-message',
    leadId: lead.id,
  });
}
