import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db }         from '../lib/admin';
import { logger }     from '../utils/logger';
import { env }        from '../config/env';
import { runAndStoreLeadAnalysis } from '../modules/ai/leadAnalysis.service';
import type { Lead }  from '../modules/leads/leads.types';

/** Estados "abiertos" que vale la pena re-calificar (los cerrados/perdidos no). */
const OPEN_STATUSES = new Set<Lead['status']>(['new', 'active', 'qualified', 'scheduled']);

/** Cuántos leads (como máximo) re-califica por empresa en cada corrida (control de costo/tiempo). */
const MAX_PER_COMPANY = 40;

/** De cuántos leads recientes parte el filtrado antes de decidir cuáles re-calificar. */
const SCAN_LIMIT = 300;

/**
 * ¿Necesita (re)análisis? Sí si nunca se analizó, o si el lead escribió algo
 * nuevo después del último análisis (para no gastar tokens en leads sin cambios).
 */
function needsAnalysis(lead: Lead): boolean {
  if (!lead.aiAnalysis) return true;
  const analyzedAt  = lead.aiAnalysis.analyzedAt?.toMillis?.() ?? 0;
  const lastInbound = lead.lastInboundAt?.toMillis?.() ?? lead.lastMessageAt?.toMillis?.() ?? 0;
  return lastInbound > analyzedAt;
}

/**
 * Cada noche: re-califica automáticamente los leads abiertos con actividad nueva,
 * para que el equipo abra el CRM con los scores y próximos pasos ya listos.
 * Reutiliza `runAndStoreLeadAnalysis` (misma lógica que el botón manual).
 */
export const processLeadAnalysis = onSchedule(
  {
    schedule:       'every day 03:00',
    region:         'us-central1',
    timeoutSeconds: 540,
    memory:         '512MiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    if (!env.openaiApiKey()) {
      logger.warn('[LeadAnalysis] OPENAI_API_KEY ausente — se omite el ciclo.');
      return;
    }

    // .listDocuments() incluye empresas "fantasma" (docs con subcolecciones pero
    // sin campos), que .get() omite — ver gotcha de processFollowUps.
    const companies = await db.collection('companies').listDocuments();

    let totalScored = 0;

    for (const companyDoc of companies) {
      const companyId = companyDoc.id;

      // Partimos de los leads más activos y filtramos en memoria (evita índices
      // compuestos para status + orderBy). Los leads sin lastMessageAt (sin
      // conversación) quedan fuera del orderBy: no hay nada que analizar.
      const snap = await companyDoc
        .collection('leads')
        .orderBy('lastMessageAt', 'desc')
        .limit(SCAN_LIMIT)
        .get();

      const candidates = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Lead))
        .filter((lead) => OPEN_STATUSES.has(lead.status) && needsAnalysis(lead))
        .slice(0, MAX_PER_COMPANY);

      if (candidates.length === 0) continue;

      logger.info('[LeadAnalysis] Leads a re-calificar', { companyId, count: candidates.length });

      for (const lead of candidates) {
        try {
          const stored = await runAndStoreLeadAnalysis(lead, 'system');
          totalScored++;
          logger.info('[LeadAnalysis] Lead calificado', {
            companyId, leadId: lead.id, score: stored.score, temperature: stored.temperature,
          });
        } catch (err) {
          // failed-precondition = lead sin conversación para analizar → se ignora.
          logger.warn('[LeadAnalysis] No se pudo calificar lead', {
            companyId, leadId: lead.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info('[LeadAnalysis] Ciclo completado', { totalScored });
  }
);
