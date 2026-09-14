import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface LeadFormMapping {
  formId:       string;
  label:        string | null;
  templateName: string | null;
  leadCount:    number;
  lastLeadAt:   number | null;  // epoch ms
}

const _list   = httpsCallable<{ companyId: string }, { forms: LeadFormMapping[] }>(functions, 'listLeadFormTemplates');
const _set    = httpsCallable<{ companyId: string; formId: string; templateName: string; label?: string }, { ok: boolean }>(functions, 'setLeadFormTemplate');
const _delete = httpsCallable<{ companyId: string; formId: string }, { ok: boolean }>(functions, 'deleteLeadFormTemplate');

export async function listLeadFormTemplates(companyId: string): Promise<LeadFormMapping[]> {
  const r = await _list({ companyId });
  return r.data.forms ?? [];
}

export async function setLeadFormTemplate(companyId: string, formId: string, templateName: string, label?: string): Promise<void> {
  await _set({ companyId, formId, templateName, label });
}

export async function deleteLeadFormTemplate(companyId: string, formId: string): Promise<void> {
  await _delete({ companyId, formId });
}
