import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp }          from 'firebase-admin/firestore';
import { z }                  from 'zod';
import { db }                 from '../lib/admin';
import { logger }             from '../utils/logger';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { sendLeadReassignedPush } from '../modules/messages/pushNotifications.service';
import { userDisplayName }    from '../modules/deals/dealAccess';
import { bogotaNowString, leadRef as dealLeadRef, mergeBitacoraLists } from '../modules/deals/dealAudit';
import { postLeadSmartHomeBitacora } from '../modules/smarthome/smarthomeEvents.service';
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

    const changeLines: string[] = [];
    const cmp = (label: string, prev: unknown, next: unknown) => {
      const a = String(prev ?? '').trim();
      const b = String(next ?? '').trim();
      if (a !== b) changeLines.push(`${label}: “${a || 'vacío'}” → “${b || 'vacío'}”`);
    };
    if (fields.name !== undefined) cmp('Nombre', lead.name, fields.name);
    if (fields.phone !== undefined && update.phone) cmp('Teléfono', lead.phone, update.phone);
    if (fields.email !== undefined) cmp('Correo', lead.email, fields.email);
    if (fields.city !== undefined) cmp('Ciudad', lead.city, fields.city);
    if (fields.documentNumber !== undefined) cmp('Documento', lead.documentNumber, fields.documentNumber);
    if (fields.fuenteUbicacion !== undefined) cmp('Fuente', lead.fuenteUbicacion, fields.fuenteUbicacion);
    if (fields.projectInterest !== undefined) {
      cmp('Proyecto', (lead.projectInterest ?? []).join(', '), (fields.projectInterest ?? []).join(', '));
    }

    if (changeLines.length > 0) {
      const nowTs = Timestamp.now();
      const actor = await userDisplayName(companyId, ctx.uid);
      const description = changeLines.join(' · ').slice(0, 600);
      const entry = {
        id_registro: `ficha_${nowTs.toMillis()}`,
        origen: 'CRM',
        fecha: bogotaNowString(nowTs.toMillis()),
        lastDate: bogotaNowString(nowTs.toMillis()),
        action: 'Actualización de Ficha',
        description,
        asesor: actor.name,
      };
      const mergedBitacoras = mergeBitacoraLists([
        (update.bitacoras as unknown[]) ?? (lead as any).bitacoras,
        (update.metadata as any)?.smarthomeBitacoras ?? lead.metadata?.smarthomeBitacoras,
        (lead as any).smarthomeBitacoras,
      ], entry);

      update.bitacoras = mergedBitacoras;
      if (update.metadata && typeof update.metadata === 'object') {
        (update.metadata as Record<string, unknown>).smarthomeBitacoras = mergedBitacoras;
        (update.metadata as Record<string, unknown>).hasFicha = true;
      } else {
        update['metadata.smarthomeBitacoras'] = mergedBitacoras;
        update['metadata.hasFicha'] = true;
      }
      update.smartHomeLastBitacoraAt = nowTs;
      update.smartHomeLastBitacoraBy = ctx.uid;
      update.smartHomeLastBitacoraByName = actor.name;
      update.smartHomeLastBitacoraText = description.slice(0, 240);
      update.smartHomeLastActionLabel = 'Actualización de Ficha';
      update.smartHomeTrackingUpdatedAt = nowTs;
      update.lastFollowUpAt = nowTs;
      update.lastFollowUpAction = 'actualizacion_ficha';
      update.lastFollowUpSummary = description.slice(0, 240);
      update.lastFollowUpAuthor = actor.name;

      await leadsRepository.update(companyId, leadId, update);

      await db.runTransaction(async (tx) => {
        const noteRef = dealLeadRef(companyId, leadId).collection('notes').doc();
        tx.set(noteRef, {
          companyId,
          leadId,
          kind: 'note',
          type: 'ficha_tecnica',
          actionType: 'actualizacion_ficha',
          result: 'Actualización de Ficha',
          text: ['📝 FICHA ACTUALIZADA', ...changeLines.map((l) => `• ${l}`)].join('\n'),
          authorId: ctx.uid,
          authorName: actor.name,
          createdAt: nowTs,
        });
      }).catch((err) => logger.warn('[UpdateLead] No se pudo escribir nota de bitácora', { leadId, err }));

      await postLeadSmartHomeBitacora(
        { ...lead, ...(fields.phone && update.phone ? { phone: String(update.phone) } : {}), companyId, id: leadId },
        `[CRM · Ficha actualizada] ${description}`,
      ).catch((err) => logger.warn('[UpdateLead] No se pudo sincronizar cambio a SmartHome', { leadId, err }));
    } else {
      await leadsRepository.update(companyId, leadId, update);
    }

    if (update.assignedTo && typeof update.assignedTo === 'string' && update.assignedTo !== lead.assignedTo && update.assignedTo !== ctx.uid) {
      await sendLeadReassignedPush(companyId, lead, update.assignedTo, ctx.uid).catch((err) => {
        logger.error('[UpdateLead] Error al enviar notificacion de reasignacion', { err });
      });
    }

    logger.info('[UpdateLead] Lead actualizado', { leadId, update });
    return { leadId };
  }
);
