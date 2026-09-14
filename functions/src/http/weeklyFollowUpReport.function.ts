import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { getCachedReport } from '../lib/reportCache';
import { getSmartHomeProspectSummariesByPhones, type SmartHomeProspectSummary } from '../integrations/smarthome/smarthome.client';
import type { Lead, LeadStatus } from '../modules/leads/leads.types';
import { countsAsBusinessLead } from '../modules/leads/leadClassification';

const OPEN_STATUSES = new Set<LeadStatus>(['new', 'active', 'qualified', 'scheduled']);
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
const MAX_REPORT_ITEMS = 500;
const CACHE_TTL_MS = 30 * 60_000;
const REPORT_CACHE_VERSION = 'v3';

type WeeklyFollowUpReason =
  | 'missing_smarthome_bitacora'
  | 'advisor_mismatch'
  | 'crm_activity_without_smarthome'
  | 'stale_follow_up'
  | 'no_smarthome_match';

interface UserDoc {
  displayName?: string;
  email?: string;
}

function weekRange(offset: number) {
  const shifted = new Date(Date.now() - BOGOTA_OFFSET_MS);
  const day = shifted.getUTCDay();
  const mondayDelta = (day + 6) % 7;
  const startUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - mondayDelta + offset * 7,
    0,
    0,
    0,
    0,
  ) + BOGOTA_OFFSET_MS;
  return {
    start: startUtc,
    end: startUtc + 7 * 86_400_000 - 1,
  };
}

function advisorName(users: Map<string, string>, id?: string): string {
  if (!id) return 'Sin asesor';
  return users.get(id) ?? id;
}

function normalizeName(value?: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function sameAdvisorName(a?: string, b?: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftParts = new Set(left.split(' ').filter((part) => part.length > 2));
  const rightParts = right.split(' ').filter((part) => part.length > 2);
  if (leftParts.size === 0 || rightParts.length === 0) return false;
  const matches = rightParts.filter((part) => leftParts.has(part)).length;
  return matches >= Math.min(2, rightParts.length);
}

function parseSmartHomeDate(value?: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function phoneKey(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 && digits.startsWith('57') ? digits.slice(-10) : digits.slice(-10);
}

function millisFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return parseSmartHomeDate(value);
  if (value && typeof value === 'object') {
    const maybeTs = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof maybeTs.toMillis === 'function') return maybeTs.toMillis();
    const seconds = maybeTs.seconds ?? maybeTs._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return null;
}

function smartHomeValue(lead: Lead, keys: string[]): unknown {
  const raw = lead as unknown as Record<string, unknown>;
  const tracking = raw.smartHomeTracking && typeof raw.smartHomeTracking === 'object'
    ? raw.smartHomeTracking as Record<string, unknown>
    : {};
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
    if (tracking[key] !== undefined) return tracking[key];
  }
  return undefined;
}

function smartHomeText(lead: Lead, keys: string[], fallback = ''): string {
  const value = smartHomeValue(lead, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function latestSmartHomeEventAt(events: { date: string }[]): number | null {
  const dates = events
    .map((event) => parseSmartHomeDate(event.date))
    .filter((ms): ms is number => typeof ms === 'number')
    .sort((a, b) => b - a);
  return dates[0] ?? null;
}

function latestAdvisorEvent(events: SmartHomeProspectSummary['events']) {
  return events.find((event) => !event.system) ?? events[0] ?? null;
}

function matchesSearch(lead: Lead, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const phoneNeedle = phoneKey(needle);
  if (phoneNeedle && phoneKey(lead.phone).includes(phoneNeedle)) return true;
  return `${lead.name ?? ''} ${lead.phone ?? ''}`.toLowerCase().includes(needle);
}

function buildNextAction(reasons: WeeklyFollowUpReason[]): string {
  if (reasons.includes('no_smarthome_match')) return 'Verificar telefono y crear o vincular el cliente en SmartHome.';
  if (reasons.includes('advisor_mismatch')) return 'Validar el asesor responsable y reasignar antes de continuar seguimiento.';
  if (reasons.includes('missing_smarthome_bitacora')) return 'Contactar al cliente y registrar bitacora semanal en SmartHome.';
  if (reasons.includes('crm_activity_without_smarthome')) return 'Actualizar etapa o seguimiento en SmartHome con lo conversado en CRM.';
  if (reasons.includes('stale_follow_up')) return 'Retomar contacto y dejar proximo paso definido.';
  return 'Seguimiento al dia.';
}

function buildAlertReason(reasons: WeeklyFollowUpReason[]): string {
  const labels: Record<WeeklyFollowUpReason, string> = {
    missing_smarthome_bitacora: 'no tiene bitacora SmartHome esta semana',
    advisor_mismatch: 'tiene asesor diferente entre CRM y SmartHome',
    crm_activity_without_smarthome: 'tuvo actividad CRM sin actualizacion visible en SmartHome',
    stale_follow_up: 'esta abierto y sin actividad reciente',
    no_smarthome_match: 'no aparece vinculado en SmartHome',
  };
  if (reasons.length === 0) return 'Sin alertas para esta semana.';
  return `Requiere seguimiento: ${reasons.map((reason) => labels[reason]).join('; ')}.`;
}

function hasKnownSmartHomeAdvisor(value: string): boolean {
  const normalized = normalizeName(value);
  return Boolean(normalized && normalized !== 'sin asesor' && normalized !== 'no encontrado');
}

export const getWeeklyFollowUpReport = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, weekOffset, refresh, search } = z.object({
      companyId: z.string().min(1),
      weekOffset: z.number().int().min(-12).max(0).optional().default(0),
      refresh: z.boolean().optional().default(false),
      search: z.string().trim().max(80).optional().default(''),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const { start, end } = weekRange(weekOffset);
    const weekId = new Date(start - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

    const cacheKey = search
      ? `weekly_follow_up_${REPORT_CACHE_VERSION}__${weekId}__search_${phoneKey(search) || search.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
      : `weekly_follow_up_${REPORT_CACHE_VERSION}__${weekId}`;

    return getCachedReport(companyId, cacheKey, CACHE_TTL_MS, async () => {
      const companyRef = db.collection('companies').doc(companyId);
      const leadsCol = companyRef.collection('leads');
      const startTs = Timestamp.fromMillis(start);
      const endTs = Timestamp.fromMillis(end);

      const [createdSnap, activeSnap, usersSnap] = await Promise.all([
        leadsCol.where('createdAt', '>=', startTs).where('createdAt', '<=', endTs).get(),
        leadsCol.where('lastMessageAt', '>=', startTs).where('lastMessageAt', '<=', endTs).get(),
        companyRef.collection('users').get(),
      ]);

      const users = new Map<string, string>();
      for (const doc of usersSnap.docs) {
        const user = doc.data() as UserDoc;
        users.set(doc.id, user.displayName || user.email || doc.id);
      }

      const byId = new Map<string, Lead>();
      for (const doc of [...createdSnap.docs, ...activeSnap.docs]) {
        byId.set(doc.id, { id: doc.id, ...doc.data() } as Lead);
      }

      const candidates = [...byId.values()]
        .filter(countsAsBusinessLead)  // fuera los directos al WhatsApp del asesor
        .filter((lead) => lead.phone)
        .filter((lead) => matchesSearch(lead, search))
        .sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0))
        .slice(0, MAX_REPORT_ITEMS);

      if (refresh) {
        const phones = [...new Set(candidates.map((lead) => lead.phone).filter(Boolean))];
        console.info('[weeklyFollowUp] bulk SmartHome refresh', {
          companyId,
          search,
          candidates: candidates.length,
          phones: phones.length,
        });

        const smartHomeByPhone = await getSmartHomeProspectSummariesByPhones(phones).catch(() => null);
        if (smartHomeByPhone) {
          const writes: Promise<unknown>[] = [];
          for (const lead of candidates) {
            const smartHome = smartHomeByPhone.get(phoneKey(lead.phone));
            if (!smartHome?.found) continue;

            const bitacoraEvent = latestAdvisorEvent(smartHome.events ?? []);
            const lastEventAt = bitacoraEvent ? parseSmartHomeDate(bitacoraEvent.date) : latestSmartHomeEventAt(smartHome.events ?? []);
            const patch = {
              smartHomeCustomerId: smartHome.prospectId ?? lead.smartHomeCustomerId ?? 'ok',
              smartHomeProspectId: smartHome.prospectId ?? '',
              smartHomeAdvisorName: smartHome.advisor || smartHome.seller || '',
              smartHomeStageName: smartHome.stage || smartHome.saleCycle || '',
              smartHomeLastBitacoraAt: lastEventAt ? Timestamp.fromMillis(lastEventAt) : null,
              smartHomeLastBitacoraText: bitacoraEvent?.content?.slice(0, 240) ?? '',
              smartHomeTrackingUpdatedAt: Timestamp.now(),
            };
            writes.push(leadsCol.doc(lead.id).set(patch, { merge: true }));
            Object.assign(lead, patch);
          }
          await Promise.all(writes);
        }
      }

      const items = candidates.map((lead) => {
        const crmAdvisor = advisorName(users, lead.assignedTo);
        const lastConversationAt = lead.lastMessageAt?.toMillis?.() ?? lead.createdAt?.toMillis?.() ?? null;
        const stale = OPEN_STATUSES.has(lead.status) && lastConversationAt !== null && Date.now() - lastConversationAt > 7 * 86_400_000;
        const lastSmartHomeLogAt = millisFromUnknown(smartHomeValue(lead, [
          'smartHomeLastBitacoraAt',
          'lastSmartHomeLogAt',
          'lastBitacoraAt',
        ]));
        const hasBitacoraThisWeek = !!lastSmartHomeLogAt && lastSmartHomeLogAt >= start && lastSmartHomeLogAt <= end;
        const duplicate = lead.smartHomeDuplicateMatches?.[0];
        const smartHomeFound = Boolean(lead.smartHomeCustomerId || duplicate?.prospectId || duplicate?.customerId);
        const storedSmartHomeAdvisor = smartHomeText(lead, ['smartHomeAdvisorName', 'advisorName'], duplicate?.ownerName ?? '');
        const smartHomeAdvisor = storedSmartHomeAdvisor || (smartHomeFound ? crmAdvisor : 'No encontrado');
        const smartHomeStage = smartHomeText(lead, ['smartHomeStageName', 'stageName'], duplicate?.stageName ?? duplicate?.saleCycleName ?? '-');
        const reasons: WeeklyFollowUpReason[] = [];

        if (!smartHomeFound) {
          reasons.push('no_smarthome_match');
        } else {
          if (hasKnownSmartHomeAdvisor(storedSmartHomeAdvisor) && normalizeName(crmAdvisor) && !sameAdvisorName(crmAdvisor, storedSmartHomeAdvisor)) {
            reasons.push('advisor_mismatch');
          }
          if (!hasBitacoraThisWeek) reasons.push('missing_smarthome_bitacora');
          if (lastConversationAt && lastConversationAt >= start && (!lastSmartHomeLogAt || lastSmartHomeLogAt < lastConversationAt)) {
            reasons.push('crm_activity_without_smarthome');
          }
        }
        if (stale) reasons.push('stale_follow_up');

        return {
          leadId: lead.id,
          name: lead.name || lead.phone || 'Lead',
          phone: lead.phone || '',
          crmAdvisor,
          smartHomeAdvisor,
          crmStatus: lead.status,
          smartHomeStage,
          lastConversationAt,
          lastSmartHomeLogAt,
          hasBitacoraThisWeek,
          needsFollowUp: reasons.length > 0,
          alertReason: buildAlertReason(reasons),
          reasons,
          lastCrmSummary: (lead.aiAnalysis?.summary || lead.lastMessageText || '').slice(0, 240),
          nextAction: buildNextAction(reasons),
        };
      });

      const totals = {
        clients: items.length,
        needsFollowUp: items.filter((item) => item.needsFollowUp).length,
        missingBitacora: items.filter((item) => item.reasons.includes('missing_smarthome_bitacora')).length,
        advisorMismatch: items.filter((item) => item.reasons.includes('advisor_mismatch')).length,
        crmWithoutSmartHome: items.filter((item) => item.reasons.includes('crm_activity_without_smarthome')).length,
        staleFollowUp: items.filter((item) => item.reasons.includes('stale_follow_up')).length,
        noSmartHomeMatch: items.filter((item) => item.reasons.includes('no_smarthome_match')).length,
        estimatedReads: createdSnap.size + activeSnap.size + usersSnap.size + 1,
      };

      return {
        weekId,
        rangeStart: start,
        rangeEnd: end,
        generatedAt: Date.now(),
        totals,
        items: items.sort((a, b) => Number(b.needsFollowUp) - Number(a.needsFollowUp) || (b.lastConversationAt ?? 0) - (a.lastConversationAt ?? 0)),
      };
    }, refresh);
  },
);
