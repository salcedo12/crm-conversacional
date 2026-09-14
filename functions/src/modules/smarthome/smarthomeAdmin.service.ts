import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import {
  changeSmartHomeProspectSaleCycleStage,
  changeSmartHomeProspectUser,
  postSmartHomeEvent,
} from '../../integrations/smarthome/smarthome.client';
import { resolveOwnerId, smartHomeEnabledForCompany } from './smarthomeSync.service';
import { resolveSmartHomeProspectForLead } from './smarthomeEvents.service';
import type { Lead } from '../leads/leads.types';

export interface SmartHomeAdminResult {
  ok: boolean;
  reason: string;
  prospectId?: string;
  projectCode?: string;
  ownerId?: string;
  advisorEmail?: string;
}

export async function changeLeadSmartHomeAdvisor(
  lead: Lead,
  smartHomeUserId: string | null
): Promise<SmartHomeAdminResult> {
  if (!(await smartHomeEnabledForCompany(lead.companyId))) {
    return { ok: false, reason: 'smarthome-no-habilitado-para-empresa' };
  }
  if (!smartHomeUserId) {
    return { ok: false, reason: 'smarthome-no-permite-desasignar-asesor' };
  }

  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) return { ok: false, reason: 'prospecto-smarthome-no-encontrado', ownerId: smartHomeUserId };

  const result = await changeSmartHomeProspectUser(ref.projectCode, ref.prospectId, smartHomeUserId);
  if (!result.ok) {
    return {
      ok: false,
      reason: `smarthome-error-${result.status}${result.returnCode ? '-' + result.returnCode : ''}`,
      prospectId: ref.prospectId,
      projectCode: ref.projectCode,
      ownerId: smartHomeUserId,
    };
  }

  await postSmartHomeEvent({
    projectCode: ref.projectCode,
    prospectId:  ref.prospectId,
    userId:      smartHomeUserId,
    actionId:    null,
    isAnEvent:   false,
    eventContent: 'Registro automatico desde CRM Meraki: asesor asignado actualizado desde el CRM.',
  }).catch((err) => {
    logger.warn('[smartHome] No se pudo registrar bitacora de cambio de asesor', {
      leadId: lead.id,
      prospectId: ref.prospectId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    ok: true,
    reason: 'advisor-updated',
    prospectId: ref.prospectId,
    projectCode: ref.projectCode,
    ownerId: smartHomeUserId,
  };
}

export async function changeLeadSmartHomeSaleCycleStage(
  lead: Lead,
  stageId: string
): Promise<SmartHomeAdminResult> {
  if (!(await smartHomeEnabledForCompany(lead.companyId))) {
    return { ok: false, reason: 'smarthome-no-habilitado-para-empresa' };
  }

  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) return { ok: false, reason: 'prospecto-smarthome-no-encontrado' };

  const result = await changeSmartHomeProspectSaleCycleStage(ref.projectCode, ref.prospectId, stageId);
  if (!result.ok) {
    return {
      ok: false,
      reason: `smarthome-error-${result.status}${result.returnCode ? '-' + result.returnCode : ''}`,
      prospectId: ref.prospectId,
      projectCode: ref.projectCode,
    };
  }

  return {
    ok: true,
    reason: 'stage-updated',
    prospectId: ref.prospectId,
    projectCode: ref.projectCode,
  };
}

export interface SmartHomeManualEventInput {
  userId?: string;
  actionId?: string | null;
  actionLabel?: string;
  context?: string;
  authorName?: string;
  eventContent: string;
  isAnEvent: boolean;
  scheduledDate?: string;
}

export async function postLeadSmartHomeManualEvent(
  lead: Lead,
  input: SmartHomeManualEventInput
): Promise<SmartHomeAdminResult> {
  if (!(await smartHomeEnabledForCompany(lead.companyId))) {
    return { ok: false, reason: 'smarthome-no-habilitado-para-empresa' };
  }

  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) return { ok: false, reason: 'prospecto-smarthome-no-encontrado' };

  const fallbackUser = lead.assignedTo
    ? (await resolveOwnerId(lead.companyId, lead.assignedTo)).ownerId
    : null;
  const userId = input.userId || fallbackUser || env.smartHomeBiUserId();
  if (!userId) return { ok: false, reason: 'smarthome-userid-requerido' };

  const parts = [
    input.authorName ? `Registrado por: ${input.authorName}` : '',
    input.actionLabel ? `Accion: ${input.actionLabel}` : '',
    input.context ? `Contexto: ${input.context}` : '',
    input.eventContent,
  ].filter(Boolean);

  const result = await postSmartHomeEvent({
    projectCode: ref.projectCode,
    prospectId:  ref.prospectId,
    userId,
    actionId:    input.actionId ?? null,
    eventContent: parts.join('\n'),
    isAnEvent:   input.isAnEvent,
    ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: `smarthome-error-${result.status}${result.returnCode ? '-' + result.returnCode : ''}`,
      prospectId: ref.prospectId,
      projectCode: ref.projectCode,
      ownerId: userId,
    };
  }

  return {
    ok: true,
    reason: input.isAnEvent ? 'event-created' : 'bitacora-created',
    prospectId: ref.prospectId,
    projectCode: ref.projectCode,
    ownerId: userId,
  };
}
