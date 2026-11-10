import { httpsCallable } from 'firebase/functions';
import { doc, getDoc }     from 'firebase/firestore';
import { functions, db }   from '@/config/firebase';

export interface DashboardMetrics {
  totalLeads:    number;
  inboxBreakdown?: {
    central317Count:    number;
    advisorDirectCount: number;
    reactivatedCount:   number;
    allContactsTotal:   number;
  };
  leadsByStatus: { status: string; count: number }[];
  leadsBySource: { source: string; count: number }[];
  firstTouchBySource?: { source: string; count: number }[];
  leadsByProject?: { project: string; count: number }[];
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
  month?:        string;
  label?:        string;
  defaultMonth?: string;
  availableMonths?: { key: string; label: string; count: number }[];
  monthsData?:   Record<string, DashboardMetrics>;
  databaseStats?: {
    totalContacts:          number;
    migratedSmarthome:      number;
    pautaTotal:             number;
    activeAdvisorsAssigned: number;
    unassignedOrFormer:     number;
  };
}

export interface AiInsights {
  analyzedCount: number;
  avgScore:      number;
  temperature:   { hot: number; warm: number; cold: number };
  lostTotal:     number;
  lostAnalyzed:  number;
  lossReasons:   { category: string; count: number }[];
}

const _get = httpsCallable<{ companyId: string; refresh?: boolean }, DashboardMetrics>(functions, 'getDashboardMetrics');

export async function getDashboardMetrics(companyId: string, refresh?: boolean): Promise<DashboardMetrics> {
  try {
    const r = await _get({ companyId, refresh });
    return r.data;
  } catch (cloudErr) {
    console.warn('[metrics.service] getDashboardMetrics callable falló o tardó, usando caché en Firestore:', cloudErr);
    try {
      const snap = await getDoc(doc(db, 'companies', companyId, 'reportCache', 'dashboard__all'));
      if (snap.exists()) {
        const data = snap.data();
        if (data?.payload) {
          return data.payload as DashboardMetrics;
        }
      }
    } catch (cacheErr) {
      console.warn('[metrics.service] Fallback a reportCache falló:', cacheErr);
    }
    throw cloudErr;
  }
}

export interface ExportLeadsResult {
  downloadUrl: string;
  fileName:    string;
  rowCount:    number;
}

const _exportLeads = httpsCallable<
  { companyId: string; inbox?: 'all' | 'central_317' | 'advisor_direct'; includeArchived?: boolean },
  ExportLeadsResult
>(functions, 'exportLeadsReport');

export async function exportLeadsReport(
  companyId: string,
  inbox: 'all' | 'central_317' | 'advisor_direct' = 'all',
): Promise<ExportLeadsResult> {
  const r = await _exportLeads({ companyId, inbox, includeArchived: true });
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
