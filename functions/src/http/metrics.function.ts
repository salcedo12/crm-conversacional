import { onCall } from 'firebase-functions/v2/https';
import { z }       from 'zod';
import { db }      from '../lib/admin';
import { requireAuth, assertCompany } from '../lib/authContext';
import type { Lead } from '../modules/leads/leads.types';
import type { Appointment } from '../modules/appointments/appointments.types';

const LEAD_STATUSES = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'] as const;
const LEAD_SOURCES  = ['whatsapp', 'manual', 'web', 'facebook', 'instagram', 'meta_ads'] as const;

interface UserDoc { displayName?: string; email?: string }

// ─── getDashboardMetrics ─────────────────────────────────────────────────────
// Agrega KPIs de la empresa: leads por estado/fuente/asesor, citas y nuevos leads.

export const getDashboardMetrics = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const companyRef = db.collection('companies').doc(companyId);

    const [leadsSnap, apptsSnap, usersSnap] = await Promise.all([
      companyRef.collection('leads').get(),
      companyRef.collection('appointments').get(),
      companyRef.collection('users').get(),
    ]);

    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
    const appts = apptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));

    // Mapa asesor → nombre
    const advisorName = new Map<string, string>();
    usersSnap.docs.forEach((d) => {
      const u = d.data() as UserDoc;
      advisorName.set(d.id, u.displayName || u.email || d.id);
    });

    // ── Leads por estado ──────────────────────────────────────────────────────
    const statusCount: Record<string, number> = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    const sourceCount: Record<string, number> = Object.fromEntries(LEAD_SOURCES.map((s) => [s, 0]));
    const advisorCount = new Map<string, number>(); // advisorId | '__none__'

    const now = Date.now();
    const DAY = 86_400_000;
    const since7  = now - 7  * DAY;
    const since30 = now - 30 * DAY;
    let newLeads7d = 0;
    let newLeads30d = 0;

    // Buckets diarios (últimos 14 días)
    const dailyMap = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * DAY);
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }

    // ── Insights de IA (radiografía de leads) ──────────────────────────────────
    let analyzedCount = 0;
    let scoreSum = 0;
    let lostTotal = 0;
    let lostAnalyzed = 0;
    const tempCount: Record<'hot' | 'warm' | 'cold', number> = { hot: 0, warm: 0, cold: 0 };
    const lossCount = new Map<string, number>();

    for (const lead of leads) {
      if (lead.status in statusCount) statusCount[lead.status]++;
      if (lead.source && lead.source in sourceCount) sourceCount[lead.source]++;

      const key = lead.assignedTo ?? '__none__';
      advisorCount.set(key, (advisorCount.get(key) ?? 0) + 1);

      const createdMs = lead.createdAt?.toMillis?.() ?? 0;
      if (createdMs >= since7)  newLeads7d++;
      if (createdMs >= since30) newLeads30d++;
      const dayKey = new Date(createdMs).toISOString().slice(0, 10);
      if (dailyMap.has(dayKey)) dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1);

      const ai = lead.aiAnalysis;
      if (lead.status === 'lost') lostTotal++;
      if (ai && typeof ai.score === 'number') {
        analyzedCount++;
        scoreSum += ai.score;
        if (ai.temperature === 'hot' || ai.temperature === 'warm' || ai.temperature === 'cold') {
          tempCount[ai.temperature]++;
        }
        if (lead.status === 'lost') {
          lostAnalyzed++;
          if (ai.lossCategory && ai.lossCategory !== 'ninguno') {
            lossCount.set(ai.lossCategory, (lossCount.get(ai.lossCategory) ?? 0) + 1);
          }
        }
      }
    }

    const aiInsights = {
      analyzedCount,
      avgScore:     analyzedCount > 0 ? Math.round(scoreSum / analyzedCount) : 0,
      temperature:  tempCount,
      lostTotal,
      lostAnalyzed,
      lossReasons:  [...lossCount.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    };

    // ── Citas ─────────────────────────────────────────────────────────────────
    let upcoming = 0, completed = 0, canceled = 0;
    const appointmentAdvisorCount = new Map<string, {
      total: number;
      upcoming: number;
      completed: number;
      canceled: number;
    }>(); // advisorId | '__none__'

    for (const a of appts) {
      const advisorKey = a.advisorId ?? '__none__';
      const advisorStats = appointmentAdvisorCount.get(advisorKey) ?? {
        total: 0,
        upcoming: 0,
        completed: 0,
        canceled: 0,
      };
      advisorStats.total++;

      if (a.status === 'completed') {
        completed++;
        advisorStats.completed++;
      }
      else if (a.status === 'canceled') {
        canceled++;
        advisorStats.canceled++;
      }
      else if (a.status === 'scheduled') {
        if ((a.startTime?.toMillis?.() ?? 0) >= now) {
          upcoming++;
          advisorStats.upcoming++;
        }
      }

      appointmentAdvisorCount.set(advisorKey, advisorStats);
    }

    // ── Tasa de conversión: (agendados + cerrados) / total ──────────────────────
    const total = leads.length;
    const converted = statusCount['scheduled'] + statusCount['closed'];
    const conversionRate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;

    return {
      totalLeads:    total,
      leadsByStatus: LEAD_STATUSES.map((s) => ({ status: s, count: statusCount[s] })),
      leadsBySource: LEAD_SOURCES.map((s) => ({ source: s, count: sourceCount[s] }))
        .filter((x) => x.count > 0),
      leadsByAdvisor: [...advisorCount.entries()]
        .map(([id, count]) => ({
          advisorId: id === '__none__' ? null : id,
          name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
          count,
        }))
        .sort((a, b) => b.count - a.count),
      appointments:  { total: appts.length, upcoming, completed, canceled },
      appointmentsByAdvisor: [...appointmentAdvisorCount.entries()]
        .map(([id, stats]) => ({
          advisorId: id === '__none__' ? null : id,
          name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
          ...stats,
        }))
        .sort((a, b) => b.total - a.total),
      conversionRate,           // porcentaje
      newLeads7d,
      newLeads30d,
      dailyNewLeads: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
      aiInsights,
      generatedAt:   now,
    };
  }
);
