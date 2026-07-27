import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { messagesRepository } from '../modules/messages/messages.repository';
import type { Lead, LeadStatus } from '../modules/leads/leads.types';
import type { Appointment } from '../modules/appointments/appointments.types';

const LEAD_STATUSES: LeadStatus[] = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'];
const OPEN_STATUSES = new Set<LeadStatus>(['new', 'active', 'qualified', 'scheduled']);
const STALE_MS = 3 * 86_400_000;   // 3 días sin actividad = estancado
const HOUR_MS  = 3_600_000;
const MAX_MSGS_PER_LEAD = 300;

interface UserDoc { displayName?: string; email?: string }

/** Acumulador por asesor mientras se recorren leads y mensajes. */
interface AdvisorAcc {
  advisorId:   string;
  name:        string;
  leads:       number;
  byStatus:    Record<LeadStatus, number>;
  scoreSum:    number;
  scored:      number;
  advisorMsgs: number;
  handled:     number;   // leads con ≥1 mensaje del asesor
  waiting:     number;   // último mensaje es del lead (esperando respuesta)
  stale:       number;   // lead abierto sin actividad > 3 días
  responseMs:  number[]; // tiempos de respuesta del asesor (ms)
  appts:       { total: number; completed: number; upcoming: number; canceled: number };
}

function newAcc(advisorId: string, name: string): AdvisorAcc {
  return {
    advisorId, name, leads: 0,
    byStatus: Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>,
    scoreSum: 0, scored: 0, advisorMsgs: 0, handled: 0, waiting: 0, stale: 0,
    responseMs: [], appts: { total: 0, completed: 0, upcoming: 0, canceled: 0 },
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export const getAdvisorReports = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, rangeDays } = z.object({
      companyId: z.string().min(1),
      rangeDays: z.number().int().min(0).max(365).default(30),  // 0 = todo el histórico
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const companyRef = db.collection('companies').doc(companyId);
    const [leadsSnap, usersSnap, apptsSnap] = await Promise.all([
      companyRef.collection('leads').get(),
      companyRef.collection('users').get(),
      companyRef.collection('appointments').get(),
    ]);

    const now = Date.now();
    const since = rangeDays > 0 ? now - rangeDays * 86_400_000 : 0;

    // Asesores (incluye los que quizá no tengan leads en el periodo)
    const accById = new Map<string, AdvisorAcc>();
    usersSnap.docs.forEach((d) => {
      const u = d.data() as UserDoc;
      accById.set(d.id, newAcc(d.id, u.displayName || u.email || d.id));
    });
    const getAcc = (advisorId: string): AdvisorAcc => {
      let acc = accById.get(advisorId);
      if (!acc) { acc = newAcc(advisorId, advisorId); accById.set(advisorId, acc); }
      return acc;
    };

    // ── Citas por asesor (dentro del periodo, por startTime) ───────────────────
    for (const doc of apptsSnap.docs) {
      const a = { id: doc.id, ...doc.data() } as Appointment;
      if (!a.advisorId) continue;
      const ms = a.startTime?.toMillis?.() ?? 0;
      if (since && ms < since) continue;
      const acc = getAcc(a.advisorId);
      acc.appts.total++;
      if (a.status === 'completed') acc.appts.completed++;
      else if (a.status === 'canceled') acc.appts.canceled++;
      else if (a.status === 'scheduled' && ms >= now) acc.appts.upcoming++;
    }

    // ── Leads asignados dentro del periodo + análisis de sus mensajes ──────────
    const leads = leadsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Lead))
      .filter((l) => l.assignedTo)
      .filter((l) => !since || (l.createdAt?.toMillis?.() ?? 0) >= since);

    for (const lead of leads) {
      const acc = getAcc(lead.assignedTo!);
      acc.leads++;
      if (lead.status in acc.byStatus) acc.byStatus[lead.status]++;
      if (typeof lead.aiAnalysis?.score === 'number') { acc.scoreSum += lead.aiAnalysis.score; acc.scored++; }

      // Estancado: abierto y sin actividad > 3 días
      if (OPEN_STATUSES.has(lead.status)) {
        const lastMs = lead.lastMessageAt?.toMillis?.() ?? lead.createdAt?.toMillis?.() ?? 0;
        if (now - lastMs > STALE_MS) acc.stale++;
      }

      // Tiempos de respuesta del asesor (recorre mensajes cronológicos)
      const msgs = await messagesRepository.getRecent(companyId, lead.id, MAX_MSGS_PER_LEAD);
      let pendingInbound: number | null = null;
      let advisorMsgsInLead = 0;
      for (const m of msgs) {
        const t = m.createdAt?.toMillis?.() ?? 0;
        if (m.senderType === 'lead') {
          if (pendingInbound === null) pendingInbound = t;
        } else if (m.direction === 'outbound') {
          if (m.senderType === 'advisor') advisorMsgsInLead++;
          if (pendingInbound !== null) {
            // Solo cuenta como respuesta del asesor si quien respondió fue el asesor.
            if (m.senderType === 'advisor') acc.responseMs.push(t - pendingInbound);
            pendingInbound = null;
          }
        }
      }
      acc.advisorMsgs += advisorMsgsInLead;
      if (advisorMsgsInLead > 0) acc.handled++;
      // Esperando: el último mensaje del hilo es del lead
      if (msgs.length > 0 && msgs[msgs.length - 1].senderType === 'lead') acc.waiting++;
    }

    // ── Serializar por asesor ──────────────────────────────────────────────────
    const advisors = [...accById.values()]
      .map((a) => {
        const converted = a.byStatus.scheduled + a.byStatus.closed;
        const within1h = a.responseMs.filter((ms) => ms <= HOUR_MS).length;
        const avgMs = a.responseMs.length ? a.responseMs.reduce((s, x) => s + x, 0) / a.responseMs.length : 0;
        return {
          advisorId:       a.advisorId,
          name:            a.name,
          leads:           a.leads,
          byStatus:        a.byStatus,
          conversionRate:  pct(converted, a.leads),
          closedRate:      pct(a.byStatus.closed, a.leads),
          appts:           a.appts,
          avgScore:        a.scored ? Math.round(a.scoreSum / a.scored) : 0,
          advisorMsgs:     a.advisorMsgs,
          handled:         a.handled,
          responseSamples: a.responseMs.length,
          avgResponseMin:  a.responseMs.length ? Math.round(avgMs / 60_000) : null,
          medianResponseMin: a.responseMs.length ? Math.round(median(a.responseMs) / 60_000) : null,
          within1hRate:    a.responseMs.length ? pct(within1h, a.responseMs.length) : null,
          waiting:         a.waiting,
          stale:           a.stale,
        };
      })
      .sort((a, b) => b.leads - a.leads);

    // ── Totales de equipo ──────────────────────────────────────────────────────
    const totalLeads = advisors.reduce((s, a) => s + a.leads, 0);
    const totalConverted = advisors.reduce((s, a) => s + a.byStatus.scheduled + a.byStatus.closed, 0);
    const totalClosed = advisors.reduce((s, a) => s + a.byStatus.closed, 0);
    const allResp = advisors.flatMap((a) => (a.avgResponseMin !== null ? [{ min: a.avgResponseMin, n: a.responseSamples }] : []));
    const respWeightedSum = allResp.reduce((s, r) => s + r.min * r.n, 0);
    const respTotalN = allResp.reduce((s, r) => s + r.n, 0);

    return {
      rangeDays,
      generatedAt: now,
      team: {
        advisors:        advisors.filter((a) => a.leads > 0).length,
        totalLeads,
        conversionRate:  pct(totalConverted, totalLeads),
        closedRate:      pct(totalClosed, totalLeads),
        avgResponseMin:  respTotalN ? Math.round(respWeightedSum / respTotalN) : null,
        waiting:         advisors.reduce((s, a) => s + a.waiting, 0),
        stale:           advisors.reduce((s, a) => s + a.stale, 0),
      },
      advisors,
    };
  }
);
