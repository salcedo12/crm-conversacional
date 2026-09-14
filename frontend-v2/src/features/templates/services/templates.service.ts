import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';
import type { WhatsAppTemplate, CreateTemplateInput, TemplateCategory, TemplateStatus } from '../types';

const _list       = httpsCallable<{ companyId: string }, { templates: WhatsAppTemplate[] }>(functions, 'listTemplates');
const _create     = httpsCallable<CreateTemplateInput & { companyId: string; inboxId?: string }, { templateId: string }>(functions, 'createTemplate');
const _update     = httpsCallable<{ companyId: string; templateId: string } & Partial<CreateTemplateInput>, { ok: boolean }>(functions, 'updateTemplate');
const _delete     = httpsCallable<{ companyId: string; templateId: string }, { ok: boolean }>(functions, 'deleteTemplate');
const _sync       = httpsCallable<{ companyId: string }, { synced: number }>(functions, 'syncTemplatesFromTwilio');
const _send       = httpsCallable<{ companyId: string; leadId: string; templateId: string; variables: Record<string, string>; fromInboxId?: string }, { messageId: string }>(functions, 'sendTemplateMessage');

export interface MessagingLine {
  number: string;
  wabaId?: string;
  isDefault: boolean;
  /** uid del asesor dueño (solo en líneas de coexistencia). */
  advisorId?: string;
}
const _listLines  = httpsCallable<{ companyId: string }, { lines: MessagingLine[] }>(functions, 'listMessagingLines');

export async function listMessagingLines(companyId: string): Promise<MessagingLine[]> {
  const r = await _listLines({ companyId });
  return r.data.lines ?? [];
}

const CATEGORY_FALLBACK: TemplateCategory = 'marketing';
const STATUS_FALLBACK: TemplateStatus = 'pending';

function normalizeTemplate(raw: WhatsAppTemplate): WhatsAppTemplate {
  const category = String(raw.category ?? '').toLowerCase() as TemplateCategory;
  const status   = String(raw.status ?? '').toLowerCase() as TemplateStatus;

  return {
    ...raw,
    displayName: raw.displayName || raw.name,
    category: ['marketing', 'utility', 'authentication'].includes(category)
      ? category
      : CATEGORY_FALLBACK,
    status: ['approved', 'pending', 'rejected', 'local'].includes(status)
      ? status
      : STATUS_FALLBACK,
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    buttons: Array.isArray(raw.buttons) ? raw.buttons : [],
  };
}

export async function listTemplates(companyId: string) {
  const r = await _list({ companyId });
  return (r.data.templates ?? []).map(normalizeTemplate);
}

export async function createTemplate(
  companyId: string,
  input: Omit<CreateTemplateInput, 'companyId'>,
  inboxId?: string,
) {
  const r = await _create({ ...input, companyId, ...(inboxId ? { inboxId } : {}) });
  return r.data.templateId;
}

export async function updateTemplate(companyId: string, templateId: string, input: Partial<CreateTemplateInput>) {
  await _update({ companyId, templateId, ...input });
}

export async function deleteTemplate(companyId: string, templateId: string) {
  await _delete({ companyId, templateId });
}

export async function syncTemplates(companyId: string) {
  const r = await _sync({ companyId });
  return r.data.synced;
}

export async function sendTemplateMessage(
  companyId:  string,
  leadId:     string,
  templateId: string,
  variables:  Record<string, string>,
  /** Línea (+E.164) elegida para enviar. Omitir = usar la línea del lead. */
  fromInboxId?: string,
) {
  const r = await _send({ companyId, leadId, templateId, variables, ...(fromInboxId ? { fromInboxId } : {}) });
  return r.data.messageId;
}
