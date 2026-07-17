import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { callsRepository } from '../modules/calls/calls.repository';
import { getYcloudClient } from '../integrations/ycloud/ycloud.client';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import type { AuthContext } from '../lib/authContext';
import type { Call } from '../modules/calls/calls.types';
import type { Lead } from '../modules/leads/leads.types';

const CallRefSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  callId:    z.string().min(1),
});

/**
 * Un asesor puede operar sobre un lead si es admin/manager, si el lead está
 * asignado a él, o si el lead no tiene asesor asignado (leads sin asignar se
 * muestran a todos los asesores en el banner de llamada entrante).
 */
function canOperateOnLead(ctx: AuthContext, lead: Lead): boolean {
  return ADMIN_ROLES.includes(ctx.role) || !lead.assignedTo || lead.assignedTo === ctx.uid;
}

async function loadAuthorizedLead(ctx: AuthContext, companyId: string, leadId: string): Promise<Lead> {
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
  if (!canOperateOnLead(ctx, lead)) {
    throw new HttpsError('permission-denied', 'Solo puedes operar leads asignados a ti.');
  }
  return lead;
}

/** Carga lead+call y valida que el asesor pueda operar sobre ese lead. */
async function loadAuthorizedCall(
  ctx: AuthContext,
  companyId: string,
  leadId: string,
  callId: string
): Promise<{ lead: Lead; call: Call }> {
  const lead = await loadAuthorizedLead(ctx, companyId, leadId);
  const call = await callsRepository.findById(companyId, leadId, callId);
  if (!call) throw new HttpsError('not-found', 'Llamada no encontrada.');
  if (!call.phoneId) throw new HttpsError('failed-precondition', 'La llamada no tiene phoneId de ycloud.');
  return { lead, call };
}

// ─── Solicitar permiso de llamada de voz al lead ──────────────────────────────

const DEFAULT_PERMISSION_TEXT =
  '¿Nos permites llamarte por WhatsApp para ayudarte más rápido?';

export const requestCallPermission = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await loadAuthorizedLead(ctx, companyId, leadId);

    try {
      await getYcloudClient().requestCallPermission(env.ycloudCallingFromNumber(), lead.phone, DEFAULT_PERMISSION_TEXT);
    } catch (err) {
      logger.error('[requestCallPermission] Error enviando solicitud', {
        leadId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo enviar la solicitud de permiso.');
    }

    await leadsRepository.update(companyId, leadId, {
      callPermission: {
        granted: lead.callPermission?.granted ?? false,
        ...(lead.callPermission?.isPermanent !== undefined && { isPermanent: lead.callPermission.isPermanent }),
        ...(lead.callPermission?.grantedAt && { grantedAt: lead.callPermission.grantedAt }),
        ...(lead.callPermission?.expiresAt !== undefined && { expiresAt: lead.callPermission.expiresAt }),
        lastRequestedAt: Timestamp.now(),
      },
    });

    return { ok: true };
  }
);

// ─── Iniciar una llamada saliente (el negocio llama al lead) ─────────────────

export const startWhatsappCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, sdpOffer } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      sdpOffer:  z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    if (!env.ycloudCallingEnabled()) {
      throw new HttpsError('failed-precondition', 'Las llamadas de voz por WhatsApp no están configuradas todavía.');
    }

    const lead = await loadAuthorizedLead(ctx, companyId, leadId);
    if (!lead.callPermission?.granted) {
      throw new HttpsError('failed-precondition', 'El lead no ha dado permiso de llamada de voz todavía.');
    }

    let result;
    try {
      result = await getYcloudClient().connectCall({
        from: env.ycloudCallingFromNumber(),
        to:   lead.phone,
        sdp:  sdpOffer,
      });
    } catch (err) {
      logger.error('[startWhatsappCall] Error en ycloud connect', {
        leadId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo iniciar la llamada.');
    }

    const now = Timestamp.now();
    const call = await callsRepository.create({
      companyId,
      leadId:     lead.id,
      direction:  'outbound',
      provider:   'ycloud_whatsapp',
      status:     'connecting',
      externalId: result.wacid ?? result.id,
      phoneId:    result.phoneId ?? env.ycloudCallingPhoneId(),
      sdpOffer,
      triggeredBy: ctx.uid,
      ...(lead.assignedTo ? { assignedTo: lead.assignedTo } : {}),
      leadName:  lead.name ?? lead.phone,
      leadPhone: lead.phone,
      createdAt: now,
    });

    return { callId: call.id };
  }
);

// ─── Pre-aceptar una llamada entrante (SDP answer temprano) ──────────────────
// Usa una transacción para que, si dos asesores contestan a la vez, solo el
// primero la reclame — el resto recibe 'already-exists'.

export const preAcceptWhatsappCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, callId, sdpAnswer } = CallRefSchema
      .extend({ sdpAnswer: z.string().min(1) })
      .parse(request.data);
    assertCompany(ctx, companyId);

    const { call } = await loadAuthorizedCall(ctx, companyId, leadId, callId);

    const callRef = callsRepository.ref(companyId, leadId, callId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(callRef);
      const current = snap.data() as Call | undefined;
      if (!current) throw new HttpsError('not-found', 'Llamada no encontrada.');
      if (current.claimedBy && current.claimedBy !== ctx.uid) {
        throw new HttpsError('already-exists', 'Otro asesor ya está atendiendo esta llamada.');
      }
      tx.update(callRef, { claimedBy: ctx.uid, updatedAt: Timestamp.now() });
    });

    try {
      await getYcloudClient().preAcceptCall({ phoneId: call.phoneId!, sdp: sdpAnswer });
    } catch (err) {
      logger.error('[preAcceptWhatsappCall] Error en ycloud preAccept', {
        leadId, callId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo pre-aceptar la llamada.');
    }

    await callsRepository.update(companyId, leadId, callId, { sdpAnswer, status: 'connecting' });
    return { ok: true };
  }
);

// ─── Aceptar definitivamente una llamada entrante ─────────────────────────────

export const acceptWhatsappCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, callId } = CallRefSchema.parse(request.data);
    assertCompany(ctx, companyId);

    const { call } = await loadAuthorizedCall(ctx, companyId, leadId, callId);
    if (!call.externalId) throw new HttpsError('failed-precondition', 'La llamada no tiene wacid.');

    try {
      await getYcloudClient().acceptCall({ phoneId: call.phoneId!, wacid: call.externalId });
    } catch (err) {
      logger.error('[acceptWhatsappCall] Error en ycloud accept', {
        leadId, callId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo aceptar la llamada.');
    }

    await callsRepository.update(companyId, leadId, callId, { status: 'in-progress' });
    return { ok: true };
  }
);

// ─── Rechazar una llamada entrante ────────────────────────────────────────────

export const rejectWhatsappCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, callId } = CallRefSchema.parse(request.data);
    assertCompany(ctx, companyId);

    const { call } = await loadAuthorizedCall(ctx, companyId, leadId, callId);
    if (!call.externalId) throw new HttpsError('failed-precondition', 'La llamada no tiene wacid.');

    try {
      await getYcloudClient().rejectCall({ phoneId: call.phoneId!, wacid: call.externalId });
    } catch (err) {
      logger.error('[rejectWhatsappCall] Error en ycloud reject', {
        leadId, callId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo rechazar la llamada.');
    }

    await callsRepository.update(companyId, leadId, callId, { status: 'rejected' });
    return { ok: true };
  }
);

// ─── Terminar una llamada (entrante o saliente, en curso) ─────────────────────

export const terminateWhatsappCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, callId } = CallRefSchema.parse(request.data);
    assertCompany(ctx, companyId);

    const { call } = await loadAuthorizedCall(ctx, companyId, leadId, callId);
    if (!call.externalId) throw new HttpsError('failed-precondition', 'La llamada no tiene wacid.');

    try {
      await getYcloudClient().terminateCall({ phoneId: call.phoneId!, wacid: call.externalId });
    } catch (err) {
      logger.error('[terminateWhatsappCall] Error en ycloud terminate', {
        leadId, callId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo terminar la llamada.');
    }

    // El estado final real (completed/failed + duración) lo confirma el webhook
    // whatsapp.call.terminate; acá solo reflejamos que el asesor colgó.
    await callsRepository.update(companyId, leadId, callId, { status: 'completed' });
    return { ok: true };
  }
);
