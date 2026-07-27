import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { env } from '../config/env';
import { leadsRepository } from '../modules/leads/leads.repository';
import { resolveOwnerId, syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import { getSmartHomeUsers } from '../integrations/smarthome/smarthome.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

/**
 * Crea (o previsualiza) un lead del CRM en SmartHome. Solo admin/manager.
 * - dryRun:true → resuelve el asesor (ownerId) y muestra qué se enviaría, SIN crear nada.
 * - dryRun:false → crea el cliente en SmartHome (Laguna Mar / cupo1 / WHATSAPP IA).
 */
export const syncLeadToSmartHomeCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 180 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, dryRun } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      dryRun:    z.boolean().default(true),   // por seguridad, por defecto NO envía
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    if (dryRun) {
      if (!lead.assignedTo) return { dryRun: true, wouldCreate: false, reason: 'lead-sin-asesor' };
      const { ownerId, email } = await resolveOwnerId(companyId, lead.assignedTo);
      return {
        dryRun: true,
        wouldCreate: !!ownerId,
        reason: ownerId ? 'listo' : (email ? 'asesor-no-existe-en-smarthome' : 'asesor-sin-email'),
        advisorEmail: email,
        ownerId,
        target: {
          project:          env.smartHomeProject(),
          moduleId:         env.smartHomeModuleId(),
          locationSourceId: env.smartHomeSourceId(),
          origin:           env.smartHomeAttendedIn(),
        },
        alreadySynced: !!lead.smartHomeCustomerId,
      };
    }

    const result = await syncLeadToSmartHome(lead);
    return { dryRun: false, ...result };
  }
);

/** Lista los asesores de SmartHome (para configurar/mapear). Admin/manager. */
export const listSmartHomeAdvisors = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const users = await getSmartHomeUsers(true);
    if (!users) throw new HttpsError('unavailable', 'No se pudo consultar SmartHome.');
    return { advisors: users.map((u) => ({ userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email })) };
  }
);
