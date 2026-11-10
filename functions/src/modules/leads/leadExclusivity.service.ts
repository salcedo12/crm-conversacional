import { Timestamp } from 'firebase-admin/firestore';
import type { Lead } from './leads.types';
import { assignLead } from './leadAssignment.service';
import { logger } from '../../utils/logger';
import { db } from '../../lib/admin';

export const EXCLUSIVITY_EXPIRATION_DAYS = 30;

/**
 * Protocolo Meraki - Exclusividad de Contactos & Caducidad por Abandono:
 * Si un lead reingresa por pauta (Meta Ads) o escribe de nuevo a la línea central 317:
 * - Se respeta al asesor activo si ha tenido interacción en los últimos 30 días (Cero robos).
 * - Si lleva más de 30 días en abandono (sin mensajes de asesor), la exclusividad caduca
 *   y se reasigna a otro asesor por Round-Robin.
 * - Si el lead tiene candado manual (assignmentLocked = true), NUNCA caduca.
 */
export async function evaluateExclusivityOnReentry(
  companyId: string,
  lead: Lead,
  reentrySource: string
): Promise<{ reallocated: boolean; currentAdvisorId: string | null; previousAdvisorId?: string }> {
  // 1. Si no tiene asesor asignado, asignarlo por primera vez
  if (!lead.assignedTo) {
    const newAdvisorId = await assignLead(companyId, lead.id);
    return { reallocated: true, currentAdvisorId: newAdvisorId };
  }

  // 2. Si tiene candado manual, la exclusividad está blindada
  if (lead.assignmentLocked) {
    logger.info('[Exclusivity] Lead reingresó con candado de asignación (exclusividad blindada)', {
      companyId,
      leadId: lead.id,
      assignedTo: lead.assignedTo,
      reentrySource,
    });
    return { reallocated: false, currentAdvisorId: lead.assignedTo };
  }

  // 3. Calcular última actividad del asesor asignado
  const now = Date.now();
  const lastActiveMillis = lead.lastAdvisorMessageAt?.toMillis?.()
    || lead.advisorFirstContactAt?.toMillis?.()
    || lead.updatedAt?.toMillis?.()
    || lead.createdAt?.toMillis?.()
    || 0;

  const daysSinceActivity = (now - lastActiveMillis) / (1000 * 60 * 60 * 24);

  // 4. Si pasaron más de 30 días sin actividad del asesor -> Caduca por abandono
  if (daysSinceActivity > EXCLUSIVITY_EXPIRATION_DAYS) {
    const previousAdvisorId = lead.assignedTo;
    logger.warn('[Exclusivity] Caducidad de exclusividad por abandono (>30 días). Reasignando...', {
      companyId,
      leadId: lead.id,
      daysSinceActivity: Math.round(daysSinceActivity),
      previousAdvisorId,
      reentrySource,
    });

    // Reasignar por Round-Robin excluyendo al asesor anterior si hay más disponibles
    const newAdvisorId = await assignLead(companyId, lead.id);

    const nowTs = Timestamp.now();
    const updatedTags = Array.from(new Set([...(lead.tags || []), 'reingreso_pauta_caducado']));

    const reassignPatch: Record<string, any> = {
      assignedTo: newAdvisorId || null,
      previousAdvisorId,
      advisorAssignedAt: nowTs,
      exclusivityExpiredAt: nowTs,
      tags: updatedTags,
      updatedAt: nowTs,
    };
    // Si el lead estaba en 'lost' (Cancelado/No Interesado) de hace meses y reingresa, reactivarlo
    if (lead.status === 'lost') {
      reassignPatch.status = 'active';
      reassignPatch.pipelineStage = 'prospecto';
      reassignPatch.pipelineStageLabel = 'Prospecto';
    }

    await db.collection('companies').doc(companyId).collection('leads').doc(lead.id).update(reassignPatch);

    return {
      reallocated: true,
      currentAdvisorId: newAdvisorId,
      previousAdvisorId,
    };
  }

  // 5. Menos de 30 días -> Exclusividad respetada
  logger.info('[Exclusivity] Exclusividad respetada (actividad en últimos 30 días)', {
    companyId,
    leadId: lead.id,
    assignedTo: lead.assignedTo,
    daysSinceActivity: Math.round(daysSinceActivity),
    reentrySource,
  });

  // Si el lead estaba en 'lost' y vuelve a escribir/reingresar antes de los 30 días, reactivarlo para su asesor
  if (lead.status === 'lost') {
    await db.collection('companies').doc(companyId).collection('leads').doc(lead.id).update({
      status: 'active',
      pipelineStage: 'prospecto',
      pipelineStageLabel: 'Prospecto',
      updatedAt: Timestamp.now(),
    });
  }

  return { reallocated: false, currentAdvisorId: lead.assignedTo };
}
