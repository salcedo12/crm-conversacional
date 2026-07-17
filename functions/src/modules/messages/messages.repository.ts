import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Message, CreateMessageInput } from './messages.types';

// Ruta: companies/{companyId}/leads/{leadId}/messages
const col = (companyId: string, leadId: string) =>
  db
    .collection('companies').doc(companyId)
    .collection('leads').doc(leadId)
    .collection('messages');

export const messagesRepository = {
  async create(input: CreateMessageInput): Promise<Message> {
    const ref = col(input.companyId, input.leadId).doc();
    await ref.set(input);
    return { id: ref.id, ...input };
  },

  /**
   * Busca si ya existe un mensaje con ese MessageSid de Twilio.
   * Usado para idempotencia: si existe, el webhook fue duplicado.
   */
  async findByTwilioSid(
    companyId: string,
    leadId: string,
    sid: string
  ): Promise<boolean> {
    const snap = await col(companyId, leadId)
      .where('twilioMessageSid', '==', sid)
      .limit(1)
      .get();
    return !snap.empty;
  },

  async updateByTwilioSid(
    companyId: string,
    leadId: string,
    sid: string,
    input: Partial<CreateMessageInput>
  ): Promise<boolean> {
    const snap = await col(companyId, leadId)
      .where('twilioMessageSid', '==', sid)
      .limit(1)
      .get();

    if (snap.empty) return false;

    await snap.docs[0].ref.update({
      ...input,
      updatedAt: Timestamp.now(),
    });
    return true;
  },

  /**
   * Últimos N mensajes ordenados por createdAt ASC.
   * Se usan para construir el contexto de OpenAI.
   */
  async getRecent(
    companyId: string,
    leadId: string,
    limit: number = 20
  ): Promise<Message[]> {
    const snap = await col(companyId, leadId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Message))
      .reverse(); // Invertir para obtener orden ASC (cronológico)
  },

  /**
   * Marca el mensaje como ya procesado por la IA (idempotencia del trigger).
   */
  async markAiProcessed(
    companyId: string,
    leadId: string,
    messageId: string
  ): Promise<void> {
    await col(companyId, leadId).doc(messageId).update({
      aiProcessed: true,
      updatedAt:   Timestamp.now(),
    });
  },
};
