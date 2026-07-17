import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export type ContactFieldType = 'text' | 'number' | 'date' | 'select';

export interface ContactField {
  id: string;
  label: string;
  type: ContactFieldType;
  options: string[];
}

const _listContactFields = httpsCallable<{ companyId: string }, { fields: ContactField[] }>(
  functions, 'listContactFields'
);
const _saveContactFields = httpsCallable<
  { companyId: string; fields: ContactField[] },
  { fields: ContactField[] }
>(functions, 'saveContactFields');

export async function listContactFields(companyId: string): Promise<ContactField[]> {
  return (await _listContactFields({ companyId })).data.fields;
}

export async function saveContactFields(companyId: string, fields: ContactField[]): Promise<ContactField[]> {
  return (await _saveContactFields({ companyId, fields })).data.fields;
}
