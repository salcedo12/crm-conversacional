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

export async function sendInboundLeadPush(companyId: string, lead: Lead, message: Message): Promise<void> {
  const advisorId = lead.assignedTo;
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
    webpush: {
      headers: { Urgency: 'high' },
    },
    data: {
      companyId,
      leadId: lead.id,
      type: 'inbound-message',
      title: `Nuevo mensaje de ${leadName(lead)}`,
      body: preview(message),
      url: `/dashboard/inbox?lead=${lead.id}`,
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

  logger.info('[Push] Notificacion inbound enviada', {
    companyId,
    leadId: lead.id,
    advisorId,
    successCount: response.successCount,
    failureCount: response.failureCount,
    staleCount: staleTokens.length,
  });
}
