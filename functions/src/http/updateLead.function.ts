import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { sendLeadReassignedPush } from '../modules/messages/pushNotifications.service';
import { normalizePhone, phoneTail, toNormalizedPhone } from '../utils/phone';

const UpdateLeadSchema = z.object({
  companyId:       z.string().min(1),
  leadId:          z.string().min(1),
  name:            z.string().min(1).max(120).optional(),
  phone:           z.string().min(7).max(40).optional(),
  email:           z.string().max(160).optional().nullable(),
  city:            z.string().max(120).optional().nullable(),
  documentNumber:  z.string().max(60).optional().nullable(),
  status:          z.enum(['new', 'active', 'qualified', 'scheduled', 'lost', 'closed']).optional(),
  assignedTo:      z.string().optional().nullable(),
  tags:            z.array(z.string().max(40)).max(20).optional(),
  metadata:        z.record(z.string(), z.any()).optional(),
  fuenteUbicacion: z.string().max(120).optional().nullable(),
  projectInterest: z.array(z.string().max(120)).optional(),
});

/**
 * Callable: actualiza datos editables de un lead desde el CRM.
 * Campos permitidos: name, status, assignedTo, tags, metadata.
 * Solo administradores pueden cambiar phone.
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
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes editar leads asignados a ti.');
    }

    // Construir objeto de actualización solo con los campos presentes
    const update: Record<string, unknown> = {};
    if (fields.name            !== undefined) update.name            = fields.name;
    if (fields.email           !== undefined) update.email           = fields.email ?? null;
    if (fields.city            !== undefined) update.city            = fields.city ?? null;
    if (fields.documentNumber  !== undefined) update.documentNumber  = fields.documentNumber ?? null;
    if (fields.status          !== undefined) update.status          = fields.status;
    if (fields.tags            !== undefined) update.tags            = fields.tags;
    if (fields.assignedTo      !== undefined && (ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))) update.assignedTo = fields.assignedTo ?? null;
    if (fields.metadata !== undefined) {
      const currentMeta = (lead.metadata as Record<string, any>) || {};
      const incomingMeta = { ...fields.metadata };
      // Proteger bitácoras / fichas técnicas contra sobrescritura accidental desde formularios con estado viejo
      const rawBitacoras = [
        ...(Array.isArray((lead as any).bitacoras) ? (lead as any).bitacoras : []),
        ...(Array.isArray(currentMeta.smarthomeBitacoras) ? currentMeta.smarthomeBitacoras : []),
        ...(Array.isArray(incomingMeta.smarthomeBitacoras) ? incomingMeta.smarthomeBitacoras : []),
      ];
      if (rawBitacoras.length > 0) {
        const seen = new Set<string>();
        const mergedBitacoras: any[] = [];
        for (const b of rawBitacoras) {
          if (!b || typeof b !== 'object') continue;
          const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
          if (!seen.has(k)) {
            seen.add(k);
            mergedBitacoras.push(b);
          }
        }
        incomingMeta.smarthomeBitacoras = mergedBitacoras.slice(0, 60);
        update.bitacoras = mergedBitacoras.slice(0, 60);
      }
      update.metadata = {
        ...currentMeta,
        ...incomingMeta,
      };
    }
    if (fields.fuenteUbicacion !== undefined) update.fuenteUbicacion = fields.fuenteUbicacion ?? null;
    if (fields.projectInterest !== undefined) update.projectInterest = fields.projectInterest;
    if (fields.phone !== undefined) {
      const isLeadAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role);
      const isAssignedAdvisor = lead.assignedTo === ctx.uid;
      const hasRealPhone = Boolean(lead.phone && !lead.phone.startsWith('user_') && !lead.phone.includes('CO.'));

      // Permitir actualizar teléfono si es Administrador, o si es el asesor asignado a este lead,
      // o si el lead entró sin teléfono real (por usuario/BSUID de WhatsApp).
      if (!isLeadAdmin && !isAssignedAdvisor && hasRealPhone) {
        throw new HttpsError('permission-denied', 'Solo puedes editar el teléfono de tus propios prospectos asignados.');
      }

      let digits = normalizePhone(fields.phone).replace(/\D/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
      if (digits.length < 7 || digits.length > 15) {
        throw new HttpsError('invalid-argument', 'El telefono debe tener entre 7 y 15 digitos.');
      }

      const phone = `+${digits}`;
      const normalizedPhone = toNormalizedPhone(phone);
      const exactDuplicate = await leadsRepository.findByNormalizedPhone(companyId, normalizedPhone);
      if (exactDuplicate && exactDuplicate.id !== leadId) {
        throw new HttpsError('already-exists', 'Ya existe otro lead con ese telefono.');
      }

      const tail = phoneTail(phone);
      const tailDuplicate = await leadsRepository.findByPhoneTail(companyId, tail, leadId);
      if (tailDuplicate) {
        throw new HttpsError('already-exists', 'Ya existe otro lead con un telefono equivalente.');
      }

      update.phone = phone;
      update.normalizedPhone = normalizedPhone;
      update.phoneTail = tail;
    }

    if (Object.keys(update).length === 0) {
      return { leadId }; // nada que actualizar
    }

    await leadsRepository.update(companyId, leadId, update);

    if (update.assignedTo && typeof update.assignedTo === 'string' && update.assignedTo !== lead.assignedTo && update.assignedTo !== ctx.uid) {
      await sendLeadReassignedPush(companyId, lead, update.assignedTo, ctx.uid).catch((err) => {
        logger.error('[UpdateLead] Error al enviar notificacion de reasignacion', { err });
      });
    }

    logger.info('[UpdateLead] Lead actualizado', { leadId, update });
    return { leadId };
  }
);
