import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Message, CreateMessageInput, MessageStatus } from './messages.types';

// Orden de avance del acuse de entrega. Un evento tardío (p.ej. `delivered`
// que llega después de `read`) NO debe hacer retroceder el estado mostrado.
// `failed` es terminal salvo que el mensaje ya se haya entregado/leído.
const STATUS_RANK: Record<MessageStatus, number> = {
  pending:   0,
  sent:      1,
  failed:    2,
  delivered: 3,
  read:      4,
};

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
   * Actualiza el estado de entrega de un mensaje saliente localizándolo por su
   * ID externo (wamid de WhatsApp, guardado en `twilioMessageSid`) SIN conocer
   * el lead — necesario para los webhooks de solo-estado, que a veces no traen
   * el teléfono del cliente. Usa una consulta `collectionGroup` porque el wamid
   * es único a nivel global.
   *
   * Aplica una guarda anti-retroceso: solo avanza el estado (sent → delivered →
   * read); un evento tardío nunca lo hace retroceder. Devuelve `true` si el
   * mensaje existía (aunque no se haya modificado por la guarda).
   */
  async updateStatusByExternalId(
    externalId: string | string[],
    nextStatus: MessageStatus,
    extra?: { failureReason?: string; failureCode?: string }
  ): Promise<boolean> {
    // Los mensajes salientes se guardan con DISTINTOS ids en `twilioMessageSid`
    // según la vía de envío: los enviados por API (plantillas, texto) llevan el id
    // INTERNO de ycloud (p.ej. "6a86…"), mientras que los ecos de la app nativa
    // llevan el WAMID de WhatsApp (p.ej. "3EB0…"). El webhook de estado trae AMBOS
    // (`id` de ycloud y `wamid`), así que buscamos por todos los candidatos para
    // que el acuse (entregado/leído/falló) SIEMPRE encuentre su mensaje.
    const ids = [...new Set((Array.isArray(externalId) ? externalId : [externalId]).filter(Boolean))];
    if (ids.length === 0) return false;

    const snap = await db
      .collectionGroup('messages')
      .where('twilioMessageSid', 'in', ids)
      .limit(1)
      .get();

    if (snap.empty) return false;

    const doc     = snap.docs[0];
    const current = (doc.data() as { status?: MessageStatus }).status ?? 'sent';

    // Solo escribimos si el nuevo estado es un avance real.
    if (STATUS_RANK[nextStatus] > STATUS_RANK[current]) {
      await doc.ref.update({
        status:    nextStatus,
        updatedAt: Timestamp.now(),
        // Guardar el motivo del fallo para mostrarlo en el chat (solo al fallar).
        ...(nextStatus === 'failed' && extra?.failureReason ? { failureReason: extra.failureReason } : {}),
        ...(nextStatus === 'failed' && extra?.failureCode   ? { failureCode:   extra.failureCode   } : {}),
      });
    }
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
   * Último mensaje de la conversación (por createdAt). Usado por el debounce:
   * si al despertar el último mensaje ya no es el que estamos procesando, otro
   * mensaje más nuevo llegó y él se encargará de responder la ráfaga completa.
   */
  async getLatest(
    companyId: string,
    leadId: string
  ): Promise<Message | null> {
    const snap = await col(companyId, leadId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Message;
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
