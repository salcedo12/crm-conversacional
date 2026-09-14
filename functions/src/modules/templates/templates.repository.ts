import { Timestamp } from 'firebase-admin/firestore';
import { db }        from '../../lib/admin';
import type { WhatsAppTemplate, CreateTemplateInput, UpdateTemplateInput } from './templates.types';

const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('whatsappTemplates');

export const templatesRepository = {

  async findAll(companyId: string): Promise<WhatsAppTemplate[]> {
    const snap = await col(companyId).orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WhatsAppTemplate));
  },

  async findById(companyId: string, templateId: string): Promise<WhatsAppTemplate | null> {
    const snap = await col(companyId).doc(templateId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as WhatsAppTemplate;
  },

  async findByName(companyId: string, name: string): Promise<WhatsAppTemplate | null> {
    const snap = await col(companyId).where('name', '==', name).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as WhatsAppTemplate;
  },

  async create(companyId: string, input: CreateTemplateInput): Promise<WhatsAppTemplate> {
    const ref = col(companyId).doc();
    const doc: Omit<WhatsAppTemplate, 'id'> = {
      ...input,
      companyId,
      createdAt: Timestamp.now(),
    };
    await ref.set(doc);
    return { id: ref.id, ...doc };
  },

  async update(companyId: string, templateId: string, input: UpdateTemplateInput): Promise<void> {
    await col(companyId).doc(templateId).update({
      ...input,
      updatedAt: Timestamp.now(),
    });
  },

  async delete(companyId: string, templateId: string): Promise<void> {
    await col(companyId).doc(templateId).delete();
  },

  /**
   * Upsert por nombre + WABA — usado al sincronizar desde YCloud. Una misma
   * plantilla (mismo `name`) puede existir en VARIOS WABAs (317 y línea del
   * asesor), así que la clave de deduplicación es (name, wabaId): sin esto, la
   * plantilla del 317 y la de la línea del asesor se pisarían. Se filtra en
   * memoria (pocos docs por empresa) para no exigir un índice compuesto.
   */
  async upsertByName(companyId: string, input: CreateTemplateInput): Promise<WhatsAppTemplate> {
    const snap = await col(companyId).where('name', '==', input.name).get();
    const targetWaba = input.wabaId ?? '';
    const match = snap.docs.find((d) => ((d.data().wabaId as string | undefined) ?? '') === targetWaba);

    if (match) {
      await match.ref.update({ ...input, updatedAt: Timestamp.now() });
      return { id: match.id, ...input, createdAt: match.data().createdAt as Timestamp };
    }

    return this.create(companyId, input);
  },
};
