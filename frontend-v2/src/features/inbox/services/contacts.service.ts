import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface CreateContactInput {
  companyId: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
}

export interface CreateContactResult {
  leadId: string;
  /** true si ya existía un lead con ese número (no se duplicó). */
  existed: boolean;
}

const _create = httpsCallable<CreateContactInput, CreateContactResult>(functions, 'createContact');

/** Crea un contacto (lead) manual por número para iniciarle conversación por plantilla. */
export async function createContact(input: CreateContactInput): Promise<CreateContactResult> {
  return (await _create(input)).data;
}
