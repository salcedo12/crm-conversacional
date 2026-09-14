import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { getCachedReport } from '../lib/reportCache';
import {
  getSmartHomeProspectSummariesByPhones,
  getSmartHomeProspectEvents,
  type SmartHomeEvent,
} from '../integrations/smarthome/smarthome.client';
import { isAdvisorNote, cleanNoteText, classifyBitacora } from '../modules/smarthome/bitacoraClassify';
import type { Lead, LeadStatus } from '../modules/leads/leads.types';
import { countsAs317LineLead } from '../modules/leads/leadClassification';
import { medianMinFromBuckets, STATS_BUCKET_COUNT } from '../modules/leads/leadStats.service';
import type { LeadLossCategory } from '../modules/ai/leadAnalysis.types';

/**
 * Informe 317 — vista consolidada de TODO lo que entró por la línea 317 (pauta
 * click-to-WhatsApp, formularios/web y WhatsApp orgánico al 317). EXCLUYE los
 * datos que entran directo al WhatsApp del asesor (`advisor_whatsapp`), vía
 * {@link countsAs317LineLead}.
 *
 * Añade sobre el informe por asesor:
 *  - Desglose por SEGMENTO de pauta (España vs Corferias) y por campaña/anuncio.
 *  - Análisis de chat "por qué no compró" (agregado de lead.aiAnalysis).
 *  - Cobertura de BITÁCORA en SmartHome por asesor: de sus clientes en SmartHome,
 *    en cuántos escribió al menos una nota (evento no-sistema).
 *
 * La bitácora se lee de campos denormalizados en el lead (`smartHomeAdvisorNotes`,
 * `smartHomeLastBitacoraAt`, …) que puebla `refresh:true` con un escaneo masivo
 * por teléfono de SmartHome (mismo patrón que getWeeklyFollowUpReport).
 */

const LEAD_STATUSES: LeadStatus[] = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'];
const CONVERTED = new Set<LeadStatus>(['scheduled', 'closed']);
const MAX_ADS = 40;
const MAX_LEADS_OUT = 800;
const MAX_SH_PHONES = 800;   // tope de teléfonos a escanear en SmartHome por refresh
const CACHE_TTL_MS = 15 * 60_000;

const LOSS_LABEL: Record<LeadLossCategory, string> = {
  precio: 'Precio/presupuesto', ubicacion: 'Ubicación', competencia: 'Competencia',
  sin_respuesta: 'Dejó de responder', tiempo: 'No es el momento', no_califica: 'No califica',
  atencion: 'Mala atención/demora', otro: 'Otro', ninguno: 'Sin riesgo claro',
};

interface UserDoc { displayName?: string; email?: string }
interface ReassignmentEvent {
  leadId?: string;
  previousAdvisorId?: string;
  newAdvisorId?: string;
  reassignedAt?: FirebaseFirestore.Timestamp;
}

const msOf = (t?: FirebaseFirestore.Timestamp | null): number => (t?.toMillis?.() ?? 0);
function phoneKey(v?: string): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}
function parseSmartHomeDate(v?: string): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Contenidos AUTOMÁTICOS de la bitácora de SmartHome (no los escribe el asesor):
 * registro del cliente, actualización de datos, asignación de canal y oportunidad
 * generada por WhatsApp. Se excluyen para no inflar "el asesor llenó bitácora".
 *
 * OJO: NO se filtra por la etiqueta de acción "CITA PROGRAMADA IA" — el agente
 * móvil de SmartHome guarda las notas HUMANAS del asesor bajo esa acción (p. ej.
 * "NO LE INTERESA EN EL TOLIMA, DESEA EN EL EJE CAFETERO, desde agente móvil").
 * El `userId` tampoco sirve: hasta los eventos de sistema quedan a nombre del
 * asesor dueño. Lo fiable es acción "Evento del Sistema" + estas plantillas.
 */

/**
 * Etapa de VENTA en SmartHome (promesa firmada / escritura / vendido). Es una de
 * las dos señales; la VENTA CONFIRMADA exige además que el lead esté "Vendido"
 * (status closed) en el CRM — así Doll/HELMAN (Vendido en CRM + promesa en SH)
 * cuentan, pero un "Vendido" del CRM sin etapa de venta en SH (posible cierre mal
 * marcado) o una promesa en SH sin Vendido en CRM se marcan como "revisar".
 */
const SALE_STAGE_RE = /firma de (promesa|contrato)|promesa firmada|escritur|vendid|venta realizada|entrega/i;
function hasSaleStage(stage?: string): boolean {
  return SALE_STAGE_RE.test(stage ?? '');
}

/**
 * Origen/plataforma del dato para desglosar la pauta:
 *  - meta_ads con formId → formulario de Meta (Lead Ads)
 *  - meta_ads sin formId → click-to-WhatsApp (anuncio en FB/IG)
 *  - web → formulario de la página
 *  - whatsapp → WhatsApp orgánico directo al 317
 */
function sourceLabel(l: Lead): string {
  if (l.source === 'meta_ads') {
    return l.metadata?.metaFormId ? 'Pauta · Formulario Meta' : 'Pauta · Click a WhatsApp';
  }
  if (l.source === 'web') return 'Página web (formulario)';
  if (l.source === 'whatsapp') return 'WhatsApp orgánico (317)';
  return l.source;
}

/** Nombre legible de campaña/anuncio a partir de los metadatos de atribución. */
function campaignLabel(l: Lead): string {
  const m = l.metadata ?? {};
  return m.metaCampaignName || m.webUtmCampaign || m.utm_campaign || m.metaFormName || '(sin campaña)';
}
function adLabel(l: Lead): string {
  const m = l.metadata ?? {};
  return m.metaAdName || l.sourceMeta?.headline || m.metaFormName || '(sin anuncio)';
}
/** Segmento de pauta: España vs Corferias vs Otro, por nombres + país del teléfono. */
function segmentOf(l: Lead): 'España' | 'Corferias' | 'Otro/Sin segmento' {
  const m = l.metadata ?? {};
  const blob = [m.metaCampaignName, m.metaAdsetName, m.metaAdName, m.metaFormName, m.webUtmCampaign, m.utm_campaign, l.sourceMeta?.headline]
    .filter(Boolean).join(' | ').toLowerCase();
  const spainPhone = String(l.phone ?? '').startsWith('+34');
  if (/espa[nñ]a|spain|madrid|barcelona/.test(blob) || spainPhone) return 'España';
  if (/corferias|feria/.test(blob)) return 'Corferias';
  return 'Otro/Sin segmento';
}

/** Campos denormalizados de SmartHome persistidos en el lead. */
function shField<T>(l: Lead, key: string): T | undefined {
  return (l as unknown as Record<string, unknown>)[key] as T | undefined;
}

/** Cliente que SÍ está en SmartHome pero el asesor no le ha escrito ninguna nota. */
interface MissingBitacoraLead {
  leadId: string; name: string; phone: string; createdAt: number;
  shStage: string; shLastEvent: string; shLastEventAt: number | null;
}

interface AdvisorAcc {
  advisorId: string; name: string; leads: number;
  byStatus: Record<LeadStatus, number>; converted: number; closed: number;
  scoreSum: number; scored: number;
  respCount: number; respSumMs: number; respWithin1h: number; advisorMsgs: number;
  respBuckets: number[];
  firstContactDelays: number[]; neverContacted: number; handled: number; respondedLeads: number; attendedLeads: number;
  reassignLost: number; reassignReceived: number;
  shFound: number; shWithNote: number; shNotesTotal: number; sales: number;
  missingBitacora: MissingBitacoraLead[];
}
function newAcc(advisorId: string, name: string): AdvisorAcc {
  return {
    advisorId, name, leads: 0,
    byStatus: Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>,
    converted: 0, closed: 0, scoreSum: 0, scored: 0,
    respCount: 0, respSumMs: 0, respWithin1h: 0, advisorMsgs: 0,
    respBuckets: new Array(STATS_BUCKET_COUNT).fill(0),
    firstContactDelays: [], neverContacted: 0, handled: 0, respondedLeads: 0, attendedLeads: 0, reassignLost: 0, reassignReceived: 0,
    shFound: 0, shWithNote: 0, shNotesTotal: 0, sales: 0,
    missingBitacora: [],
  };
}

interface GroupAcc {
  key: string; leads: number; byStatus: Record<string, number>;
  converted: number; closed: number; scoreSum: number; scored: number;
  shFound: number; shNotes: number;
}
function bumpGroup(map: Map<string, GroupAcc>, key: string, l: Lead, sh?: { found: boolean; notes: number }): void {
  let g = map.get(key);
  if (!g) { g = { key, leads: 0, byStatus: {}, converted: 0, closed: 0, scoreSum: 0, scored: 0, shFound: 0, shNotes: 0 }; map.set(key, g); }
  g.leads++;
  g.byStatus[l.status] = (g.byStatus[l.status] ?? 0) + 1;
  if (l.status === 'closed') g.closed++;
  if (CONVERTED.has(l.status)) g.converted++;
  if (typeof l.aiAnalysis?.score === 'number') { g.scoreSum += l.aiAnalysis.score; g.scored++; }
  if (sh?.found) { g.shFound++; g.shNotes += sh.notes; }
}
function finalizeGroups(map: Map<string, GroupAcc>): unknown[] {
  return [...map.values()]
    .map((g) => ({
      key: g.key, leads: g.leads, byStatus: g.byStatus, converted: g.converted, closed: g.closed,
      conversionRate: g.leads ? Math.round((g.converted / g.leads) * 1000) / 10 : 0,
      avgScore: g.scored ? Math.round(g.scoreSum / g.scored) : 0,
      shFound: g.shFound, shAdvisorNotes: g.shNotes,
    }))
    .sort((a, b) => b.leads - a.leads);
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * Índice de gestión 0-100 por asesor. Combina lo que SÍ mide desempeño real:
 *  - Atención (35%): % de datos que contactó a tiempo (vs los que le quitaron).
 *  - Bitácora (35%): % de sus clientes con nota del asesor en SmartHome.
 *  - Resultado (30%): ventas (40 pts c/u) + conversión, tope 100.
 * NO usa la velocidad de respuesta (premia al que atiende poco, ver informe).
 */
function gestionScore(a: { attentionRate: number; bitacoraCoverage: number; sales: number; conversionRate: number }): number {
  const outcome = Math.min(100, a.sales * 40 + a.conversionRate * 3);
  return Math.round(0.35 * a.attentionRate + 0.35 * a.bitacoraCoverage + 0.30 * outcome);
}
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export const getReport317 = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, refresh } = z.object({
      companyId: z.string().min(1),
      refresh: z.boolean().optional().default(false),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    return getCachedReport(companyId, 'report_317_v2', CACHE_TTL_MS, async () => {
      const companyRef = db.collection('companies').doc(companyId);
      const leadsCol = companyRef.collection('leads');

      const [leadsSnap, usersSnap, reassignSnap] = await Promise.all([
        leadsCol.get(),
        companyRef.collection('users').get(),
        companyRef.collection('leadReassignmentEvents').get(),
      ]);

      const userName = new Map<string, string>();
      // Solo los asesores REALES (role 'advisor') aparecen en la tabla por asesor.
      // Administrador / Pruebas / Marketing (role 'admin') se excluyen.
      const advisorRoleIds = new Set<string>();
      for (const d of usersSnap.docs) {
        const u = d.data() as UserDoc & { role?: string };
        userName.set(d.id, u.displayName || u.email || d.id);
        if (u.role === 'advisor') advisorRoleIds.add(d.id);
      }

      const leads = leadsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Lead))
        .filter(countsAs317LineLead)
        .filter((l) => l.assignedTo);

      // ── refresh: escaneo masivo de SmartHome por teléfono + persistencia ──────
      if (refresh) {
        // Como desde el CRM SIEMPRE se crea el cliente en SmartHome, el
        // `smartHomeProspectId` guardado en el lead es la fuente de verdad de "está
        // en SmartHome". Traemos la bitácora POR ESE ID (fiable) y solo caemos a la
        // búsqueda por teléfono para los leads sin prospectId (duplicados/errores de
        // sync). Así el denominador deja de depender del formato del número.
        // BI por teléfono para TODOS: trae etapa + ciclo de venta (para detectar
        // VENTAS) además de la bitácora. La ruta por prospectId solo trae eventos,
        // no la etapa, así que el BI es la fuente de la etapa/venta.
        const allPhones = [...new Set(leads.map((l) => l.phone).filter(Boolean))].slice(0, MAX_SH_PHONES);
        const shByPhone = allPhones.length ? await getSmartHomeProspectSummariesByPhones(allPhones).catch(() => null) : null;

        // Eventos por prospectId (bitácora fiable) para los que el BI no halló por teléfono.
        const needEvents = leads.filter((l) => l.smartHomeProspectId && !(shByPhone?.get(phoneKey(l.phone))?.found));
        const eventsByLead = new Map<string, SmartHomeEvent[]>();
        const CONC = 8;
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(CONC, needEvents.length) }, async () => {
          while (cursor < needEvents.length) {
            const lead = needEvents[cursor++];
            const ev = await getSmartHomeProspectEvents(
              lead.smartHomeProspectId!,
              (lead as unknown as { smartHomeProjectCode?: string }).smartHomeProjectCode,
            ).catch(() => null);
            if (ev) eventsByLead.set(lead.id, ev);
          }
        }));

        const writes: Promise<unknown>[] = [];
        for (const lead of leads) {
          const byPhone = shByPhone?.get(phoneKey(lead.phone));
          const events = (byPhone?.found ? byPhone.events : eventsByLead.get(lead.id)) ?? byPhone?.events ?? eventsByLead.get(lead.id) ?? [];
          const prospectId = lead.smartHomeProspectId || byPhone?.prospectId || '';
          const found = !!prospectId || !!byPhone?.found;
          if (!found && !events.length) continue;

          const advNote = events.find(isAdvisorNote);             // última nota humana del asesor
          const lastAny = events[0];                               // último evento (incl. sistema/IA)
          const advNotes = events.filter(isAdvisorNote).length;
          const advLastAt = advNote ? parseSmartHomeDate(advNote.date) : null;
          const anyLastAt = lastAny ? parseSmartHomeDate(lastAny.date) : null;
          const dup = /duplicado/i.test(String(lead.smartHomeSyncError ?? ''));
          const stage = byPhone?.stage || shField<string>(lead, 'smartHomeStageName') || '';
          const saleCycle = byPhone?.saleCycle || shField<string>(lead, 'smartHomeSaleCycle') || '';
          const closeDate = byPhone?.closeDate || shField<string>(lead, 'smartHomeCloseDate') || '';
          const sold = lead.status === 'closed' && hasSaleStage(stage);   // venta confirmada

          const patch = {
            smartHomeProspectId: prospectId,
            smartHomeFound: found,
            smartHomeDuplicate: dup,
            smartHomeAdvisorName: byPhone?.advisor || byPhone?.seller || shField<string>(lead, 'smartHomeAdvisorName') || '',
            smartHomeStageName: stage,
            smartHomeSaleCycle: saleCycle,
            smartHomeCloseDate: closeDate,
            smartHomeSold: sold,
            smartHomeAdvisorNotes: advNotes,
            smartHomeFollowUps: byPhone?.followUps ?? shField<number>(lead, 'smartHomeFollowUps') ?? 0,
            smartHomeLastBitacoraAt: advLastAt ? Timestamp.fromMillis(advLastAt) : null,
            smartHomeLastBitacoraText: advNote ? cleanNoteText(advNote.content ?? '').slice(0, 300) : '',
            smartHomeLastEventAt: anyLastAt ? Timestamp.fromMillis(anyLastAt) : null,
            smartHomeLastEventText: lastAny?.content?.slice(0, 300) ?? '',
            smartHomeTrackingUpdatedAt: Timestamp.now(),
          };
          writes.push(leadsCol.doc(lead.id).set(patch, { merge: true }));
          Object.assign(lead, patch);
        }
        for (let i = 0; i < writes.length; i += 50) await Promise.all(writes.slice(i, i + 50));
      }

      // ── Reasignaciones ────────────────────────────────────────────────────────
      const leadIds = new Set(leads.map((l) => l.id));
      const accById = new Map<string, AdvisorAcc>();
      for (const [id, name] of userName) accById.set(id, newAcc(id, name));
      const getAcc = (id: string): AdvisorAcc => {
        let a = accById.get(id);
        if (!a) { a = newAcc(id, userName.get(id) ?? id); accById.set(id, a); }
        return a;
      };
      const reassignByLead = new Map<string, number>();
      for (const d of reassignSnap.docs) {
        const e = d.data() as ReassignmentEvent;
        if (e.leadId && leadIds.has(e.leadId)) {
          reassignByLead.set(e.leadId, (reassignByLead.get(e.leadId) ?? 0) + 1);
        }
        if (e.previousAdvisorId) getAcc(e.previousAdvisorId).reassignLost++;
        if (e.newAdvisorId) getAcc(e.newAdvisorId).reassignReceived++;
      }

      // ── Recorrido de leads ────────────────────────────────────────────────────
      const bySegment = new Map<string, GroupAcc>();
      const bySource = new Map<string, GroupAcc>();
      const byCampaign = new Map<string, GroupAcc>();
      const byAd = new Map<string, GroupAcc>();
      const lossAgg = new Map<string, number>();
      const objectionAgg = new Map<string, number>();
      const tempAgg: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
      const leadRows: Record<string, unknown>[] = [];
      const spainClients: Record<string, unknown>[] = [];
      const salesRows: Record<string, unknown>[] = [];
      const salesReviewRows: Record<string, unknown>[] = [];

      for (const l of leads) {
        const acc = getAcc(l.assignedTo!);
        acc.leads++;
        if (l.status in acc.byStatus) acc.byStatus[l.status]++;
        if (l.status === 'closed') acc.closed++;
        if (CONVERTED.has(l.status)) acc.converted++;

        const a = l.aiAnalysis;
        if (a) {
          if (typeof a.score === 'number') { acc.scoreSum += a.score; acc.scored++; }
          if (a.lossCategory) lossAgg.set(a.lossCategory, (lossAgg.get(a.lossCategory) ?? 0) + 1);
          if (a.temperature && tempAgg[a.temperature] !== undefined) tempAgg[a.temperature]++;
          for (const o of a.objections ?? []) {
            const k = String(o).trim().toLowerCase().slice(0, 60);
            if (k) objectionAgg.set(k, (objectionAgg.get(k) ?? 0) + 1);
          }
        }

        const s = l.stats;
        if (s) {
          acc.respCount += s.responseCount ?? 0;
          acc.respSumMs += s.responseSumMs ?? 0;
          acc.respWithin1h += s.responseWithin1h ?? 0;
          acc.advisorMsgs += s.advisorMsgCount ?? 0;
          for (let i = 0; i < acc.respBuckets.length; i++) acc.respBuckets[i] += Number(s.responseBuckets?.[i] ?? 0);
          if ((s.advisorMsgCount ?? 0) > 0) acc.handled++;         // atendido por un humano
          if ((s.responseCount ?? 0) > 0) acc.respondedLeads++;    // datos con respuesta cronometrada
        }
        if (l.advisorFirstContactAt) acc.attendedLeads++;   // hizo primer contacto humano
        if (l.advisorFirstContactAt && l.advisorAssignedAt) {
          const delay = msOf(l.advisorFirstContactAt) - msOf(l.advisorAssignedAt);
          if (delay > 0) acc.firstContactDelays.push(delay);
        } else if (l.pendingFirstContact === true || (s && s.advisorMsgCount === 0)) {
          acc.neverContacted++;
        }

        const shNotes = shField<number>(l, 'smartHomeAdvisorNotes') ?? 0;
        // "Está en SmartHome" = fue creado allí desde el CRM (tiene prospectId) o el
        // escaneo lo halló. Ya no depende de que la búsqueda por teléfono coincida.
        const shFound = shField<boolean>(l, 'smartHomeFound') === true
          || !!shField<string>(l, 'smartHomeProspectId');
        const shDuplicate = shField<boolean>(l, 'smartHomeDuplicate') === true
          || /duplicado/i.test(String(l.smartHomeSyncError ?? ''));
        if (shFound) {
          acc.shFound++;
          acc.shNotesTotal += shNotes;
          if (shNotes > 0) acc.shWithNote++;
        }

        // Venta CONFIRMADA = Vendido en CRM (closed) Y etapa de venta en SmartHome.
        const shStageVal = shField<string>(l, 'smartHomeStageName') ?? '';
        const shHasSaleStage = hasSaleStage(shStageVal);
        const shSold = l.status === 'closed' && shHasSaleStage;
        const shCloseDate = shField<string>(l, 'smartHomeCloseDate') ?? '';
        const shCloseDateAt = parseSmartHomeDate(shCloseDate);
        // Discrepancias a revisar (no cuentan como venta confirmada).
        let saleReview: string | null = null;
        if (l.status === 'closed' && !shHasSaleStage) saleReview = 'crm_vendido_sin_venta_sh';
        else if (shHasSaleStage && l.status !== 'closed') saleReview = 'promesa_sh_sin_vendido_crm';
        if (shSold) acc.sales++;

        const seg = segmentOf(l);
        const shBrief = { found: shFound, notes: shNotes };
        bumpGroup(bySegment, seg, l, shBrief);
        bumpGroup(bySource, sourceLabel(l), l, shBrief);
        bumpGroup(byCampaign, campaignLabel(l), l, shBrief);
        bumpGroup(byAd, adLabel(l), l, shBrief);

        const row = {
          leadId: l.id, name: l.name || l.phone || 'Lead', phone: l.phone || '',
          source: l.source, sourceLabel: sourceLabel(l), segment: seg, campaign: campaignLabel(l), ad: adLabel(l),
          advisorId: l.assignedTo!, advisor: userName.get(l.assignedTo!) ?? 'Sin asesor',
          status: l.status, createdAt: msOf(l.createdAt),
          reassignments: reassignByLead.get(l.id) ?? l.advisorReassignmentCount ?? 0,
          score: a?.score ?? null, temperature: a?.temperature ?? null,
          lossCategory: a?.lossCategory ?? null, lossReason: a?.lossRisk ?? null,
          nextAction: a?.nextAction ?? null, summary: a?.summary ?? null,
          advisorMsgs: s?.advisorMsgCount ?? 0,
          avgResponseMin: s && s.responseCount ? Math.round((s.responseSumMs / s.responseCount) / 60000) : null,
          shFound, shDuplicate, shSold, saleReview, shAdvisorNotes: shNotes,
          ...(() => { const b = classifyBitacora(shField<string>(l, 'smartHomeLastBitacoraText') ?? ''); return { bitSignal: b.signal, bitReason: b.reason ?? null, bitSuggested: b.suggested ?? null }; })(),
          shStage: shField<string>(l, 'smartHomeStageName') ?? '',
          shSaleCycle: shField<string>(l, 'smartHomeSaleCycle') ?? '',
          shCloseDate,
          shCloseDateAt,
          shAdvisor: shField<string>(l, 'smartHomeAdvisorName') ?? '',
          shLastNote: shField<string>(l, 'smartHomeLastBitacoraText') ?? '',
          shLastNoteAt: msOf(shField<FirebaseFirestore.Timestamp>(l, 'smartHomeLastBitacoraAt')) || null,
          shLastEvent: shField<string>(l, 'smartHomeLastEventText') ?? '',
          shLastEventAt: msOf(shField<FirebaseFirestore.Timestamp>(l, 'smartHomeLastEventAt')) || null,
        };
        leadRows.push(row);
        // Está en SmartHome pero SIN nota del asesor → candidato de "falta por actualizar".
        // (Se colecciona en el backend para no depender del recorte de `leads` a MAX_LEADS_OUT.)
        if (shFound && shNotes === 0) {
          acc.missingBitacora.push({
            leadId: row.leadId, name: row.name, phone: row.phone, createdAt: row.createdAt,
            shStage: row.shStage, shLastEvent: row.shLastEvent, shLastEventAt: row.shLastEventAt,
          });
        }
        if (seg === 'España') spainClients.push(row);
        if (shSold) salesRows.push(row);
        if (saleReview) salesReviewRows.push(row);
      }

      const advisors = [...accById.values()]
        .filter((a) => a.leads > 0)
        .filter((a) => advisorRoleIds.has(a.advisorId))   // solo asesores reales (role advisor)
        .map((a) => ({
          advisorId: a.advisorId, name: a.name, leads: a.leads,
          byStatus: a.byStatus, converted: a.converted, closed: a.closed,
          conversionRate: pct(a.converted, a.leads), closedRate: pct(a.closed, a.leads),
          avgScore: a.scored ? Math.round(a.scoreSum / a.scored) : 0,
          advisorMsgs: a.advisorMsgs, responseSamples: a.respCount,
          avgResponseMin: a.respCount ? Math.round((a.respSumMs / a.respCount) / 60000) : null,
          medianResponseMin: a.respCount ? medianMinFromBuckets(a.respBuckets) : null,
          within1hRate: a.respCount ? pct(a.respWithin1h, a.respCount) : null,
          within30mRate: a.respCount
            ? pct((a.respBuckets[0] ?? 0) + (a.respBuckets[1] ?? 0) + (a.respBuckets[2] ?? 0) + (a.respBuckets[3] ?? 0), a.respCount)
            : null,
          avgFirstContactMin: a.firstContactDelays.length
            ? Math.round(a.firstContactDelays.reduce((x, y) => x + y, 0) / a.firstContactDelays.length / 60000) : null,
          medianFirstContactMin: a.firstContactDelays.length ? Math.round((median(a.firstContactDelays) ?? 0) / 60000) : null,
          neverContacted: a.neverContacted,
          handled: a.handled, humanAttendedRate: pct(a.handled, a.leads),
          respondedLeads: a.respondedLeads,
          // % ATENDIDOS A TIEMPO: de todos los datos que le llegaron (los que
          // contactó + los que le QUITARON por no contactar), en qué % hizo el
          // primer contacto humano. Penaliza el descuido en vez de premiar la
          // rapidez sobre los pocos que atiende.
          attendedLeads: a.attendedLeads,
          attentionRate: pct(a.attendedLeads, a.attendedLeads + a.reassignLost),
          sales: a.sales,
          reassignLost: a.reassignLost, reassignReceived: a.reassignReceived,
          shFound: a.shFound, shWithNote: a.shWithNote, shNoNote: Math.max(0, a.shFound - a.shWithNote),
          shNotesTotal: a.shNotesTotal, bitacoraCoverage: pct(a.shWithNote, a.shFound),
          // Lista de los clientes que le faltan por actualizar (los más antiguos primero).
          missingBitacora: a.missingBitacora.slice().sort((x, y) => x.createdAt - y.createdAt),
        }))
        .map((a) => ({ ...a, gestionScore: gestionScore(a) }))
        .sort((a, b) => b.gestionScore - a.gestionScore);

      const now = Date.now();
      const createdMsList = leads.map((l) => msOf(l.createdAt)).filter(Boolean);
      const shScanned = leads.filter((l) => shField<unknown>(l, 'smartHomeTrackingUpdatedAt') !== undefined).length;

      return {
        generatedAt: now,
        dateRange: {
          min: createdMsList.length ? Math.min(...createdMsList) : null,
          max: createdMsList.length ? Math.max(...createdMsList) : null,
        },
        totals: {
          leads317: leads.length,
          byStatus: leads.reduce<Record<string, number>>((o, l) => { o[l.status] = (o[l.status] ?? 0) + 1; return o; }, {}),
          withAiAnalysis: leads.filter((l) => l.aiAnalysis).length,
          reassignedLeads: [...reassignByLead.keys()].length,
          reassignEvents: [...reassignByLead.values()].reduce((s, n) => s + n, 0),
          shScanned,
          shFound: leadRows.filter((r) => r.shFound).length,
          shWithAdvisorNote: leadRows.filter((r) => (r.shAdvisorNotes as number) > 0).length,
          shDuplicates: leadRows.filter((r) => r.shDuplicate).length,
          shNotFound: leadRows.filter((r) => !r.shFound).length,
          sales: salesRows.length,
          humanAttended: leadRows.filter((r) => (r.advisorMsgs as number) > 0).length,
          // Estado del cliente según lo escrito en la bitácora.
          bitacora: {
            noInteresado: leadRows.filter((r) => r.bitSignal === 'no_interesado').length,
            agendado: leadRows.filter((r) => r.bitSignal === 'agendado').length,
            interesado: leadRows.filter((r) => r.bitSignal === 'interesado').length,
            sinRespuesta: leadRows.filter((r) => r.bitSignal === 'sin_respuesta').length,
            compro: leadRows.filter((r) => r.bitSignal === 'compro').length,
            // "no interesado" que siguen abiertos en el CRM (Nuevo/Activo) → sugerir marcar Perdido.
            porMarcarPerdido: leadRows.filter((r) => r.bitSignal === 'no_interesado' && r.status !== 'lost' && r.status !== 'closed').length,
          },
        },
        advisors,
        bySegment: finalizeGroups(bySegment),
        bySource: finalizeGroups(bySource),
        byCampaign: finalizeGroups(byCampaign),
        byAd: finalizeGroups(byAd).slice(0, MAX_ADS),
        sales: salesRows.sort((a, b) =>
          ((b.shCloseDateAt as number | null) ?? (b.createdAt as number)) -
          ((a.shCloseDateAt as number | null) ?? (a.createdAt as number))
        ),
        salesReview: salesReviewRows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)),
        lossAnalysis: [...lossAgg.entries()]
          .map(([k, v]) => ({ category: k, label: LOSS_LABEL[k as LeadLossCategory] ?? k, count: v }))
          .sort((a, b) => b.count - a.count),
        temperature: tempAgg,
        topObjections: [...objectionAgg.entries()]
          .map(([objection, count]) => ({ objection, count }))
          .sort((a, b) => b.count - a.count).slice(0, 25),
        spainClients: spainClients.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)),
        leads: leadRows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)).slice(0, MAX_LEADS_OUT),
      };
    }, refresh);
  },
);

/**
 * Bitácora COMPLETA de un lead en SmartHome (para el modal "ver bitácora"). Trae
 * todos los eventos con fecha, acción y texto, marcando cuáles son nota humana del
 * asesor. Se resuelve por `smartHomeProspectId` (fiable) y cae a teléfono si no lo hay.
 */
export const getLeadBitacora = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await db.collection('companies').doc(companyId).collection('leads').doc(leadId).get();
    if (!snap.exists) return { found: false, events: [] };
    const lead = { id: snap.id, ...snap.data() } as Lead;

    let events: SmartHomeEvent[] | null = null;
    if (lead.smartHomeProspectId) {
      events = await getSmartHomeProspectEvents(
        lead.smartHomeProspectId,
        (lead as unknown as { smartHomeProjectCode?: string }).smartHomeProjectCode,
      ).catch(() => null);
    }
    if ((!events || events.length === 0) && lead.phone) {
      const byPhone = await getSmartHomeProspectSummariesByPhones([lead.phone]).catch(() => null);
      const sh = byPhone?.get(phoneKey(lead.phone));
      if (sh?.found) events = sh.events ?? [];
    }

    return {
      found: !!lead.smartHomeProspectId || (events?.length ?? 0) > 0,
      name: lead.name ?? lead.phone ?? '',
      phone: lead.phone ?? '',
      stage: shField<string>(lead, 'smartHomeStageName') ?? '',
      advisorName: shField<string>(lead, 'smartHomeAdvisorName') ?? '',
      events: (events ?? []).map((e) => ({
        date: parseSmartHomeDate(e.date),
        dateText: e.date,
        action: e.action,
        content: e.content,
        system: e.system,
        isAdvisorNote: isAdvisorNote(e),
      })),
    };
  },
);
