import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';
import type { WhatsAppTemplate, CreateTemplateInput } from '../types';

const _list       = httpsCallable<{ companyId: string }, { templates: WhatsAppTemplate[] }>(functions, 'listTemplates');
const _create     = httpsCallable<CreateTemplateInput & { companyId: string }, { templateId: string }>(functions, 'createTemplate');
const _update     = httpsCallable<{ companyId: string; templateId: string } & Partial<CreateTemplateInput>, { ok: boolean }>(functions, 'updateTemplate');
const _delete     = httpsCallable<{ companyId: string; templateId: string }, { ok: boolean }>(functions, 'deleteTemplate');
const _sync       = httpsCallable<{ companyId: string }, { synced: number }>(functions, 'syncTemplatesFromTwilio');
const _send       = httpsCallable<{ companyId: string; leadId: string; templateId: string; variables: Record<string, string> }, { messageId: string }>(functions, 'sendTemplateMessage');

export async function listTemplates(companyId: string) {
  const r = await _list({ companyId });
  return r.data.templates;
}

export async function createTemplate(companyId: string, input: Omit<CreateTemplateInput, 'companyId'>) {
  const r = await _create({ ...input, companyId });
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
  variables:  Record<string, string>
) {
  const r = await _send({ companyId, leadId, templateId, variables });
  return r.data.messageId;
}
