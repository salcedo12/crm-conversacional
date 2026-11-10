import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';

export type DealActivityEvent =
  | 'created'
  | 'buyers_saved'
  | 'lot_reserved'
  | 'lot_released'
  | 'plan_saved'
  | 'document_generated'
  | 'attachment_uploaded'
  | 'attachment_deleted'
  | 'cancelled'
  | 'sent_to_signature'
  | 'signature_update';

export const leadRef = (companyId: string, leadId: string) =>
  db.collection('companies').doc(companyId).collection('leads').doc(leadId);

export const dealActivityRef = (companyId: string, leadId: string) =>
  leadRef(companyId, leadId).collection('notes').doc();

/** Documento que aparece en "Bitácora & historial" de la ficha del lead. */
export function dealActivityDoc(input: {
  companyId: string;
  leadId: string;
  dealId: string;
  actorId: string;
  actorName: string;
  event: DealActivityEvent;
  title: string;
  lines?: string[];
  createdAt?: Timestamp;
}) {
  const lines = (input.lines ?? []).filter(Boolean);
  return {
    companyId: input.companyId,
    leadId: input.leadId,
    dealId: input.dealId,
    kind: 'note',
    type: 'deal_activity',
    actionType: 'negocio',
    dealEvent: input.event,
    text: [`NEGOCIO · ${input.title}`, ...lines.map((line) => `• ${line}`)].join('\n'),
    authorId: input.actorId,
    authorName: input.actorName,
    createdAt: input.createdAt ?? Timestamp.now(),
  };
}

export function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString('es-CO')}`;
}
