import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface SlaConfig {
  slaEnabled: boolean;
  preCitaMinutes: number;
  preCitaLookbackHours: number;
  preCitaReassignEnabled: boolean;
  preCitaBlockAdvisor: boolean;
  postCitaMinutes: number;
  postCitaBlockAdvisor: boolean;
  postCitaRequireEvidence: boolean;
  manualTakeoverHours?: number;
  manualTakeoverBlockAdvisor?: boolean;
}

export interface BlockedAdvisor {
  id: string;
  displayName: string;
  email: string;
  role: string;
  receiveLeads?: boolean;
  blockedReason: string;
  blockedAt: string | null;
  unresolvedAppointmentId: string | null;
  unresolvedLeadId?: string | null;
  unresolvedLeadName?: string | null;
}

const _getSlaConfig = httpsCallable<{ companyId: string }, { ok: boolean; config: SlaConfig }>(
  functions,
  'getSlaConfig'
);

const _saveSlaConfig = httpsCallable<
  { companyId: string; config: Partial<SlaConfig> },
  { ok: boolean; config: SlaConfig }
>(functions, 'saveSlaConfig');

const _listBlockedAdvisors = httpsCallable<
  { companyId: string },
  { ok: boolean; advisors: BlockedAdvisor[] }
>(functions, 'listBlockedAdvisorsCall');

const _unblockAdvisor = httpsCallable<
  { companyId: string; advisorId: string; reason?: string },
  { ok: boolean }
>(functions, 'unblockAdvisorManualCall');

export async function fetchSlaConfig(companyId: string): Promise<SlaConfig> {
  const res = await _getSlaConfig({ companyId });
  return res.data.config;
}

export async function updateSlaConfig(companyId: string, config: Partial<SlaConfig>): Promise<SlaConfig> {
  const res = await _saveSlaConfig({ companyId, config });
  return res.data.config;
}

export async function fetchBlockedAdvisors(companyId: string): Promise<BlockedAdvisor[]> {
  const res = await _listBlockedAdvisors({ companyId });
  return res.data.advisors || [];
}

export async function unblockAdvisor(companyId: string, advisorId: string, reason?: string): Promise<void> {
  await _unblockAdvisor({ companyId, advisorId, reason });
}
