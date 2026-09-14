import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { getSmartHomeProspectSummary, type SmartHomeProspectSummary } from '../integrations/smarthome/smarthome.client';
import { analyzeLeadConversation } from '../modules/ai/leadAnalysis.service';
import type { Lead, LeadStats } from '../modules/leads/leads.types';
import type { LeadAnalysisAi } from '../modules/ai/leadAnalysis.types';

const STALE_MS = 3 * 86_400_000;
const NIGHT_END_HOUR = 6;

const _bogotaHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false });
function bogotaHour(ms: number): number {
  return Number(_bogotaHourFmt.format(new Date(ms))) % 24;
}

/** Radiografía del lado CRM, derivada de los datos ya guardados del lead (sin costo IA). */
interface CrmDossier {
  status:            string;
  source:            string;
  advisorName:       string;
  createdAt:         number | null;
  createdHour:       number;   // hora local (0-23) en que entró
  nightLead:         boolean;  // entró de madrugada
  lastMessageAt:     number | null;
  lastMessageText:   string;
  lastInboundAt:     number | null;
  firstContactAt:    number | null;   // primer contacto humano del asesor
  advisorMsgCount:   number;
  waitingReply:      boolean;   // el cliente escribió último y no le han respondido
  waitingMin:        number | null;
  staleDays:         number | null;
  avgResponseMin:    number | null;
  responseSamples:   number;
  /** Diagnóstico legible del estado del seguimiento en el CRM. */
  flags:             string[];
}

function buildCrmDossier(lead: Lead, advisorName: string): CrmDossier {
  const now = Date.now();
  const s: Partial<LeadStats> = lead.stats ?? {};
  const createdMs = lead.createdAt?.toMillis?.() ?? null;
  const lastMs    = lead.lastMessageAt?.toMillis?.() ?? null;
  const advisorMsgCount = Number(s.advisorMsgCount ?? 0);
  const waitingReply    = Boolean(s.waitingReply ?? false);
  const pendMs = s.pendingInboundAt?.toMillis?.() ?? null;
  const responseCount = Number(s.responseCount ?? 0);
  const avgResponseMin = responseCount ? Math.round((Number(s.responseSumMs ?? 0) / responseCount) / 60_000) : null;

  const nightLead = createdMs ? bogotaHour(createdMs) < NIGHT_END_HOUR : false;
  const neverContacted = !lead.advisorFirstContactAt && advisorMsgCount === 0;
  const staleMs = lastMs ? now - lastMs : 0;

  const flags: string[] = [];
  if (neverContacted) flags.push('El asesor nunca ha escrito a este cliente.');
  if (nightLead && neverContacted) flags.push('Entró de madrugada y quedó sin atención.');
  if (waitingReply) flags.push('El cliente escribió último; está esperando respuesta.');
  if (staleMs > STALE_MS && ['new', 'active', 'qualified', 'scheduled'].includes(lead.status)) {
    flags.push('Lead abierto sin actividad hace más de 3 días.');
  }
  if (avgResponseMin !== null && avgResponseMin > 120) {
    flags.push(`Tiempo de respuesta lento del asesor (promedio ${avgResponseMin} min).`);
  }
  if (flags.length === 0) flags.push('Sin alertas: el seguimiento en el CRM va al día.');

  return {
    status:          lead.status,
    source:          lead.source,
    advisorName,
    createdAt:       createdMs,
    createdHour:     createdMs ? bogotaHour(createdMs) : -1,
    nightLead,
    lastMessageAt:   lastMs,
    lastMessageText: (lead.lastMessageText || '').slice(0, 200),
    lastInboundAt:   lead.lastInboundAt?.toMillis?.() ?? null,
    firstContactAt:  lead.advisorFirstContactAt?.toMillis?.() ?? null,
    advisorMsgCount,
    waitingReply,
    waitingMin:      waitingReply && pendMs ? Math.max(0, Math.round((now - pendMs) / 60_000)) : null,
    staleDays:       staleMs > STALE_MS ? Math.round(staleMs / 86_400_000) : null,
    avgResponseMin,
    responseSamples: responseCount,
    flags,
  };
}

/**
 * Genera, BAJO DEMANDA y SIN PERSISTIR, una radiografía completa de un cliente
 * cruzando lo que sabemos en el CRM con su seguimiento en SmartHome (bitácora BI).
 * Opcionalmente añade un resumen con IA de la conversación.
 *
 * Diseño de costo: no hay job diario ni escritura en Firestore. Solo consume
 * cuando alguien pulsa "Generar" (lecturas del lead + API SmartHome + IA opcional).
 */
export const generateLeadDossier = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, withAi } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      withAi:    z.boolean().optional().default(false),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes ver leads asignados a ti.');
    }

    // Nombre del asesor asignado (para el resumen CRM).
    let advisorName = 'Sin asesor';
    if (lead.assignedTo) {
      const userSnap = await db.collection('companies').doc(companyId).collection('users').doc(lead.assignedTo).get();
      const u = userSnap.data() as { displayName?: string; email?: string } | undefined;
      advisorName = u?.displayName || u?.email || lead.assignedTo;
    }

    // SmartHome + IA en paralelo (ambos son best-effort: si fallan, el dossier sale igual).
    const [smartHome, ai] = await Promise.all([
      lead.phone
        ? getSmartHomeProspectSummary(lead.phone).catch((err) => {
            logger.warn('[leadDossier] SmartHome falló', { leadId, error: err instanceof Error ? err.message : String(err) });
            return null;
          })
        : Promise.resolve<SmartHomeProspectSummary | null>({ found: false, followUps: 0, actions: [], channels: [], events: [], advisorNotes: 0 }),
      withAi
        ? analyzeLeadConversation(lead).then((r) => r.analysis).catch((err) => {
            logger.warn('[leadDossier] IA falló', { leadId, error: err instanceof Error ? err.message : String(err) });
            return null;
          })
        : Promise.resolve<LeadAnalysisAi | null>(null),
    ]);

    logger.info('[leadDossier] Radiografía generada (no persistida)', {
      leadId, by: ctx.uid, smartHomeFound: smartHome?.found ?? null, withAi,
    });

    return {
      generatedAt: Date.now(),
      crm: buildCrmDossier(lead, advisorName),
      smartHome: {
        error: smartHome === null,            // true = no se pudo consultar SmartHome
        ...(smartHome ?? { found: false, followUps: 0, actions: [], channels: [], events: [], advisorNotes: 0 }),
      },
      ai,   // null si no se pidió o si falló
    };
  }
);
