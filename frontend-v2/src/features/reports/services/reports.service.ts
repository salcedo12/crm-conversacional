import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { LeadStatus } from '@/features/inbox/types';

export interface AdvisorReport {
  advisorId:         string;
  name:              string;
  leads:             number;
  byStatus:          Record<LeadStatus, number>;
  conversionRate:    number;
  closedRate:        number;
  appts:             { total: number; completed: number; upcoming: number; canceled: number };
  avgScore:          number;
  advisorMsgs:       number;
  handled:           number;
  responseSamples:   number;
  avgResponseMin:    number | null;
  medianResponseMin: number | null;
  within1hRate:      number | null;
  waiting:           number;
  stale:             number;
}

export interface AdvisorReports {
  rangeDays:   number;
  generatedAt: number;
  team: {
    advisors:       number;
    totalLeads:     number;
    conversionRate: number;
    closedRate:     number;
    avgResponseMin: number | null;
    waiting:        number;
    stale:          number;
  };
  advisors: AdvisorReport[];
}

const _get = httpsCallable<{ companyId: string; rangeDays: number }, AdvisorReports>(functions, 'getAdvisorReports');

export async function getAdvisorReports(companyId: string, rangeDays: number): Promise<AdvisorReports> {
  const r = await _get({ companyId, rangeDays });
  return r.data;
}
