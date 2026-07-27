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
  aiInsights:    AiInsights;
  generatedAt:   number;
}

export interface AiInsights {
  analyzedCount: number;
  avgScore:      number;
  temperature:   { hot: number; warm: number; cold: number };
  lostTotal:     number;
  lostAnalyzed:  number;
  lossReasons:   { category: string; count: number }[];
}

const _get = httpsCallable<{ companyId: string }, DashboardMetrics>(functions, 'getDashboardMetrics');

export async function getDashboardMetrics(companyId: string): Promise<DashboardMetrics> {
  const r = await _get({ companyId });
  return r.data;
}

export interface LossInsight {
  insight:     string;
  basedOn:     number;
  generatedAt: number;
}

const _lossInsight = httpsCallable<{ companyId: string }, LossInsight>(functions, 'generateLossInsight');

/** Genera una recomendación ejecutiva IA sobre por qué se pierden los leads (admin/manager). */
export async function generateLossInsight(companyId: string): Promise<LossInsight> {
  const r = await _lossInsight({ companyId });
  return r.data;
}
