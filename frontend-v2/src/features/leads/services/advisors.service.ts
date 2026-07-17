import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface Advisor {
  id:              string;
  displayName:     string;
  email:           string;
  role:            string;
  active:          boolean;
  googleConnected: boolean;
}

export interface CompanyUser extends Advisor {
  invitedAt?: number | null;
  updatedAt?: number | null;
}

const _listAdvisors = httpsCallable<{ companyId: string }, { advisors: Advisor[] }>(
  functions, 'listAdvisors'
);
const _reassignLead = httpsCallable<
  { companyId: string; leadId: string; advisorId: string | null },
  { leadId: string; advisorId: string | null }
>(functions, 'reassignLead');
const _listCompanyUsers = httpsCallable<{ companyId: string }, { users: CompanyUser[] }>(
  functions, 'listCompanyUsers'
);
const _createCompanyUser = httpsCallable<
  { companyId: string; email: string; displayName: string; role: string; active: boolean },
  { user: CompanyUser; inviteLink: string | null; emailSent?: boolean; emailError?: string | null }
>(functions, 'createCompanyUser');
const _updateCompanyUser = httpsCallable<
  { companyId: string; userId: string; displayName: string; role: string; active: boolean },
  { ok: boolean }
>(functions, 'updateCompanyUser');

export async function listAdvisors(companyId: string): Promise<Advisor[]> {
  const r = await _listAdvisors({ companyId });
  return r.data.advisors;
}

export async function reassignLead(
  companyId: string,
  leadId:    string,
  advisorId: string | null
): Promise<void> {
  await _reassignLead({ companyId, leadId, advisorId });
}

export async function listCompanyUsers(companyId: string): Promise<CompanyUser[]> {
  return (await _listCompanyUsers({ companyId })).data.users;
}

export async function createCompanyUser(input: {
  companyId: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
}): Promise<{ user: CompanyUser; inviteLink: string | null; emailSent?: boolean; emailError?: string | null }> {
  return (await _createCompanyUser(input)).data;
}

export async function updateCompanyUser(input: {
  companyId: string;
  userId: string;
  displayName: string;
  role: string;
  active: boolean;
}): Promise<void> {
  await _updateCompanyUser(input);
}
