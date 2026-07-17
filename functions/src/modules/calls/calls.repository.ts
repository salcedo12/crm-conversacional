import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Call, CreateCallInput } from './calls.types';

// Ruta: companies/{companyId}/leads/{leadId}/calls
const col = (companyId: string, leadId: string) =>
  db
    .collection('companies').doc(companyId)
    .collection('leads').doc(leadId)
    .collection('calls');

export const callsRepository = {
  async create(input: CreateCallInput): Promise<Call> {
    const ref = col(input.companyId, input.leadId).doc();
    await ref.set(input);
    return { id: ref.id, ...input };
  },

  async findById(companyId: string, leadId: string, callId: string): Promise<Call | null> {
    const snap = await col(companyId, leadId).doc(callId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as Call;
  },

  /** Ruta cruda del doc, para transacciones (ej. reclamar una llamada entrante). */
  ref(companyId: string, leadId: string, callId: string): FirebaseFirestore.DocumentReference {
    return col(companyId, leadId).doc(callId);
  },

  /** Busca una llamada por el ID externo de Dapta/ycloud (idempotencia del webhook). */
  async findByExternalId(
    companyId: string,
    leadId:    string,
    externalId: string
  ): Promise<Call | null> {
    const snap = await col(companyId, leadId)
      .where('externalId', '==', externalId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Call;
  },

  /**
   * Busca la llamada de Dapta más reciente en estado 'initiated' (marcando) de
   * un lead — respaldo cuando el webhook de resultado no trae un ID que
   * coincida con el externalId guardado al iniciar la llamada (Dapta no
   * siempre lo reenvía), para no crear un registro duplicado.
   */
  async findLatestInitiated(companyId: string, leadId: string): Promise<Call | null> {
    const snap = await col(companyId, leadId)
      .where('provider', '==', 'dapta')
      .where('status', '==', 'initiated')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Call;
  },

  async update(
    companyId: string,
    leadId:    string,
    callId:    string,
    input:     Partial<CreateCallInput>
  ): Promise<void> {
    await col(companyId, leadId).doc(callId).update({
      ...input,
      updatedAt: Timestamp.now(),
    });
  },
};
