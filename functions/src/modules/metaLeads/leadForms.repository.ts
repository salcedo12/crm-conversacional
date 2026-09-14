import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';

/**
 * Mapeo "formulario de Meta (pauta) → plantilla de bienvenida".
 *
 * Cada pauta de FORMULARIO (Lead Ads) usa un formulario instantáneo con su
 * propio `form_id`. Este documento permite que CADA pauta tenga su propia
 * plantilla de bienvenida, en vez de una sola global para todas.
 *
 * Ruta: companies/{companyId}/leadFormTemplates/{formId}
 * - `templateName` vacío/ausente ⇒ se usa la plantilla global por defecto
 *   (env META_LEAD_WELCOME_TEMPLATE), o ninguna si tampoco está configurada.
 * - Los formularios se AUTORREGISTRAN la primera vez que llega un lead (recordSeen),
 *   así el admin solo tiene que elegir la plantilla de una lista, sin buscar IDs.
 */
export interface LeadFormMapping {
  formId:       string;
  label?:       string;      // nombre legible del formulario (traído de Meta)
  templateName?: string;     // nombre técnico de la plantilla de bienvenida
  leadCount?:   number;      // cuántos leads han entrado por este formulario
  lastLeadAt?:  Timestamp;   // último lead recibido
  updatedAt?:   Timestamp;
}

function col(companyId: string) {
  return db.collection('companies').doc(companyId).collection('leadFormTemplates');
}

export const leadFormsRepository = {
  async list(companyId: string): Promise<LeadFormMapping[]> {
    const snap = await col(companyId).get();
    return snap.docs
      .map((d) => ({ formId: d.id, ...d.data() } as LeadFormMapping))
      .sort((a, b) => (b.lastLeadAt?.toMillis() ?? 0) - (a.lastLeadAt?.toMillis() ?? 0));
  },

  async get(companyId: string, formId: string): Promise<LeadFormMapping | null> {
    const snap = await col(companyId).doc(formId).get();
    if (!snap.exists) return null;
    return { formId: snap.id, ...snap.data() } as LeadFormMapping;
  },

  /** Asigna (o limpia, con templateName vacío) la plantilla de bienvenida del formulario. */
  async setTemplate(companyId: string, formId: string, templateName: string, label?: string): Promise<void> {
    await col(companyId).doc(formId).set(
      {
        formId,
        templateName: templateName || FieldValue.delete(),
        ...(label ? { label } : {}),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  },

  async remove(companyId: string, formId: string): Promise<void> {
    await col(companyId).doc(formId).delete();
  },

  /**
   * Registra que llegó un lead por este formulario: incrementa el contador y
   * autocrea el documento la primera vez (resolviendo su nombre legible con
   * `resolveLabel`, que solo se invoca si el formulario aún no existía).
   */
  async recordSeen(
    companyId: string,
    formId: string,
    resolveLabel?: () => Promise<string | undefined>
  ): Promise<void> {
    const ref = col(companyId).doc(formId);
    const snap = await ref.get();
    const now = Timestamp.now();
    const patch: Record<string, unknown> = {
      formId,
      leadCount:  FieldValue.increment(1),
      lastLeadAt: now,
      updatedAt:  now,
    };
    if (!snap.exists && resolveLabel) {
      const label = await resolveLabel().catch(() => undefined);
      if (label) patch.label = label;
    }
    await ref.set(patch, { merge: true });
  },
};
