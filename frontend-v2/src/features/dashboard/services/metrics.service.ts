import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface DashboardMetrics {
  totalLeads:    number;
  leadsByStatus: { status: string; count: number }[];
  leadsBySource: { source: string; count: number }[];
  leadsByAdvisor: { advisorId: string | null; name: string; count: number }[];
  appointments:  { total: number; upcoming: number; completed: number; canceled: number };
  appointmentsByAdvisor: {
    advisorId: string | null;
    name: string;
    total: number;
    upcoming: number;
    completed: number;
    canceled: number;
  }[];
  conversionRate: number;
  newLeads7d:    number;
  newLeads30d:   number;
  dailyNewLeads: { date: string; count: number }[];
  generatedAt:   number;
}

const _get = httpsCallable<{ companyId: string }, DashboardMetrics>(functions, 'getDashboardMetrics');

export async function getDashboardMetrics(companyId: string): Promise<DashboardMetrics> {
  const r = await _get({ companyId });
  return r.data;
}
