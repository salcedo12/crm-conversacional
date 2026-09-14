import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  findSmartHomeProspectsByPhone,
  getSmartHomeProjects,
  postSmartHomeEvent,
} from '../../integrations/smarthome/smarthome.client';
import { resolveOwnerId, smartHomeEnabledForCompany } from './smarthomeSync.service';
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

function storedProspectIdFor(lead: Lead): string | undefined {
  const prospectId = String(lead.smartHomeProspectId ?? '').trim();
  if (prospectId) return prospectId;

  const legacyId = String(lead.smartHomeCustomerId ?? '').trim();
  return legacyId && legacyId !== 'ok' ? legacyId : undefined;
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

export interface SmartHomeProspectRef {
  prospect:    SmartHomeSaleRecord;
  prospectId:  string;
  projectCode: string;
}

export async function resolveSmartHomeProspectForLead(lead: Lead): Promise<SmartHomeProspectRef | null> {
  if (!(await smartHomeEnabledForCompany(lead.companyId))) return null;
  const storedProspectId = storedProspectIdFor(lead);
  const storedProjectCode = String(lead.smartHomeProjectCode ?? '').trim() || env.smartHomeProject();
  if (!lead.phone && !storedProspectId) return null;

  const matches = lead.phone ? await findSmartHomeProspectsByPhone(lead.phone) : [];
  if (!matches || matches.length === 0) {
    if (storedProspectId) {
      logger.warn('[smartHome] Usando prospecto guardado porque la busqueda por telefono no encontro coincidencias', {
        leadId: lead.id,
        phone: lead.phone,
        prospectId: storedProspectId,
        projectCode: storedProjectCode,
      });
      return {
        prospect: {
          prospectId: storedProspectId,
          ProspectId: storedProspectId,
          projectCode: storedProjectCode,
          ownerId: lead.smartHomeAdvisorId,
        },
        prospectId: storedProspectId,
        projectCode: storedProjectCode,
      };
    }
    logger.warn('[smartHome] No se encontro prospecto para el lead', {
      leadId: lead.id,
      phone: lead.phone,
    });
    return null;
  }

  const prospect = storedProspectId
    ? matches.find((match) => {
      const prospectId = firstText(match, ['prospectId', 'ProspectId']);
      const customerId = firstText(match, ['customerId', 'CustomerId']);
      return prospectId === storedProspectId || customerId === storedProspectId;
    }) ?? matches[0]
    : matches[0];
  const prospectId = firstText(prospect, ['prospectId', 'ProspectId']);
  const projectCode = await projectCodeFor(prospect);
  if (!prospectId || !projectCode) {
    logger.warn('[smartHome] Prospecto sin datos suficientes', {
      leadId: lead.id,
      prospectId,
      projectCode,
    });
    return null;
  }

  return { prospect, prospectId, projectCode };
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
  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) return false;

  const result = await postSmartHomeEvent({
    projectCode: ref.projectCode,
    prospectId:  ref.prospectId,
    userId: await eventUserIdFor(lead),
    eventContent,
    isAnEvent: false,
  });

  return result.ok;
}
