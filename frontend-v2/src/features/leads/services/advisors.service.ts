import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface Advisor {
  id:              string;
  displayName:     string;
  email:           string;
  role:            string;
  active:          boolean;
  googleConnected: boolean;
  /** WhatsApp para avisos automáticos (ej. aviso de cita). '' si no se definió. */
  phone?:          string;
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
const _setLeadAssignmentLock = httpsCallable<
  { companyId: string; leadId: string; locked: boolean },
  { leadId: string; locked: boolean }
>(functions, 'setLeadAssignmentLock');
const _listCompanyUsers = httpsCallable<{ companyId: string }, { users: CompanyUser[] }>(
  functions, 'listCompanyUsers'
);
const _createCompanyUser = httpsCallable<
  { companyId: string; email: string; displayName: string; role: string; active: boolean },
  { user: CompanyUser; inviteLink: string | null; emailSent?: boolean; emailError?: string | null }
>(functions, 'createCompanyUser');
const _updateCompanyUser = httpsCallable<
  { companyId: string; userId: string; displayName: string; role: string; active: boolean; phone?: string },
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

/** Fija (locked:true) o libera el asesor de un lead para bloquear la reasignacion automatica. */
export async function setLeadAssignmentLock(
  companyId: string,
  leadId:    string,
  locked:    boolean
): Promise<void> {
  await _setLeadAssignmentLock({ companyId, leadId, locked });
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
  phone?: string;
}): Promise<void> {
  await _updateCompanyUser(input);
}
