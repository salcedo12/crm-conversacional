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

  /** Upsert por nombre — usado al sincronizar desde Twilio */
  async upsertByName(companyId: string, input: CreateTemplateInput): Promise<WhatsAppTemplate> {
    const snap = await col(companyId)
      .where('name', '==', input.name)
      .limit(1)
      .get();

    if (!snap.empty) {
      const docRef = snap.docs[0].ref;
      await docRef.update({ ...input, updatedAt: Timestamp.now() });
      return { id: docRef.id, ...input, createdAt: snap.docs[0].data().createdAt as Timestamp };
    }

    return this.create(companyId, input);
  },
};
