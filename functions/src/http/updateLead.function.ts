import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';

const UpdateLeadSchema = z.object({
  companyId:  z.string().min(1),
  leadId:     z.string().min(1),
  name:       z.string().min(1).max(120).optional(),
  status:     z.enum(['new', 'active', 'qualified', 'scheduled', 'lost', 'closed']).optional(),
  assignedTo: z.string().optional().nullable(),
  tags:       z.array(z.string().max(40)).max(20).optional(),
  metadata:   z.record(z.string(), z.string().max(500)).optional(),
});

/**
 * Callable: actualiza datos editables de un lead desde el CRM.
 * Campos permitidos: name, status, assignedTo, tags, metadata.
 * No permite cambiar phone, companyId, aiEnabled (usar pauseLeadAi/resumeLeadAi).
 */
export const updateLead = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = UpdateLeadSchema.safeParse(request.data);
    if (!parse.success) {
      throw new HttpsError('invalid-argument', 'Datos inválidos: ' + parse.error.message);
    }

    const { companyId, leadId, ...fields } = parse.data;
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    // Construir objeto de actualización solo con los campos presentes
    const update: Record<string, unknown> = {};
    if (fields.name       !== undefined) update.name       = fields.name;
    if (fields.status     !== undefined) update.status     = fields.status;
    if (fields.tags       !== undefined) update.tags       = fields.tags;
    if (fields.assignedTo !== undefined) update.assignedTo = fields.assignedTo ?? null;
    if (fields.metadata   !== undefined) update.metadata   = fields.metadata;

    if (Object.keys(update).length === 0) {
      return { leadId }; // nada que actualizar
    }

    await leadsRepository.update(companyId, leadId, update);

    logger.info('[UpdateLead] Lead actualizado', { leadId, update });
    return { leadId };
  }
);
