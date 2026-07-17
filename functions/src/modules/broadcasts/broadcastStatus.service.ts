import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { broadcastsRepository } from './broadcasts.repository';
import { messagesRepository } from '../messages/messages.repository';
import type { MessageStatus } from '../messages/messages.types';

type RecipientStatus = 'sent' | 'delivered' | 'read' | 'undelivered';

function mapProviderStatus(status: string): RecipientStatus | null {
  const value = status.toLowerCase();
  if (['read'].includes(value)) return 'read';
  if (['delivered'].includes(value)) return 'delivered';
  if (['failed', 'undelivered', 'error', 'rejected'].includes(value)) return 'undelivered';
  if (['sent', 'queued', 'accepted'].includes(value)) return 'sent';
  return null;
}

function counterDelta(previous: RecipientStatus | undefined, next: RecipientStatus): Record<string, FieldValue> {
  const delta: Record<string, FieldValue> = {};
  if (previous === next) return delta;

  if (previous === 'delivered') delta.delivered = FieldValue.increment(-1);
  if (previous === 'read') delta.read = FieldValue.increment(-1);
  if (previous === 'undelivered') delta.undelivered = FieldValue.increment(-1);

  if (next === 'delivered') delta.delivered = FieldValue.increment(1);
  if (next === 'read') delta.read = FieldValue.increment(1);
  if (next === 'undelivered') delta.undelivered = FieldValue.increment(1);

  return delta;
}

export async function updateBroadcastDeliveryStatus(
  companyId: string,
  externalMsgId: string,
  providerStatus: string
): Promise<boolean> {
  const next = mapProviderStatus(providerStatus);
  if (!next) return false;

  const found = await broadcastsRepository.findRecipientByExternalMsgId(companyId, externalMsgId);
  if (!found) return false;

  const recipient = found.data as {
    broadcastId?: string;
    leadId?: string;
    status?: RecipientStatus;
  };
  if (!recipient.broadcastId || !recipient.leadId) return false;
  const broadcastId = recipient.broadcastId;
  const leadId = recipient.leadId;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(found.ref);
    if (!snap.exists) return;
    const current = snap.data() as { status?: RecipientStatus };
    const previous = current.status;
    if (previous === next) return;

    tx.update(found.ref, {
      status: next,
      updatedAt: Timestamp.now(),
      ...(next === 'delivered' ? { deliveredAt: Timestamp.now() } : {}),
      ...(next === 'read' ? { readAt: Timestamp.now() } : {}),
      ...(next === 'undelivered' ? { undeliveredAt: Timestamp.now() } : {}),
    });

    const broadcastRef = db
      .collection('companies').doc(companyId)
      .collection('broadcasts').doc(broadcastId);
    tx.update(broadcastRef, {
      ...counterDelta(previous, next),
      updatedAt: Timestamp.now(),
    });
  });

  await messagesRepository.updateByTwilioSid(companyId, leadId, externalMsgId, {
    status: next === 'undelivered' ? 'failed' : next as MessageStatus,
  });

  return true;
}
