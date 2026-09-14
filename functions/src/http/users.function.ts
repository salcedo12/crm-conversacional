import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { getAuth }            from 'firebase-admin/auth';
import { Timestamp }          from 'firebase-admin/firestore';
import { logger }             from '../utils/logger';
import { env }                from '../config/env';
import { db }                 from '../lib/admin';
import { leadsRepository }     from '../modules/leads/leads.repository';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { normalizePhone } from '../utils/phone';
import { sendUserInviteEmail } from '../utils/inviteEmail';
import { sendLeadReassignedPush } from '../modules/messages/pushNotifications.service';

const usersCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('users');
const RoleSchema = z.enum(['admin', 'manager', 'advisor', 'viewer']);

export interface AdvisorDTO {
  id:              string;
  displayName:     string;
  email:           string;
  role:            string;
  active:          boolean;
  googleConnected: boolean;
  /** WhatsApp E.164 para avisos automáticos (ej. aviso de cita). '' si no se definió. */
  phone?:          string;
}

export interface CompanyUserDTO extends AdvisorDTO {
  invitedAt?: number | null;
  updatedAt?: number | null;
}

function serializeUser(id: string, data: FirebaseFirestore.DocumentData, googleConnected = false): CompanyUserDTO {
  return {
    id,
    displayName: data.displayName || data.email || id,
    email: data.email ?? '',
    role: data.role ?? 'advisor',
    active: data.active !== false,
    googleConnected,
    phone: data.phone ?? '',
    invitedAt: data.invitedAt?.toMillis?.() ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
  };
}

// ─── listCompanyUsers ─────────────────────────────────────────────────────────
// Panel administrativo de usuarios/asesores.

export const listCompanyUsers = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await usersCol(companyId).orderBy('displayName', 'asc').get();
    const users = await Promise.all(
      snap.docs.map(async (doc) => serializeUser(
        doc.id,
        doc.data(),
        !!(await googleConnectionRepository.getActive(companyId, doc.id))
      ))
    );
    return { users };
  }
);

export const createCompanyUser = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    secrets: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'],
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      email: z.string().email().max(180),
      displayName: z.string().trim().min(1).max(120),
      role: RoleSchema.default('advisor'),
      active: z.boolean().default(true),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const auth = getAuth();
    let userId = '';
    let inviteLink: string | null = null;
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const existing = await auth.getUserByEmail(data.email);
      userId = existing.uid;
      await auth.updateUser(userId, {
        displayName: data.displayName,
        disabled: !data.active,
      });
    } catch {
      const created = await auth.createUser({
        email: data.email,
        displayName: data.displayName,
        disabled: !data.active,
      });
      userId = created.uid;
    }

    try {
      inviteLink = await auth.generatePasswordResetLink(data.email, {
        url: `${env.appBaseUrl()}/login`,
        handleCodeInApp: false,
      });
    } catch (err) {
      logger.warn('[Users] No se pudo generar link de invitacion', {
        email: data.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (inviteLink) {
      try {
        await sendUserInviteEmail({
          to: data.email,
          displayName: data.displayName,
          role: data.role,
          inviteLink,
        });
        emailSent = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        logger.warn('[Users] No se pudo enviar correo de invitacion', {
          email: data.email,
          error: emailError,
        });
      }
    }

    const now = Timestamp.now();
    await usersCol(data.companyId).doc(userId).set({
      companyId: data.companyId,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
      active: data.active,
      invitedAt: now,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    logger.info('[Users] Usuario creado/invitado', {
      companyId: data.companyId,
      userId,
      emailSent,
      by: ctx.uid,
    });
    return { user: serializeUser(userId, data), inviteLink, emailSent, emailError };
  }
);

export const updateCompanyUser = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      userId: z.string().min(1),
      displayName: z.string().trim().min(1).max(120),
      role: RoleSchema,
      active: z.boolean(),
      // WhatsApp para avisos (ej. aviso de cita). Opcional; vacío = limpiar.
      phone: z.string().trim().max(25).optional(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const ref = usersCol(data.companyId).doc(data.userId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Usuario no encontrado.');

    await ref.set({
      displayName: data.displayName,
      role: data.role,
      active: data.active,
      // Solo si viene el campo: número normalizado a E.164, o '' para limpiarlo.
      ...(data.phone !== undefined ? { phone: data.phone ? normalizePhone(data.phone) : '' } : {}),
      updatedAt: Timestamp.now(),
    }, { merge: true });

    try {
      await getAuth().updateUser(data.userId, {
        displayName: data.displayName,
        disabled: !data.active,
      });
    } catch (err) {
      logger.warn('[Users] No se pudo sincronizar Auth user', {
        userId: data.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('[Users] Usuario actualizado', { companyId: data.companyId, userId: data.userId, by: ctx.uid });
    return { ok: true };
  }
);

// ─── listAdvisors ──────────────────────────────────────────────────────────────
// Lista los usuarios activos de la empresa para el selector de reasignación manual.
// Devuelve TODOS los roles activos (admin, manager, advisor, viewer): un admin puede
// reasignar un lead a quien quiera. La asignación AUTOMÁTICA de leads nuevos es aparte
// (pickAdvisorForLead) y sigue restringida a asesores.

export const listAdvisors = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    interface UserDoc { displayName?: string; email?: string; role?: string; active?: boolean }
    const snap = await usersCol(companyId).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as UserDoc }))
      .filter((u) => u.data.active !== false);

    const advisors: AdvisorDTO[] = await Promise.all(
      rows.map(async ({ id, data }) => ({
        id,
        displayName: data.displayName || data.email || id,
        email:       data.email ?? '',
        role:        data.role ?? 'advisor',
        active:      data.active !== false,
        googleConnected: !!(await googleConnectionRepository.getActive(companyId, id)),
      }))
    );

    advisors.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { advisors };
  }
);

// ─── reassignLead ──────────────────────────────────────────────────────────────
// Cambia el asesor asignado de un lead (o lo deja sin asignar con null).

export const reassignLead = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, advisorId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      advisorId: z.string().nullable(),  // null = desasignar
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    // Validar que el usuario destino exista y esté activo. Se permite CUALQUIER rol
    // (admin/manager/advisor/viewer): la reasignación manual la hace un admin y puede
    // dirigirse a quien quiera. (La asignación automática de leads nuevos es aparte y
    // sigue restringida a asesores.)
    if (advisorId) {
      const userSnap = await usersCol(companyId).doc(advisorId).get();
      const data = userSnap.data();
      if (!userSnap.exists || !data || data.active === false) {
        throw new HttpsError('failed-precondition', 'El usuario seleccionado no es válido.');
      }
    }

    const update: Record<string, unknown> = { assignedTo: advisorId ?? null };
    await leadsRepository.update(companyId, leadId, update);

    if (advisorId && advisorId !== lead.assignedTo && advisorId !== ctx.uid) {
      await sendLeadReassignedPush(companyId, lead, advisorId, ctx.uid).catch((err) => {
        logger.error('[ReassignLead] Error al enviar notificacion de reasignacion', { err });
      });
    }

    logger.info('[ReassignLead] Lead reasignado', {
      companyId,
      leadId,
      advisorId,
      by: ctx.uid,
    });

    return { leadId, advisorId };
  }
);

// ─── setLeadAssignmentLock ───────────────────────────────────────────────────
// Fija (o libera) el asesor de un lead. Con locked:true, el cron de reasignacion
// automatica por falta de primer contacto NUNCA lo tocará (queda "clavado" al
// asesor actual). Es lo que usa el candado del drawer del lead.

export const setLeadAssignmentLock = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, locked } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      locked:    z.boolean(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    const update: Record<string, unknown> = { assignmentLocked: locked };
    // Al fijar, además apagamos pendingFirstContact para que el lead salga de la
    // query del cron de inmediato (defensa + eficiencia). Al liberar solo quitamos
    // el candado; no re-armamos la reasignacion.
    if (locked) update.pendingFirstContact = false;

    await leadsRepository.update(companyId, leadId, update);

    logger.info('[SetLeadAssignmentLock] Candado de asignacion actualizado', {
      companyId,
      leadId,
      locked,
      by: ctx.uid,
    });

    return { leadId, locked };
  }
);
