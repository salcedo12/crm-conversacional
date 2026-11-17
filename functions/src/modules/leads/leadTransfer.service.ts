import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { sendAdvisorPush } from '../messages/pushNotifications.service';

export const leadCollection = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

export const transferRequestsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('transferRequests');

export interface ResolveLeadTransferParams {
  companyId: string;
  requestId: string;
  action: 'approve' | 'reject';
  adminNote?: string | null;
  targetAdvisorId?: string | null;
  resolvedById: string;
  resolvedByName: string;
}

export interface ResolveLeadTransferResult {
  ok: boolean;
  status: 'approved' | 'rejected';
  leadId: string;
  leadName: string;
  leadPhone?: string;
  requesterId?: string;
  requesterName?: string;
  newAdvisorName?: string;
  newAdvisorId?: string | null;
  message?: string;
}

/**
 * Resuelve una solicitud de traslado de lead (Aprobar o Rechazar), ejecutando
 * todas las actualizaciones en Firestore, bitácoras de gestión, notas internas
 * y notificaciones push a los asesores involucrados.
 */
export async function executeResolveLeadTransferRequest(
  params: ResolveLeadTransferParams
): Promise<ResolveLeadTransferResult> {
  const { companyId, requestId, action, adminNote, resolvedById, resolvedByName } = params;

  const reqRef = transferRequestsCol(companyId).doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new Error('Solicitud de traslado no encontrada.');
  }

  const reqData = reqSnap.data() ?? {};
  if (reqData.status !== 'pending') {
    return {
      ok: false,
      status: reqData.status as 'approved' | 'rejected',
      leadId: reqData.leadId,
      leadName: reqData.leadName || 'Prospecto',
      leadPhone: reqData.leadPhone,
      newAdvisorName: reqData.finalAssignedName,
      message: 'Esta solicitud ya fue procesada anteriormente.',
    };
  }

  const now = Timestamp.now();

  if (action === 'approve') {
    const leadRef = leadCollection(companyId).doc(reqData.leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      throw new Error('El prospecto asociado ya no existe.');
    }
    const leadData = leadSnap.data() ?? {};

    const isReassignment = Boolean(
      reqData.isReassignmentRequest || reqData.requesterId === reqData.currentAdvisorId
    );
    const finalTargetId =
      params.targetAdvisorId !== undefined
        ? params.targetAdvisorId || null
        : reqData.targetAdvisorId || (!isReassignment ? reqData.requesterId : null);

    let newAdvisorName = 'Sin Asignar';
    if (finalTargetId) {
      try {
        const uSnap = await db
          .collection('companies')
          .doc(companyId)
          .collection('users')
          .doc(finalTargetId)
          .get();
        if (uSnap.exists) {
          newAdvisorName =
            (uSnap.data()?.displayName as string) ||
            (uSnap.data()?.name as string) ||
            'Asesor';
        }
      } catch {}
    }

    const updatedTags = Array.from(new Set([...(leadData.tags || []), 'traslado_aprobado']));
    const nowFormatted = new Date(Date.now() - 5 * 3600 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const followUpSummary = reqData.reason
      ? `Traslado comercial: ${reqData.reason}`
      : `Traslado comercial aprobado por Dirección Comercial (${resolvedByName})`;

    const transferBitacoraEntry = {
      fecha: nowFormatted,
      action: 'Traslado Aprobado',
      description: followUpSummary,
      asesor: resolvedByName || 'Dirección Comercial',
      system: true,
      lastDate: nowFormatted,
    };
    const existingBitacoras = [
      ...(Array.isArray(leadData.bitacoras) ? leadData.bitacoras : []),
      ...(Array.isArray(leadData.metadata?.smarthomeBitacoras)
        ? leadData.metadata.smarthomeBitacoras
        : []),
    ];
    const updatedBitacoras = [transferBitacoraEntry, ...existingBitacoras].slice(0, 50);

    await leadRef.update({
      assignedTo: finalTargetId,
      previousAdvisorId: leadData.assignedTo || null,
      advisorAssignedAt: now,
      updatedAt: now,
      // No se toca lastFollowUpAt: el traslado no es una gestión del asesor. Así el
      // prospecto le aparece al nuevo asesor en "Falta seguimiento" hasta que registre
      // una llamada o bitácora real. La bitácora del traslado queda como historial.
      bitacoras: updatedBitacoras,
      'metadata.smarthomeBitacoras': updatedBitacoras,
      tags: updatedTags,
      ...(reqData.suggestedName && (!leadData.name || leadData.name.startsWith('Lead '))
        ? { name: reqData.suggestedName }
        : {}),
    });

    // Registrar en la bitácora del prospecto (subcolección notes)
    await leadRef.collection('notes').add({
      companyId,
      leadId: reqData.leadId,
      authorId: resolvedById,
      authorName: resolvedByName,
      text: `🔄 ${isReassignment ? 'Reasignación' : 'Traslado'} aprobada por Dirección Comercial (${resolvedByName}). Pasa de ${
        reqData.currentAdvisorName
      } a ${newAdvisorName}.${reqData.reason ? `\n• Motivo: ${reqData.reason}` : ''}${
        adminNote ? `\n• Nota Admin: ${adminNote}` : ''
      }`,
      kind: 'note',
      type: 'audit',
      actionType: 'traslado_comercial',
      source: 'system',
      createdAt: now,
    });

    await reqRef.update({
      status: 'approved',
      resolvedAt: now,
      resolvedBy: resolvedById,
      resolvedByName,
      adminNote: adminNote || null,
      finalAssignedTo: finalTargetId,
      finalAssignedName: newAdvisorName,
    });

    // Notificar al asesor beneficiario (si es diferente del solicitante)
    if (finalTargetId && finalTargetId !== reqData.requesterId) {
      await sendAdvisorPush(companyId, finalTargetId, {
        title: '✅ Lead Reasignado a tu Cuenta',
        body: `Dirección Comercial te asignó el prospecto ${reqData.leadName} (${reqData.leadPhone}).`,
        url: `/dashboard/inbox?lead=${reqData.leadId}`,
        type: 'transfer_approved',
        leadId: reqData.leadId,
      }).catch(() => {});
    }

    // Notificar al solicitante
    await sendAdvisorPush(companyId, reqData.requesterId, {
      title: isReassignment ? '✅ Solicitud de Reasignación Aprobada' : '✅ Solicitud de Traslado Aprobada',
      body: isReassignment
        ? `Dirección Comercial aprobó la reasignación de ${reqData.leadName} a ${newAdvisorName}.`
        : `Dirección Comercial aprobó el traslado de ${reqData.leadName} (${reqData.leadPhone}) a tu cuenta.`,
      url: `/dashboard/inbox?lead=${reqData.leadId}`,
      type: 'transfer_approved',
      leadId: reqData.leadId,
    }).catch(() => {});

    logger.info('[TransferRequest] Traslado aprobado exitosamente', {
      companyId,
      requestId,
      leadId: reqData.leadId,
      from: reqData.currentAdvisorId,
      to: finalTargetId,
      by: resolvedByName,
    });

    return {
      ok: true,
      status: 'approved',
      leadId: reqData.leadId,
      leadName: reqData.leadName || 'Prospecto',
      leadPhone: reqData.leadPhone,
      requesterId: reqData.requesterId,
      requesterName: reqData.requesterName,
      newAdvisorName,
      newAdvisorId: finalTargetId,
    };
  } else {
    await reqRef.update({
      status: 'rejected',
      resolvedAt: now,
      resolvedBy: resolvedById,
      resolvedByName,
      adminNote: adminNote || null,
    });

    // Registrar en la bitácora del prospecto (subcolección notes)
    try {
      const leadRef = leadCollection(companyId).doc(reqData.leadId);
      await leadRef.collection('notes').add({
        companyId,
        leadId: reqData.leadId,
        authorId: resolvedById,
        authorName: resolvedByName,
        text: `❌ Solicitud de traslado rechazada por Dirección Comercial (${resolvedByName}). El prospecto permanece con ${
          reqData.currentAdvisorName
        }.${adminNote ? `\n• Motivo/Nota: ${adminNote}` : ''}`,
        kind: 'note',
        type: 'audit',
        actionType: 'traslado_comercial',
        source: 'system',
        createdAt: now,
      });
    } catch {}

    await sendAdvisorPush(companyId, reqData.requesterId, {
      title: '❌ Solicitud de Traslado Rechazada',
      body: `Tu solicitud de traslado para el número ${reqData.leadPhone} no fue aprobada.${
        adminNote ? ` Nota: ${adminNote}` : ''
      }`,
      url: '/dashboard/leads',
      type: 'transfer_rejected',
    }).catch(() => {});

    logger.info('[TransferRequest] Traslado rechazado', {
      companyId,
      requestId,
      leadId: reqData.leadId,
      by: resolvedByName,
    });

    return {
      ok: true,
      status: 'rejected',
      leadId: reqData.leadId,
      leadName: reqData.leadName || 'Prospecto',
      leadPhone: reqData.leadPhone,
      requesterId: reqData.requesterId,
      requesterName: reqData.requesterName,
    };
  }
}
