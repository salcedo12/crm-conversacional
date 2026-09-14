import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { getCachedReport } from '../lib/reportCache';
import { messagesRepository } from '../modules/messages/messages.repository';
import {
  computeStatsFromMessages,
  emptyStats,
  medianMinFromBuckets,
  STATS_BUCKET_COUNT,
} from '../modules/leads/leadStats.service';
import type { Lead, LeadStatus } from '../modules/leads/leads.types';
import { countsAs317LineLead } from '../modules/leads/leadClassification';
import type { Appointment } from '../modules/appointments/appointments.types';

const LEAD_STATUSES: LeadStatus[] = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'];
const OPEN_STATUSES = new Set<LeadStatus>(['new', 'active', 'qualified', 'scheduled']);
const STALE_MS = 3 * 86_400_000;   // 3 días sin actividad = estancado
const MAX_MSGS_PER_LEAD = 300;     // solo para el fallback de leads sin stats
const MAX_STATS_FALLBACKS = 25;    // tope de leads sin stats a los que se les leen mensajes por informe
const NIGHT_END_HOUR = 6;          // entró antes de las 6am (madrugada) en hora Colombia
const MAX_ATTENTION = 150;         // tope de leads listados en el panel de atención

/** Motivo por el que un lead abierto necesita atención. */
type AttentionReason = 'no_first_contact' | 'waiting_reply' | 'stale';

interface AttentionItem {
  leadId:      string;
  name:        string;
  phone:       string;
  status:      LeadStatus;
  advisorId:   string;
  advisorName: string;
  reason:      AttentionReason;
  /** Minutos que lleva esperando (primer contacto o respuesta). */
  waitingMin?: number;
  /** Días sin actividad (para estancados). */
  staleDays?:  number;
  /** true si el lead entró de madrugada (antes de las 6am hora Colombia). */
  night:       boolean;
  createdHour: number;   // hora local (0-23) en que entró; -1 si se desconoce
  lastText:    string;
  advisorMsgs: number;
  /** Solo para ordenar en el servidor; ms de espera/estancamiento. */
  severity:    number;
}

const _bogotaHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false });
function bogotaHour(ms: number): number {
  return Number(_bogotaHourFmt.format(new Date(ms))) % 24;
}

interface UserDoc { displayName?: string; email?: string }

interface ReassignmentEvent {
  leadId?: string;
  leadName?: string;
  leadPhone?: string;
  previousAdvisorId?: string;
  newAdvisorId?: string;
  reason?: string;
  reassignedAt?: FirebaseFirestore.Timestamp;
}

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
  reassignmentsLost:     number;
  reassignmentsReceived: number;
  // Agregados de tiempo de respuesta (sumados desde lead.stats).
  responseCount:    number; // muestras
  responseSumMs:    number; // suma → promedio = sum / count
  responseWithin1h: number; // muestras ≤ 1h
  responseBuckets:  number[]; // histograma, para estimar la mediana
  appts:       { total: number; completed: number; upcoming: number; canceled: number };
}

function newAcc(advisorId: string, name: string): AdvisorAcc {
  return {
    advisorId, name, leads: 0,
    byStatus: Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>,
    scoreSum: 0, scored: 0, advisorMsgs: 0, handled: 0, waiting: 0, stale: 0,
    reassignmentsLost: 0, reassignmentsReceived: 0,
    responseCount: 0, responseSumMs: 0, responseWithin1h: 0,
    responseBuckets: new Array(STATS_BUCKET_COUNT).fill(0),
    appts: { total: 0, completed: 0, upcoming: 0, canceled: 0 },
  };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export const getAdvisorReports = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, rangeDays, refresh } = z.object({
      companyId: z.string().min(1),
      rangeDays: z.number().int().min(0).max(365).default(30),  // 0 = todo el histórico
      refresh:   z.boolean().optional(),                        // true = ignora caché y recalcula
    }).parse(request.data);
    assertCompany(ctx, companyId);

    // TTL 10 min: el informe (que escanea todos los leads × hasta 300 mensajes en
    // cada apertura) se recalcula, como máximo, una vez cada 10 min por rango.
    return getCachedReport(companyId, `advisors__${rangeDays}`, 10 * 60_000, async () => {
    const companyRef = db.collection('companies').doc(companyId);

    const now = Date.now();
    const since = rangeDays > 0 ? now - rangeDays * 86_400_000 : 0;
    // Con rango acotado (7/30/90 días) filtramos por fecha EN LA QUERY, no en
    // memoria: así no se relee toda la colección histórica en cada informe (era
    // la causa base de lecturas). `since = 0` (Todo) sigue leyendo todo. Son
    // filtros de un solo campo → usan el índice automático de Firestore, sin
    // necesidad de índices compuestos.
    const sinceTs     = since > 0 ? Timestamp.fromMillis(since) : null;
    const leadsCol    = companyRef.collection('leads');
    const apptsCol    = companyRef.collection('appointments');
    const reassignCol = companyRef.collection('leadReassignmentEvents');

    const [leadsSnap, usersSnap, apptsSnap, reassignmentSnap] = await Promise.all([
      (sinceTs ? leadsCol.where('createdAt', '>=', sinceTs) : leadsCol).get(),
      companyRef.collection('users').get(),
      (sinceTs ? apptsCol.where('startTime', '>=', sinceTs) : apptsCol).get(),
      (sinceTs ? reassignCol.where('reassignedAt', '>=', sinceTs) : reassignCol).get(),
    ]);

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
    const advisorName = (advisorId?: string) => advisorId ? (accById.get(advisorId)?.name ?? advisorId) : 'Sin asesor';

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
    const recentReassignments: {
      leadId: string;
      leadName: string;
      leadPhone: string;
      previousAdvisorId: string | null;
      previousAdvisorName: string;
      newAdvisorId: string | null;
      newAdvisorName: string;
      reason: string;
      reassignedAt: number;
    }[] = [];

    for (const doc of reassignmentSnap.docs) {
      const event = doc.data() as ReassignmentEvent;
      const ms = event.reassignedAt?.toMillis?.() ?? 0;
      if (!ms || (since && ms < since)) continue;

      if (event.previousAdvisorId) getAcc(event.previousAdvisorId).reassignmentsLost++;
      if (event.newAdvisorId) getAcc(event.newAdvisorId).reassignmentsReceived++;

      recentReassignments.push({
        leadId: event.leadId ?? '',
        leadName: event.leadName ?? event.leadPhone ?? 'Lead',
        leadPhone: event.leadPhone ?? '',
        previousAdvisorId: event.previousAdvisorId ?? null,
        previousAdvisorName: advisorName(event.previousAdvisorId),
        newAdvisorId: event.newAdvisorId ?? null,
        newAdvisorName: advisorName(event.newAdvisorId),
        reason: event.reason ?? 'first-contact-timeout',
        reassignedAt: ms,
      });
    }

    const leads = leadsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Lead))
      .filter(countsAs317LineLead)  // solo pauta + formularios + WhatsApp directo al 317
      .filter((l) => l.assignedTo)
      .filter((l) => !since || (l.createdAt?.toMillis?.() ?? 0) >= since);

    // Panel de atención: clasificación determinista (sin IA) de qué leads
    // abiertos requieren acción y por qué. Reutiliza el mismo escaneo de leads.
    const attention: AttentionItem[] = [];
    let statsFallbacks = 0;   // leads sin stats que ya usaron el fallback de mensajes (tope: MAX_STATS_FALLBACKS)

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

      // Métricas de mensajería desde lead.stats (mantenido por onMessageCreated).
      // Fallback ACOTADO: si el lead aún no tiene stats (creado antes del backfill)
      // se calculan leyendo sus mensajes, PERO solo para los primeros
      // MAX_STATS_FALLBACKS leads del informe. Sin este tope, una empresa con el
      // backfill pendiente disparaba un fan-out de (nº leads × 300 mensajes) de
      // lecturas en cada apertura del informe (causa del pico). Los leads sin stats
      // que exceden el tope cuentan como "sin actividad" hasta que el
      // backfill/trigger les llene stats.
      let s = lead.stats;
      if (!s) {
        if (statsFallbacks < MAX_STATS_FALLBACKS) {
          statsFallbacks++;
          const msgs = await messagesRepository.getRecent(companyId, lead.id, MAX_MSGS_PER_LEAD);
          s = computeStatsFromMessages(msgs);
        } else {
          s = emptyStats();
        }
      }
      acc.advisorMsgs      += s.advisorMsgCount;
      if (s.advisorMsgCount > 0) acc.handled++;
      if (s.waitingReply) acc.waiting++;
      acc.responseCount    += s.responseCount;
      acc.responseSumMs    += s.responseSumMs;
      acc.responseWithin1h += s.responseWithin1h;
      for (let i = 0; i < acc.responseBuckets.length; i++) {
        acc.responseBuckets[i] += Number(s.responseBuckets?.[i] ?? 0);
      }

      // ── Clasificación de atención (solo leads abiertos) ─────────────────────
      if (OPEN_STATUSES.has(lead.status)) {
        const createdMs = lead.createdAt?.toMillis?.() ?? 0;
        const lastMs    = lead.lastMessageAt?.toMillis?.() ?? createdMs;
        const night     = createdMs ? bogotaHour(createdMs) < NIGHT_END_HOUR : false;
        const advisorMsgs = s.advisorMsgCount;
        // Nunca contactado: bandera de primer contacto pendiente, o el asesor no
        // ha escrito nunca y el lead sí escribió (madrugada incluida).
        const neverContacted = lead.pendingFirstContact === true
          || (advisorMsgs === 0 && (!!lead.lastInboundAt || night));

        let reason: AttentionReason | null = null;
        let severity = 0;
        let waitingMin: number | undefined;
        let staleDays: number | undefined;
        const staleMs = now - lastMs;

        if (neverContacted) {
          reason = 'no_first_contact';
          const startMs = lead.advisorAssignedAt?.toMillis?.() ?? createdMs ?? now;
          severity = now - startMs;
          waitingMin = Math.max(0, Math.round(severity / 60_000));
        } else if (s.waitingReply) {
          reason = 'waiting_reply';
          const pendMs = s.pendingInboundAt?.toMillis?.() ?? lastMs;
          severity = now - pendMs;
          waitingMin = Math.max(0, Math.round(severity / 60_000));
        } else if (staleMs > STALE_MS) {
          reason = 'stale';
          severity = staleMs;
          staleDays = Math.round(staleMs / 86_400_000);
        }

        if (reason) {
          attention.push({
            leadId:      lead.id,
            name:        lead.name || lead.phone || 'Lead',
            phone:       lead.phone || '',
            status:      lead.status,
            advisorId:   lead.assignedTo!,
            advisorName: acc.name,
            reason,
            waitingMin,
            staleDays,
            night,
            createdHour: createdMs ? bogotaHour(createdMs) : -1,
            lastText:    (lead.lastMessageText || '').slice(0, 90),
            advisorMsgs,
            severity,
          });
        }
      }
    }

    // Conteos por categoría sobre TODA la lista (antes de recortar) + recorte a top-N.
    const attentionCounts = {
      noFirstContact: attention.filter((a) => a.reason === 'no_first_contact').length,
      waitingReply:   attention.filter((a) => a.reason === 'waiting_reply').length,
      stale:          attention.filter((a) => a.reason === 'stale').length,
      night:          attention.filter((a) => a.night).length,
    };
    const attentionItems = attention
      .sort((a, b) => b.severity - a.severity)
      .slice(0, MAX_ATTENTION)
      .map((a): Omit<AttentionItem, 'severity'> => ({
        leadId: a.leadId, name: a.name, phone: a.phone, status: a.status,
        advisorId: a.advisorId, advisorName: a.advisorName, reason: a.reason,
        waitingMin: a.waitingMin, staleDays: a.staleDays, night: a.night,
        createdHour: a.createdHour, lastText: a.lastText, advisorMsgs: a.advisorMsgs,
      }));

    // ── Serializar por asesor ──────────────────────────────────────────────────
    const advisors = [...accById.values()]
      .map((a) => {
        const converted = a.byStatus.scheduled + a.byStatus.closed;
        const avgMs = a.responseCount ? a.responseSumMs / a.responseCount : 0;
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
          responseSamples: a.responseCount,
          avgResponseMin:  a.responseCount ? Math.round(avgMs / 60_000) : null,
          medianResponseMin: a.responseCount ? medianMinFromBuckets(a.responseBuckets) : null,
          within1hRate:    a.responseCount ? pct(a.responseWithin1h, a.responseCount) : null,
          waiting:         a.waiting,
          stale:           a.stale,
          reassignmentsLost: a.reassignmentsLost,
          reassignmentsReceived: a.reassignmentsReceived,
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
        reassignmentsLost: advisors.reduce((s, a) => s + a.reassignmentsLost, 0),
      },
      advisors,
      attention: {
        counts: attentionCounts,
        items:  attentionItems,
      },
      reassignments: {
        total: recentReassignments.length,
        // Se envían todas (recortadas a 500 por seguridad de tamaño); el frontend
        // las agrupa por día y permite buscar/filtrar. Antes solo se enviaban 12.
        recent: recentReassignments
          .sort((a, b) => b.reassignedAt - a.reassignedAt)
          .slice(0, 500),
      },
    };
    }, refresh);
  }
);
