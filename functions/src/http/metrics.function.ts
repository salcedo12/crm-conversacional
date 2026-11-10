import { onCall } from 'firebase-functions/v2/https';
import { z }       from 'zod';
import { db }      from '../lib/admin';
import { requireAuth, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { getCachedReport } from '../lib/reportCache';
import type { Lead } from '../modules/leads/leads.types';
import type { Appointment } from '../modules/appointments/appointments.types';

const LEAD_STATUSES = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'] as const;
const LEAD_SOURCES  = ['whatsapp', 'manual', 'web', 'facebook', 'instagram', 'meta_ads', 'google_ads'] as const;

interface UserDoc { displayName?: string; email?: string }

// ─── getDashboardMetrics ─────────────────────────────────────────────────────
// Agrega KPIs de la empresa: leads por estado/fuente/asesor, citas y nuevos leads.

export const getDashboardMetrics = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '1GiB' },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, refresh } = z.object({
      companyId: z.string().min(1),
      refresh:   z.boolean().optional(),   // true = ignora caché y recalcula
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const scopedToAdvisor = !(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role));
    // Dashboard de asesor: filtrado a SUS leads → cachear por uid. Dashboard de
    // admin/manager: a nivel empresa → una sola entrada compartida. TTL 5 min:
    // se recalcula, como máximo, una vez cada 60 min por scope (antes: cada apertura).
    const cacheKey = scopedToAdvisor ? `dashboard__${ctx.uid}` : 'dashboard__all';

    return getCachedReport(companyId, cacheKey, 60 * 60_000, async () => {
    const companyRef = db.collection('companies').doc(companyId);

    const [leadsSnap, apptsSnap, usersSnap] = await Promise.all([
      companyRef.collection('leads')
        .select(
          'status', 'source', 'assignedTo', 'createdAt', 'inbox', 
          'firstTouch', 'lastTouch', 'projectInterest', 'reactivationCount', 
          'customFields', 'aiAnalysis', 'metadata', 'tags', 'fuenteUbicacion'
        ).get(),
      companyRef.collection('appointments').get(),
      companyRef.collection('users').get(),
    ]);

    const rawAllLeads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
    const scopedRawLeads = scopedToAdvisor
      ? rawAllLeads.filter((lead) => lead.assignedTo === ctx.uid)
      : rawAllLeads;

    function isMigrated(l: Lead): boolean {
      if (l.metadata && (l.metadata as { migratedFrom?: string }).migratedFrom) return true;
      if (l.tags && Array.isArray(l.tags) && l.tags.includes('smarthome_migracion')) return true;
      return false;
    }

    function normalizeProject(raw: unknown): string {
      if (!raw) return 'Sin especificar';
      const s = String(raw).toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // 1. Cañón de Arizona
      if (s.includes('arizona') || s.includes('canon') || s.includes('canion')) {
        return 'Cañón de Arizona';
      }

      // 2. Llano Grande
      if (s.includes('llano grande') || s.includes('llanogrande')) {
        return 'Llano Grande';
      }

      // 3. Múltiples proyectos / portafolio conjunto
      if (
        s.includes('tres') || s.includes('los 3') || s.includes('varios') ||
        (s.includes('melgar') && s.includes('mariquita')) ||
        (s.includes('melgar') && s.includes('alvarado')) ||
        (s.includes('alvarado') && s.includes('mariquita')) ||
        s.includes('diferentes ubicaciones') || s.includes('todos')
      ) {
        return 'Portafolio (Varios Proyectos)';
      }

      // 4. Laguna Mar (Melgar)
      if (
        s.includes('laguna') || s.includes('santorini') || s.includes('canarias') ||
        s.includes('melgar') || s.includes('bungalow')
      ) {
        return 'Laguna Mar';
      }

      // 5. Río Claro (Mariquita)
      if (s.includes('rio claro') || s.includes('mariquita')) {
        return 'Río Claro';
      }

      // 6. Sobre Montañas (Alvarado)
      if (s.includes('montana') || s.includes('montanas') || s.includes('alvarado') || s.includes('al varado')) {
        return 'Sobre Montañas (Alvarado)';
      }

      // 7. General
      if (s.includes('campestre') || s.includes('lote') || s.includes('terreno') || s.includes('vivienda')) {
        return 'Lotes Campestres (Interés General)';
      }

      return 'Otros / Por Clasificar';
    }

    function getCreatedMs(l: Lead): number {
      if (l.createdAt && typeof (l.createdAt as { toMillis?: () => number }).toMillis === 'function') {
        return (l.createdAt as { toMillis: () => number }).toMillis();
      }
      if (l.createdAt && typeof (l.createdAt as { seconds?: number }).seconds === 'number') {
        return (l.createdAt as { seconds: number }).seconds * 1000;
      }
      if (typeof l.createdAt === 'number') return l.createdAt;
      return 0;
    }

    const advisorName = new Map<string, string>();
    usersSnap.docs.forEach((d) => {
      const u = d.data() as UserDoc;
      advisorName.set(d.id, u.displayName || u.email || d.id);
    });

    const allAppts = apptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
    const appts = scopedToAdvisor ? allAppts.filter((appt) => appt.advisorId === ctx.uid) : allAppts;

    const LINE_317_SOURCES = new Set(['whatsapp', 'web', 'meta_ads', 'google_ads']);

    function isStrictPauta317(l: Lead): boolean {
      if (isMigrated(l)) return false;
      if (l.inbox === 'advisor_direct') return false;
      if (l.source === 'advisor_whatsapp') return false;
      const meta = l.metadata as { advisorWhatsappMirror?: unknown } | undefined;
      if (meta?.advisorWhatsappMirror === 'true' || meta?.advisorWhatsappMirror === true) return false;
      if (!l.source || !LINE_317_SOURCES.has(l.source)) return false;
      const ms = getCreatedMs(l);
      if (!ms) return false;
      const mKey = new Date(ms).toISOString().slice(0, 7);
      return mKey >= '2026-08';
    }

    const pautaLeads = scopedRawLeads.filter(isStrictPauta317);
    const migratedLeads = scopedRawLeads.filter((l) => isMigrated(l));
    const advisorDirectLeads = scopedRawLeads.filter(
      (l) => !isMigrated(l) && (
        l.inbox === 'advisor_direct' ||
        l.source === 'advisor_whatsapp' ||
        (l.metadata as { advisorWhatsappMirror?: unknown } | undefined)?.advisorWhatsappMirror === 'true' ||
        (l.metadata as { advisorWhatsappMirror?: unknown } | undefined)?.advisorWhatsappMirror === true
      )
    );

    const now = Date.now();
    const DAY = 86_400_000;
    const nowObj = new Date(now);
    const startOfToday = new Date(nowObj.getFullYear(), nowObj.getMonth(), nowObj.getDate(), 0, 0, 0).getTime();
    const startOfYesterday = startOfToday - DAY;
    const since7d = now - 7 * DAY;
    const since14d = now - 14 * DAY;
    const since30d = now - 30 * DAY;

    function computeSubset(
      leadsSubset: Lead[],
      advisorDirectSubset: Lead[],
      apptsSubset: Appointment[],
      monthKey: string,
      label: string
    ) {
      const central317Leads = leadsSubset;
      const reactivatedCount = leadsSubset.filter((l) => (l.reactivationCount ?? 0) > 0).length;
      const leads = central317Leads;

      const statusCount: Record<string, number> = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
      const sourceCount: Record<string, number> = Object.fromEntries(LEAD_SOURCES.map((s) => [s, 0]));
      const firstTouchCount = new Map<string, number>();
      const projectCount = new Map<string, number>();
      const advisorCount = new Map<string, number>();

      const since7  = now - 7  * DAY;
      const since30 = now - 30 * DAY;
      let newLeads7d = 0;
      let newLeads30d = 0;

      const dailyMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now - i * DAY);
        dailyMap.set(d.toISOString().slice(0, 10), 0);
      }

      let analyzedCount = 0;
      let scoreSum = 0;
      let lostTotal = 0;
      let lostAnalyzed = 0;
      const tempCount: Record<'hot' | 'warm' | 'cold', number> = { hot: 0, warm: 0, cold: 0 };
      const lossCount = new Map<string, number>();

      for (const lead of leads) {
        if (lead.status in statusCount) statusCount[lead.status]++;
        const effectiveSource = lead.lastTouch?.source || lead.source;
        if (effectiveSource && effectiveSource in sourceCount) {
          sourceCount[effectiveSource]++;
        } else if (lead.source && lead.source in sourceCount) {
          sourceCount[lead.source]++;
        }

        const ftSource = lead.firstTouch?.source || lead.source || 'whatsapp';
        firstTouchCount.set(ftSource, (firstTouchCount.get(ftSource) ?? 0) + 1);

        const customProj = (lead as unknown as { customFields?: Record<string, string> }).customFields?.proyecto;
        const meta = lead.metadata as { project?: string; smarthomeProyectoOriginal?: string } | undefined;
        const rawProj = lead.projectInterest || customProj || meta?.project || meta?.smarthomeProyectoOriginal || lead.firstTouch?.project;
        const cleanProj = normalizeProject(Array.isArray(rawProj) ? rawProj[0] : rawProj);
        if (cleanProj && cleanProj !== 'Sin especificar' && cleanProj !== 'Otros / Por Clasificar') {
          projectCount.set(cleanProj, (projectCount.get(cleanProj) ?? 0) + 1);
        }

        const key = lead.assignedTo ?? '__none__';
        advisorCount.set(key, (advisorCount.get(key) ?? 0) + 1);

        const createdMs = getCreatedMs(lead);
        if (createdMs >= since7)  newLeads7d++;
        if (createdMs >= since30) newLeads30d++;
        const dayKey = createdMs ? new Date(createdMs).toISOString().slice(0, 10) : '';
        if (dayKey && dailyMap.has(dayKey)) dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1);

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

      let upcoming = 0, completed = 0, canceled = 0;
      const appointmentAdvisorCount = new Map<string, {
        total: number;
        upcoming: number;
        completed: number;
        canceled: number;
      }>();

      for (const a of apptsSubset) {
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
        } else if (a.status === 'canceled') {
          canceled++;
          advisorStats.canceled++;
        } else if (a.status === 'scheduled') {
          const apptMs = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
          if (apptMs >= now) {
            upcoming++;
            advisorStats.upcoming++;
          }
        }

        appointmentAdvisorCount.set(advisorKey, advisorStats);
      }

      const total = leads.length;
      const converted = statusCount['scheduled'] + statusCount['closed'];
      const conversionRate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;

      return {
        month: monthKey,
        label,
        totalLeads: total,
        inboxBreakdown: {
          central317Count:    central317Leads.length,
          advisorDirectCount: advisorDirectSubset.length,
          reactivatedCount,
          allContactsTotal:   central317Leads.length + advisorDirectSubset.length,
        },
        leadsByStatus: LEAD_STATUSES.map((s) => ({ status: s, count: statusCount[s] })),
        leadsBySource: LEAD_SOURCES.map((s) => ({ source: s, count: sourceCount[s] }))
          .filter((x) => x.count > 0),
        firstTouchBySource: [...firstTouchCount.entries()]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count),
        leadsByProject: [...projectCount.entries()]
          .map(([project, count]) => ({ project, count }))
          .sort((a, b) => b.count - a.count),
        leadsByAdvisor: [...advisorCount.entries()]
          .map(([id, count]) => ({
            advisorId: id === '__none__' ? null : id,
            name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
            count,
          }))
          .sort((a, b) => b.count - a.count),
        appointments:  { total: apptsSubset.length, upcoming, completed, canceled },
        appointmentsByAdvisor: [...appointmentAdvisorCount.entries()]
          .map(([id, stats]) => ({
            advisorId: id === '__none__' ? null : id,
            name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
            ...stats,
          }))
          .sort((a, b) => b.total - a.total),
        conversionRate,
        newLeads7d,
        newLeads30d,
        dailyNewLeads: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
        aiInsights,
        generatedAt: now,
      };
    }

    // Agrupar leads estrictos de pauta por períodos (días, semanas, mes a mes)
    const subsets: Record<string, Lead[]> = {
      today:     pautaLeads.filter((l) => getCreatedMs(l) >= startOfToday),
      yesterday: pautaLeads.filter((l) => {
        const ms = getCreatedMs(l);
        return ms >= startOfYesterday && ms < startOfToday;
      }),
      '7d':      pautaLeads.filter((l) => getCreatedMs(l) >= since7d),
      '14d':     pautaLeads.filter((l) => getCreatedMs(l) >= since14d),
      '30d':     pautaLeads.filter((l) => getCreatedMs(l) >= since30d),
      '2026-10': pautaLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-10'),
      '2026-09': pautaLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-09'),
      '2026-08': pautaLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-08'),
      all:       pautaLeads,
    };

    // Agrupar leads directos de WhatsApp de asesores por períodos correspondientes
    const advisorDirectSubsets: Record<string, Lead[]> = {
      today:     advisorDirectLeads.filter((l) => getCreatedMs(l) >= startOfToday),
      yesterday: advisorDirectLeads.filter((l) => {
        const ms = getCreatedMs(l);
        return ms >= startOfYesterday && ms < startOfToday;
      }),
      '7d':      advisorDirectLeads.filter((l) => getCreatedMs(l) >= since7d),
      '14d':     advisorDirectLeads.filter((l) => getCreatedMs(l) >= since14d),
      '30d':     advisorDirectLeads.filter((l) => getCreatedMs(l) >= since30d),
      '2026-10': advisorDirectLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-10'),
      '2026-09': advisorDirectLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-09'),
      '2026-08': advisorDirectLeads.filter((l) => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-08'),
      all:       advisorDirectLeads,
    };

    const apptsSubsets: Record<string, Appointment[]> = {
      today:     appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms >= startOfToday;
      }),
      yesterday: appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms >= startOfYesterday && ms < startOfToday;
      }),
      '7d':      appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms >= since7d;
      }),
      '14d':     appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms >= since14d;
      }),
      '30d':     appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms >= since30d;
      }),
      '2026-10': appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-10' : false;
      }),
      '2026-09': appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-09' : false;
      }),
      '2026-08': appts.filter((a) => {
        const ms = (a.startTime as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
        return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-08' : false;
      }),
      all:       appts,
    };

    const monthsData: Record<string, ReturnType<typeof computeSubset>> = {};
    const availableMonths = [
      // ⚡ Días y Semanas
      { key: 'today',     label: '⚡ Hoy',                             count: subsets.today.length + (advisorDirectSubsets.today?.length || 0),     group: 'dias' },
      { key: 'yesterday', label: '⚡ Ayer',                            count: subsets.yesterday.length + (advisorDirectSubsets.yesterday?.length || 0), group: 'dias' },
      { key: '7d',        label: '⚡ Últimos 7 días (Esta semana)',    count: subsets['7d'].length + (advisorDirectSubsets['7d']?.length || 0),      group: 'dias' },
      { key: '14d',       label: '⚡ Últimas 2 semanas (14 días)',     count: subsets['14d'].length + (advisorDirectSubsets['14d']?.length || 0),     group: 'dias' },
      { key: '30d',       label: '⚡ Últimos 30 días',                 count: subsets['30d'].length + (advisorDirectSubsets['30d']?.length || 0),     group: 'dias' },
      // 📅 Mes a Mes
      { key: '2026-10',   label: '📅 Octubre 2026 (Mes actual)',       count: subsets['2026-10'].length + (advisorDirectSubsets['2026-10']?.length || 0), group: 'meses' },
      { key: '2026-09',   label: '📅 Septiembre 2026',                 count: subsets['2026-09'].length + (advisorDirectSubsets['2026-09']?.length || 0), group: 'meses' },
      { key: '2026-08',   label: '📅 Agosto 2026',                     count: subsets['2026-08'].length + (advisorDirectSubsets['2026-08']?.length || 0), group: 'meses' },
      // 🚀 Período Activo Completo
      { key: 'all',       label: '🚀 Todo el período Operativo (Agosto - Octubre 2026)', count: subsets.all.length + (advisorDirectSubsets.all?.length || 0), group: 'total' },
    ];

    for (const item of availableMonths) {
      const k = item.key;
      const lSubset = subsets[k] || [];
      const dirSubset = advisorDirectSubsets[k] || [];
      const aSubset = apptsSubsets[k] || [];
      monthsData[k] = computeSubset(lSubset, dirSubset, aSubset, k, item.label);
    }

    const databaseStats = {
      totalContacts: scopedRawLeads.length,
      migratedSmarthome: migratedLeads.length,
      pautaTotal: pautaLeads.length,
      activeAdvisorsAssigned: scopedRawLeads.filter((l) => l.assignedTo).length,
      unassignedOrFormer: scopedRawLeads.filter((l) => !l.assignedTo).length,
    };

    // Por defecto siempre mostrar el mes actual
    const defaultMonthKey = '2026-10';
    const defaultMetrics = monthsData[defaultMonthKey] || monthsData['all'];

    return {
      ...defaultMetrics,
      defaultMonth: defaultMonthKey,
      availableMonths,
      monthsData,
      databaseStats,
    };
    }, refresh);
  }
);
