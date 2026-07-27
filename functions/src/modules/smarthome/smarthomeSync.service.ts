import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { leadsRepository } from '../leads/leads.repository';
import {
  getSmartHomeUsers,
  addSmartHomeCustomer,
  updateSmartHomeProspect,
  findSmartHomeProspectsByPhone,
} from '../../integrations/smarthome/smarthome.client';
import type { SmartHomeSaleRecord } from '../../integrations/smarthome/smarthome.client';
import type { Lead, SmartHomeDuplicateMatch } from '../leads/leads.types';

export interface SyncResult {
  ok:          boolean;
  reason:      string;
  customerId?: string;
  ownerId?:    string;
  advisorEmail?: string;
  duplicateMatches?: SmartHomeDuplicateMatch[];
}

function normalizeEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function splitName(name: string | undefined, phone: string): { firstName: string; lastName: string } {
  // Quita emojis/símbolos, conserva letras (incl. acentos), espacios, guion y apóstrofo.
  const clean = (name ?? '').replace(/[^\p{L}\p{M}\s'.-]/gu, '').trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: 'Lead WhatsApp', lastName: phone.replace(/\D/g, '').slice(-4) || 'IA' };
  const parts = clean.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '.' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function firstText(record: SmartHomeSaleRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function smartHomeOwnerId(record: SmartHomeSaleRecord): string | undefined {
  return firstText(record, ['ownerId', 'userId', 'sellerId', 'advisorId']);
}

function summarizeDuplicate(record: SmartHomeSaleRecord): SmartHomeDuplicateMatch {
  return {
    prospectId:    firstText(record, ['prospectId', 'ProspectId']),
    customerId:    firstText(record, ['customerId', 'CustomerId']),
    ownerId:       smartHomeOwnerId(record),
    ownerName:     firstText(record, ['ownerName', 'sellerName', 'advisorName', 'Asesor', 'Vendedor']),
    firstName:     firstText(record, ['firstName', 'name', 'Nombre_del_Cliente']),
    lastName:      firstText(record, ['lastName', 'surname']),
    mobileNumber:  firstText(record, ['mobileNumber', 'secondPhoneNumber', 'cellPhone', 'mobile', 'Celular']),
    phoneNumber:   firstText(record, ['phoneNumber', 'telephone', 'phone', 'Telefono']),
    email:         firstText(record, ['email', 'Email']),
    moduleName:    firstText(record, ['moduleName', 'module', 'Modulo']),
    projectName:   firstText(record, ['projectName', 'project', 'Proyecto']),
    stageName:     firstText(record, ['stageName', 'stage', 'Etapa_del_Ciclo']),
    saleCycleName: firstText(record, ['saleCycleName', 'status', 'Ciclo_de_Venta']),
  };
}

/**
 * Resuelve el `ownerId` de SmartHome del asesor del CRM asignado al lead.
 * Estrategia: usa el `smartHomeUserId` cacheado en el doc del asesor; si no,
 * lo empareja por email contra getUsers de SmartHome y lo cachea. Devuelve
 * null si el lead no tiene asesor o el asesor no existe en SmartHome.
 */
export async function resolveOwnerId(companyId: string, advisorUid: string): Promise<{ ownerId: string | null; email: string }> {
  const userSnap = await db.collection('companies').doc(companyId).collection('users').doc(advisorUid).get();
  if (!userSnap.exists) return { ownerId: null, email: '' };
  const user = userSnap.data() as { email?: string; smartHomeUserId?: string };

  if (user.smartHomeUserId) return { ownerId: user.smartHomeUserId, email: normalizeEmail(user.email) };

  const email = normalizeEmail(user.email);
  if (!email) return { ownerId: null, email: '' };

  const shUsers = await getSmartHomeUsers();
  if (!shUsers) return { ownerId: null, email };

  const match = shUsers.find((u) => normalizeEmail(u.email) === email);
  if (!match) return { ownerId: null, email };

  // Cachea el mapeo en el doc del asesor para no re-emparejar cada vez.
  await userSnap.ref.set({ smartHomeUserId: match.userId }, { merge: true });
  return { ownerId: match.userId, email };
}

/**
 * Crea el lead en SmartHome (proyecto Laguna Mar, unidad cupo1, fuente WHATSAPP IA),
 * asignado al asesor del CRM. Idempotente: si ya se creó (smartHomeCustomerId),
 * no lo repite. Persiste el resultado en el propio lead.
 */
export async function syncLeadToSmartHome(lead: Lead): Promise<SyncResult> {
  if (lead.smartHomeCustomerId) {
    return { ok: true, reason: 'already-synced', customerId: lead.smartHomeCustomerId };
  }
  if (!lead.assignedTo) {
    return { ok: false, reason: 'lead-sin-asesor' };
  }

  const { ownerId, email } = await resolveOwnerId(lead.companyId, lead.assignedTo);
  if (!ownerId) {
    const reason = email ? 'asesor-no-existe-en-smarthome' : 'asesor-sin-email';
    await leadsRepository.update(lead.companyId, lead.id, { smartHomeSyncError: reason });
    return { ok: false, reason, advisorEmail: email };
  }

  const existingProspects = await findSmartHomeProspectsByPhone(lead.phone);
  if (existingProspects === null) {
    const reason = 'smarthome-validacion-duplicados-no-disponible';
    await leadsRepository.update(lead.companyId, lead.id, { smartHomeSyncError: reason });
    return { ok: false, reason, ownerId, advisorEmail: email };
  }
  if (existingProspects.length > 0) {
    const duplicateMatches = existingProspects.map(summarizeDuplicate).slice(0, 5);
    const reason = 'smarthome-duplicado-requiere-revision';
    await leadsRepository.update(lead.companyId, lead.id, {
      smartHomeSyncError: reason,
      smartHomeDuplicateMatches: duplicateMatches,
    });
    logger.warn('[smartHome] Lead no creado porque el telefono ya existe en SmartHome', {
      leadId: lead.id,
      ownerId,
      matches: duplicateMatches,
    });
    return { ok: false, reason, ownerId, advisorEmail: email, duplicateMatches };
  }

  const { firstName, lastName } = splitName(lead.name, lead.phone);
  const result = await addSmartHomeCustomer({
    moduleId:         env.smartHomeModuleId(),
    locationSourceId: env.smartHomeSourceId(),
    origin:           env.smartHomeAttendedIn(),
    ownerId,
    firstName,
    lastName,
    mobileNumber:     (lead.phone || '').replace(/^\+/, ''),
    ...(lead.metadata?.email ? { email: lead.metadata.email } : {}),
  });

  if (!result.ok) {
    const reason = `smarthome-error-${result.status}${result.returnCode ? '-' + result.returnCode : ''}`;
    await leadsRepository.update(lead.companyId, lead.id, { smartHomeSyncError: reason });
    return { ok: false, reason, ownerId, advisorEmail: email };
  }

  if (result.prospectId) {
    const updateResult = await updateSmartHomeProspect({
      prospectId:    result.prospectId,
      userId:        ownerId,
      firstName,
      lastName,
      mobileNumber:  (lead.phone || '').replace(/^\+/, ''),
      ...(lead.metadata?.email ? { email: lead.metadata.email } : {}),
      origin:        env.smartHomeAttendedIn(),
      comment:       `Atendido En: ${env.smartHomeAttendedIn()}`,
    });

    if (!updateResult.ok) {
      logger.warn('[smartHome] Cliente creado, pero no se pudo actualizar Atendido En', {
        leadId: lead.id,
        prospectId: result.prospectId,
        status: updateResult.status,
        returnCode: updateResult.returnCode,
      });
    }
  }

  await leadsRepository.update(lead.companyId, lead.id, {
    smartHomeCustomerId: result.customerId ?? 'ok',
    smartHomeSyncedAt:   Timestamp.now(),
    smartHomeSyncError:  '',
    smartHomeDuplicateMatches: [],
  });
  logger.info('[smartHome] Lead creado en SmartHome despues de validacion BI', {
    leadId: lead.id, ownerId, customerId: result.customerId,
  });
  return { ok: true, reason: 'created', customerId: result.customerId, ownerId, advisorEmail: email };
}
