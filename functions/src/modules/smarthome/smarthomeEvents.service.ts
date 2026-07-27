import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  findSmartHomeProspectsByPhone,
  getSmartHomeProjects,
  postSmartHomeEvent,
} from '../../integrations/smarthome/smarthome.client';
import { resolveOwnerId } from './smarthomeSync.service';
import type { SmartHomeSaleRecord } from '../../integrations/smarthome/smarthome.client';
import type { Lead } from '../leads/leads.types';

function firstText(record: SmartHomeSaleRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

async function projectCodeFor(record: SmartHomeSaleRecord): Promise<string | null> {
  const explicit = firstText(record, ['projectCode', 'ProjectCode']);
  if (explicit) return explicit;

  const projectName = firstText(record, ['projectName', 'project', 'Proyecto']);
  if (!projectName) return env.smartHomeProject();

  const projects = await getSmartHomeProjects();
  const match = projects?.find((p) =>
    p.name?.trim().toLowerCase() === projectName.trim().toLowerCase()
  );
  return match?.code ?? env.smartHomeProject();
}

async function eventUserIdFor(lead: Lead): Promise<string> {
  if (!lead.assignedTo) return env.smartHomeBiUserId();
  const resolved = await resolveOwnerId(lead.companyId, lead.assignedTo);
  return resolved.ownerId ?? env.smartHomeBiUserId();
}

export async function postLeadSmartHomeBitacora(
  lead: Lead,
  eventContent: string
): Promise<boolean> {
  if (!lead.phone) return false;

  const matches = await findSmartHomeProspectsByPhone(lead.phone);
  if (!matches || matches.length === 0) {
    logger.warn('[smartHome] No se encontro prospecto para crear bitacora', {
      leadId: lead.id,
      phone: lead.phone,
    });
    return false;
  }

  const prospect = matches[0];
  const prospectId = firstText(prospect, ['prospectId', 'ProspectId']);
  const projectCode = await projectCodeFor(prospect);
  if (!prospectId || !projectCode) {
    logger.warn('[smartHome] Prospecto sin datos suficientes para bitacora', {
      leadId: lead.id,
      prospectId,
      projectCode,
    });
    return false;
  }

  const result = await postSmartHomeEvent({
    projectCode,
    prospectId,
    userId: await eventUserIdFor(lead),
    eventContent,
    isAnEvent: false,
  });

  return result.ok;
}
