import { db } from '../../lib/admin';
import type { Broadcast, CreateBroadcastInput } from './broadcasts.types';

// Ruta: companies/{companyId}/broadcasts
const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('broadcasts');

const recipientsCol = (companyId: string, broadcastId: string) =>
  col(companyId).doc(broadcastId).collection('recipients');

export const broadcastsRepository = {
  async create(companyId: string, input: CreateBroadcastInput): Promise<Broadcast> {
    const ref = col(companyId).doc();
    await ref.set(input);
    return { id: ref.id, ...input };
  },

  async findById(companyId: string, broadcastId: string): Promise<Broadcast | null> {
    const snap = await col(companyId).doc(broadcastId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as Broadcast;
  },

  async update(
    companyId: string,
    broadcastId: string,
    input: Partial<Omit<Broadcast, 'id'>>
  ): Promise<void> {
    await col(companyId).doc(broadcastId).update(input);
  },

  /** Últimos envíos masivos, más recientes primero. */
  async listRecent(companyId: string, limit = 50): Promise<Broadcast[]> {
    const snap = await col(companyId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Broadcast));
  },

  async listPending(companyId: string, limit = 3): Promise<Broadcast[]> {
    const snap = await col(companyId)
      .where('status', 'in', ['queued', 'processing'])
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Broadcast));
  },

  async getRecipient(companyId: string, broadcastId: string, leadId: string) {
    const snap = await recipientsCol(companyId, broadcastId).doc(leadId).get();
    return snap.exists ? snap.data() : null;
  },

  async findRecipientByExternalMsgId(companyId: string, externalMsgId: string) {
    const snap = await db
      .collectionGroup('recipients')
      .where('companyId', '==', companyId)
      .where('externalMsgId', '==', externalMsgId)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { ref: doc.ref, data: doc.data() };
  },

  async setRecipient(
    companyId: string,
    broadcastId: string,
    leadId: string,
    input: Record<string, unknown>
  ): Promise<void> {
    await recipientsCol(companyId, broadcastId).doc(leadId).set(input, { merge: true });
  },
};
