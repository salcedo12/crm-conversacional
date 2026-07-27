import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { runAndStoreLeadAnalysis } from '../modules/ai/leadAnalysis.service';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

/**
 * Genera la "Radiografía IA" de un lead: puntaje de calificación + análisis de
 * la conversación. Guarda el resultado en `lead.aiAnalysis` y lo devuelve.
 */
export const analyzeLead = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    if (!ADMIN_ROLES.includes(ctx.role) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes analizar leads asignados a ti.');
    }

    const stored = await runAndStoreLeadAnalysis(lead, ctx.uid);

    logger.info('[analyzeLead] Radiografía generada', {
      leadId, score: stored.score, temperature: stored.temperature, by: ctx.uid,
    });

    // Devuelve analyzedAt como epoch millis para el cliente.
    return { analysis: { ...stored, analyzedAt: stored.analyzedAt.toMillis() } };
  }
);
