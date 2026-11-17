import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import type { AuthContext } from '../lib/authContext';
import { draftStatusFor, EDITABLE_STATUSES, loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { dealActivityDoc, dealActivityRef } from '../modules/deals/dealAudit';
import { computeEarnestMoney, summarizePlan, termIssue } from '../modules/deals/paymentPlan';
import { phoneTail } from '../utils/phone';
import { getYcloudClientForCompany } from '../integrations/ycloud/ycloud.client';
import { getProjectLegalProfile } from '../modules/deals/legalProfiles';
import { oneLine } from '../modules/ai/aiFailureAlert';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
import type { Deal, PaymentPlan } from '../modules/deals/deals.types';

/**
 * Módulo Negocios — Aprobación de Planes Especiales por Gerencia vía WhatsApp
 *
 * Flujo:
 * 1. El asesor diligencia un plan especial o valor por fuera de lista en DealPlanModal.
 * 2. Clic en "Solicitar aprobación a WhatsApp".
 * 3. Se genera un registro de solicitud con token único y se envía un mensaje formal
 *    por la Línea 317 (YCloud) al número de gerencia (ej: Don Jhon o teléfono de prueba).
 * 4. Gerencia puede responder DIRECTAMENTE en WhatsApp ("AUTORIZADO", "AUTORIZADO sin referido", "RECHAZAR")
 *    o hacer 1 toque en el enlace web seguro incluido en el mensaje.
 * 5. El webhook de YCloud o el endpoint web detectan la respuesta, actualizan el negocio,
 *    registran la bitácora y envían confirmación por WhatsApp a gerencia.
 */

// ── Seguridad (R03) ──────────────────────────────────────────────────────────
// Quién puede aprobar NO lo decide el asesor: solo números de gerencia
// configurados en companies/{companyId}/configs/dealApprovals { approverPhones: [] }.
// Si no hay configuración se usa el número de gerencia histórico.
const DEFAULT_APPROVER_PHONES = ['+573148209662'];

async function getAllowedApproverTails(companyId: string): Promise<Set<string>> {
  let phones: string[] = DEFAULT_APPROVER_PHONES;
  try {
    const cfg = await db.collection('companies').doc(companyId).collection('configs').doc('dealApprovals').get();
    const list = cfg.exists ? cfg.data()?.approverPhones : null;
    if (Array.isArray(list) && list.length) phones = list.map(String);
  } catch (err) {
    logger.warn('[dealApproval] No se pudo leer configs/dealApprovals; se usa gerencia por defecto', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return new Set(phones.map((p) => phoneTail(normalizeColPhone(p))).filter(Boolean) as string[]);
}

/** Solo admin/manager ven el enlace de 1 toque; el asesor nunca debe poder aprobarse. */
function canSeeApprovalLink(ctx: AuthContext): boolean {
  return ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role);
}

function buildQuickActionUrl(companyId: string, approvalId: string, actionToken: string): string {
  return `https://us-central1-crm-conversacional.cloudfunctions.net/quickDealPlanApprovalAction?companyId=${encodeURIComponent(
    companyId
  )}&id=${encodeURIComponent(approvalId)}&token=${encodeURIComponent(actionToken)}`;
}

function tokensMatch(expected: unknown, given: string): boolean {
  if (typeof expected !== 'string' || !expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatPesosCol(val: number): string {
  return `$${Math.round(val || 0).toLocaleString('es-CO')}`;
}

function normalizeColPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+57${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('57')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

const PlanProposalSchema = z.object({
  termMonths:           z.number().int().min(0).max(240),
  landValue:            z.number().int().min(0),
  listPrice:            z.number().int().min(0).nullable().optional(),
  benefit:              z.number().int().min(0).default(0),
  totalLand:            z.number().int().min(0),
  separationSummary:    z.string().trim().min(1).max(500),
  ordinarySummary:      z.string().trim().min(1).max(500),
  extraordinarySummary: z.string().trim().max(1000).optional().default(''),
  severanceSummary:     z.string().trim().max(500).optional().default(''),
  referredBy:           z.string().trim().max(200).optional().default(''),
  notes:                z.string().trim().max(2000).optional().default(''),
});

const RequestApprovalSchema = z.object({
  companyId:     z.string().min(1),
  dealId:        z.string().min(1),
  approverPhone: z.string().min(7).max(30),
  approverName:  z.string().trim().max(100).optional().default('Gerencia'),
  proposal:      PlanProposalSchema,
  planDraft:     z.any().optional(),
});

/**
 * Callable: El asesor envía la solicitud de autorización a gerencia por WhatsApp.
 */
export const requestPlanApproval = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(RequestApprovalSchema, request.data, 'solicitar autorización');
  assertCompany(ctx, data.companyId);

  const { deal, ref } = await loadDeal(ctx, data.companyId, data.dealId);
  if (deal.status === 'anulado') {
    throw new HttpsError('failed-precondition', 'No se puede solicitar aprobación para un negocio anulado.');
  }
  if (!deal.lot) {
    throw new HttpsError('failed-precondition', 'Primero debes escoger el lote del negocio antes de solicitar aprobación.');
  }

  const normalizedApproverPhone = normalizeColPhone(data.approverPhone);
  if (!normalizedApproverPhone || normalizedApproverPhone.length < 10) {
    throw new HttpsError('invalid-argument', 'El número de teléfono del autorizador no es válido.');
  }
  const allowedApprovers = await getAllowedApproverTails(data.companyId);
  if (!allowedApprovers.has(phoneTail(normalizedApproverPhone) || '')) {
    logger.warn('[dealApproval][SECURITY] Aprobador no autorizado solicitado', {
      uid: ctx.uid, companyId: data.companyId, dealId: data.dealId, approverPhone: normalizedApproverPhone,
    });
    throw new HttpsError(
      'permission-denied',
      'Ese número no está registrado como autorizador de gerencia. Usa el número de gerencia configurado.'
    );
  }

  // `actionToken` (no `token`) invalida los enlaces anteriores, que quedaron
  // expuestos en el documento del negocio. Nunca se copia al negocio.
  const token = crypto.randomBytes(24).toString('hex');
  const approvalId = `appr_${deal.id}_${Date.now()}`;
  const now = Timestamp.now();

  const advisor = await userDisplayName(data.companyId, deal.advisorId || ctx.uid);
  const requester = await userDisplayName(data.companyId, ctx.uid);
  const buyerNames = (deal.buyerNames && deal.buyerNames.length) ? deal.buyerNames.join(', ') : 'Cliente';
  const projectName = getProjectLegalProfile(deal.lot.projectId)?.contractName || deal.lot.projectId;
  const lotInfo = `${deal.lot.sector} · Lote ${deal.lot.lotNumber}`;
  const areaStr = deal.lot.areaM2 ? `${deal.lot.areaM2.toLocaleString('es-CO')} m²` : '';

  const quickActionUrl = buildQuickActionUrl(data.companyId, approvalId, token);

  const { proposal } = data;
  const listPriceFormatted = proposal.listPrice ? formatPesosCol(proposal.listPrice) : null;
  const benefitFormatted = proposal.benefit > 0 ? formatPesosCol(proposal.benefit) : null;
  const totalLandFormatted = formatPesosCol(proposal.totalLand);
  const termStr = proposal.termMonths === 0 ? 'De contado' : `${proposal.termMonths} meses`;

  // Construir mensaje estructurado tipo propuesta de feria / dirección general
  const messageText =
    `📋 *SOLICITUD DE AUTORIZACIÓN ESPECIAL*\n\n` +
    `👤 *Asesor:* ${requester.name || advisor.name}\n` +
    `🤝 *Cliente(s):* ${buyerNames}\n` +
    `🏡 *Lote:* ${lotInfo}${areaStr ? ` (${areaStr})` : ''}\n` +
    (projectName ? `📍 *Proyecto:* ${projectName}\n` : '') +
    `\n` +
    (listPriceFormatted ? `• *Valor lista:* ${listPriceFormatted}\n` : '') +
    (benefitFormatted ? `• *Bono / Descuento:* ${benefitFormatted}\n` : '') +
    `• *Valor negociado:* ${totalLandFormatted}\n` +
    `• *Plazo propuesto:* ${termStr} (Especial)\n` +
    `\n` +
    `📌 *Forma de pago propuesta:*\n` +
    `• *Separación:* ${proposal.separationSummary}\n` +
    `• *Saldo en cuotas:* ${proposal.ordinarySummary}\n` +
    (proposal.extraordinarySummary ? `• *Cuotas extraordinarias:*\n${proposal.extraordinarySummary}\n` : '') +
    (proposal.severanceSummary ? `• *Cesantías:* ${proposal.severanceSummary}\n` : '') +
    (proposal.referredBy ? `• *Referido por:* ${proposal.referredBy}\n` : '') +
    (proposal.notes ? `• *Observaciones:* ${proposal.notes}\n` : '') +
    `\n` +
    `───────────────────\n` +
    `👉 *Para autorizar desde este chat, responde:*\n` +
    `*AUTORIZADO* o *APROBAR*\n` +
    `_(puedes agregar condiciones, ej: "Autorizado sin referido")_\n\n` +
    `O para rechazar, responde: *RECHAZAR*\n\n` +
    `⚡ *O autoriza con 1 toque desde tu celular:*\n` +
    `${quickActionUrl}`;

  // Guardar registro de aprobación
  const approvalRecord = {
    id: approvalId,
    companyId: data.companyId,
    dealId: deal.id,
    leadId: deal.leadId,
    actionToken: token,
    status: 'pending' as const,
    approverPhone: normalizedApproverPhone,
    approverTail: phoneTail(normalizedApproverPhone),
    approverName: data.approverName || 'Gerencia',
    advisorId: deal.advisorId,
    advisorName: advisor.name,
    buyerNames,
    lotInfo,
    projectName,
    quickActionUrl,
    proposal,
    // Copia exacta del borrador que vio gerencia: es lo único que se promueve al aprobar.
    ...(data.planDraft ? { planDraftSnapshot: data.planDraft } : {}),
    requestedAt: now,
    requestedBy: ctx.uid,
    requestedByName: requester.name,
  };

  const approvalsCol = db.collection('companies').doc(data.companyId).collection('dealApprovals');
  // Al reenviar o cambiar condiciones, cerrar solicitudes pendientes previas de este mismo negocio
  // para que una respuesta tardía a un mensaje anterior no aplique dos veces ni quede colgada.
  const prevPending = await approvalsCol.where('dealId', '==', deal.id).get();
  const supersededBatch = db.batch();
  let supersededCount = 0;
  for (const prevDoc of prevPending.docs) {
    if (prevDoc.get('status') === 'pending') {
      supersededBatch.update(prevDoc.ref, {
        status: 'superseded',
        resolvedAt: now,
        resolvedBy: requester.name,
        responseNotes: `Reemplazada por nueva solicitud (${approvalId})`,
      });
      supersededCount += 1;
    }
  }
  if (supersededCount > 0) await supersededBatch.commit();

  await approvalsCol.doc(approvalId).set(approvalRecord);

  // Actualizar deal con la solicitud pendiente y guardar el borrador del plan
  const updateDealPayload: Record<string, any> = {
    planApproval: {
      id: approvalId,
      status: 'pending',
      approverPhone: normalizedApproverPhone,
      approverName: data.approverName || 'Gerencia',
      requestedAt: now,
      // Sin token ni enlace: el asesor puede leer este documento.
      ...(data.planDraft ? { planDraft: data.planDraft } : {}),
    },
    updatedAt: now,
  };

  if (data.planDraft) {
    updateDealPayload.draftPlan = data.planDraft;
  }

  await ref.update(updateDealPayload);

  // Bitácora de actividad en el deal
  await dealActivityRef(data.companyId, deal.leadId).set(dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: requester.name,
    event: 'plan_saved',
    title: '📲 Solicitud de autorización de plan enviada por WhatsApp',
    lines: [
      `Destinatario: ${data.approverName || 'Gerencia'} (${normalizedApproverPhone})`,
      `Lote: ${lotInfo} · Plazo: ${termStr}`,
      `Valor negociado: ${totalLandFormatted}${benefitFormatted ? ` (Bono: ${benefitFormatted})` : ''}`,
    ],
    createdAt: now,
  }));

  // Envío a WhatsApp por Línea 317 vía YCloud
  let sentVia = 'template_autorizacion_plan_especial';
  try {
    const client = await getYcloudClientForCompany(data.companyId);

    const detailSummary = oneLine(
      `Separación: ${proposal.separationSummary}. Ordinarias: ${proposal.ordinarySummary}${
        proposal.referredBy ? ` · Ref: ${proposal.referredBy}` : ''
      }`,
      200
    );

    try {
      // 1. Prioridad: Plantilla oficial aprobada por Meta (entrega 24/7 sin restricción de ventana)
      await client.sendTemplate(normalizedApproverPhone, 'autorizacion_plan_especial', 'es', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: oneLine(requester.name || advisor.name || 'Asesor', 60) },
            { type: 'text', text: oneLine(buyerNames || 'Cliente', 60) },
            { type: 'text', text: oneLine(`${lotInfo}${areaStr ? ` (${areaStr})` : ''}`, 60) },
            { type: 'text', text: oneLine(totalLandFormatted, 40) },
            { type: 'text', text: oneLine(termStr, 30) },
            { type: 'text', text: detailSummary },
          ],
        },
      ]);
      logger.info('[dealApproval] Solicitud enviada exitosamente por plantilla autorizacion_plan_especial a WhatsApp', {
        companyId: data.companyId,
        dealId: deal.id,
        to: normalizedApproverPhone,
      });
    } catch (templateErr) {
      logger.warn('[dealApproval] Plantilla no disponible o falló, probando sendText / alerta_sistema', {
        error: templateErr instanceof Error ? templateErr.message : String(templateErr),
      });
      try {
        sentVia = 'sendText';
        await client.sendText(normalizedApproverPhone, messageText);
        logger.info('[dealApproval] Solicitud enviada por sendText a WhatsApp', {
          companyId: data.companyId,
          dealId: deal.id,
          to: normalizedApproverPhone,
        });
      } catch (sendErr) {
        logger.warn('[dealApproval] Falló sendText, probando alerta_sistema', {
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
        sentVia = 'template_alerta_sistema';
        await client.sendTemplate(normalizedApproverPhone, 'alerta_sistema', 'es', [
          { type: 'body', parameters: [{ type: 'text', text: oneLine(messageText) }] },
        ]);
      }
    }
  } catch (deliveryError) {
    logger.error('[dealApproval] Error general al enviar mensaje por YCloud', {
      error: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    });
    // Se deja registrada la solicitud para que el enlace web siga funcionando
  }

  return {
    ok: true as const,
    approvalId,
    status: 'pending' as const,
    approverPhone: normalizedApproverPhone,
    sentVia,
    quickActionUrl: canSeeApprovalLink(ctx) ? quickActionUrl : null,
  };
});

/**
 * Callable: Consulta el estado actual de la aprobación (útil para sondeo desde el modal).
 */
export const checkPlanApprovalStatus = onCall({ region: 'us-central1', timeoutSeconds: 15 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(z.object({ companyId: z.string().min(1), dealId: z.string().min(1) }), request.data, 'consultar aprobación');
  assertCompany(ctx, data.companyId);

  const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const approval = deal.planApproval;
  if (!approval) {
    return { status: 'none' as const };
  }

  // El enlace de 1 toque solo se entrega a gerencia, leído del registro privado.
  let quickActionUrl: string | null = null;
  if (canSeeApprovalLink(ctx) && approval.id && approval.status === 'pending') {
    const apprSnap = await db.collection('companies').doc(data.companyId).collection('dealApprovals').doc(approval.id).get();
    const actionToken = apprSnap.exists ? apprSnap.data()?.actionToken : null;
    if (typeof actionToken === 'string' && actionToken) {
      quickActionUrl = buildQuickActionUrl(data.companyId, approval.id, actionToken);
    }
  }

  return {
    status: approval.status,
    approvedBy: approval.resolvedBy,
    responseNotes: approval.responseNotes,
    approvedAt: approval.resolvedAt?.toMillis?.() ?? null,
    approverPhone: approval.approverPhone,
    quickActionUrl,
  };
});

/**
 * Resuelve una solicitud de aprobación (Aprobar / Rechazar).
 * Usado tanto por el Webhook de WhatsApp como por la página web de 1 toque.
 */
export async function resolvePlanApproval(params: {
  companyId: string;
  approvalId: string;
  approved: boolean;
  notes?: string;
  resolvedBy: string;
  via: 'whatsapp_reply' | 'web';
  messageId?: string;
}): Promise<{ ok: boolean; message: string; approval?: any }> {
  const approvalRef = db.collection('companies').doc(params.companyId).collection('dealApprovals').doc(params.approvalId);

  const now = Timestamp.now();
  const status = params.approved ? 'approved' : 'rejected';
  const cleanNotes = (params.notes || '').trim();

  // Seguridad (R03): marcar como resuelta dentro de una transacción para que dos
  // respuestas simultáneas (WhatsApp + enlace, o doble toque) no apliquen dos veces.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(approvalRef);
    if (!snap.exists) return { ok: false as const, message: 'Solicitud no encontrada' };
    const current = snap.data()!;
    if (current.status !== 'pending') {
      return {
        ok: false as const,
        message: `Esta solicitud ya fue ${current.status === 'approved' ? 'aprobada' : 'rechazada'} previamente.`,
        approval: current,
      };
    }
    tx.update(approvalRef, {
      status,
      resolvedAt: now,
      resolvedBy: params.resolvedBy,
      responseNotes: cleanNotes,
      via: params.via,
      ...(params.messageId ? { messageId: params.messageId } : {}),
    });
    return { ok: true as const, approval: current };
  });
  if (!claim.ok) return claim;
  const approval = claim.approval;

  // Actualizar Deal
  const dealRef = db.collection('companies').doc(params.companyId).collection('deals').doc(approval.dealId);
  const dealSnap = await dealRef.get();
  let advisorToNotify: string | undefined;
  if (dealSnap.exists) {
    const dealData = dealSnap.data() as Deal;
    advisorToNotify = dealData.advisorId;
    if (dealData.status === 'anulado') {
      return { ok: false, message: 'El negocio ya fue anulado; no se puede aplicar la autorización.', approval: { ...approval, status: 'cancelled' } };
    }
    if (!EDITABLE_STATUSES.includes(dealData.status)) {
      return { ok: false, message: 'El negocio ya entró a firma; no se puede promover el plan automáticamente.', approval: { ...approval, status } };
    }
    const specialTermApprovedBy = `${params.resolvedBy}${cleanNotes ? `: "${cleanNotes}"` : ''}`;

    const updatePayload: Record<string, any> = {
      'planApproval.status': status,
      'planApproval.resolvedAt': now,
      'planApproval.resolvedBy': params.resolvedBy,
      'planApproval.responseNotes': cleanNotes,
      updatedAt: now,
    };

    if (params.approved) {
      const approvedSpecialTerm = {
        approvedBy: specialTermApprovedBy,
        status: 'approved' as const,
        notes: cleanNotes,
        approvedAt: now.toDate().toISOString(),
      };
      if (dealData.plan) {
        const nextPlan: PaymentPlan = { ...dealData.plan, specialTerm: approvedSpecialTerm };
        updatePayload['plan.specialTerm'] = approvedSpecialTerm;
        updatePayload.status = draftStatusFor({ ...dealData, plan: nextPlan });
      } else if (approval.planDraftSnapshot || dealData.draftPlan) {
        // Promover a plan oficial EXACTAMENTE el borrador que gerencia revisó
        // (copia guardada en la solicitud), validando cuadre y plazo antes de escribirlo.
        const draft = (approval.planDraftSnapshot || dealData.draftPlan) as Omit<PaymentPlan, 'specialTerm'>;
        const promotedPlan: PaymentPlan = {
          ...draft,
          lotId: draft.lotId || dealData.lot?.inventoryLotId || '',
          listPrice: null,
          specialTerm: approvedSpecialTerm,
        };
        try {
          const summary = summarizePlan(promotedPlan);
          const outOfTerm = termIssue(summary.installments, promotedPlan.termMonths);
          if (summary.issues.length === 0 && !outOfTerm) {
            updatePayload.plan = promotedPlan;
            updatePayload.status = draftStatusFor({ ...dealData, plan: promotedPlan });
            if (dealData.lot) {
              updatePayload.planTotals = {
                totalLand: summary.totalLand,
                separation: summary.separationTotal,
                ordinary: summary.ordinaryTotal,
                extraordinary: summary.extraordinaryTotal,
                bonus: summary.bonusTotal,
                severance: summary.severanceTotal,
                installments: summary.installmentsTotal,
                earnestMoney: computeEarnestMoney(
                  promotedPlan.landValue,
                  getProjectLegalProfile(dealData.lot.projectId)?.earnestPercent ?? 30,
                ),
              };
            }
          }
        } catch (sumErr) {
          logger.warn('[dealApproval] No se pudo validar/promover el borrador aprobado', { dealId: dealData.id, error: String(sumErr) });
        }
      }
    } else if (dealData.plan) {
      updatePayload['plan.specialTerm'] = null;
    }

    await dealRef.update(updatePayload);

    // Bitácora
    await dealActivityRef(params.companyId, approval.leadId).set(dealActivityDoc({
      companyId: params.companyId,
      leadId: approval.leadId,
      dealId: approval.dealId,
      actorId: 'gerencia_approval',
      actorName: params.resolvedBy,
      event: 'plan_saved',
      title: params.approved
        ? '✅ Plan especial autorizado por Gerencia'
        : '❌ Plan especial rechazado por Gerencia',
      lines: [
        `Lote: ${approval.lotInfo}`,
        `Canal: ${params.via === 'whatsapp_reply' ? 'WhatsApp directo' : 'Enlace web 1 toque'}`,
        ...(cleanNotes ? [`Notas / Condiciones: "${cleanNotes}"`] : []),
      ],
      createdAt: now,
    }));
  }

  if (advisorToNotify) {
    await sendAdvisorPush(params.companyId, advisorToNotify, {
      title: params.approved ? 'Plan especial autorizado' : 'Plan especial rechazado',
      body: `${approval.lotInfo} (${approval.buyerNames})${cleanNotes ? ` · ${cleanNotes}` : ''}`,
      url: `/dashboard/deals/${approval.dealId}`,
      type: 'deal_plan_approval',
      leadId: approval.leadId,
    }).catch((err) => logger.warn('[dealApproval] No se pudo enviar push al asesor', { err }));
  }

  // Notificar confirmación por WhatsApp a Gerencia
  const confirmText = params.approved
    ? `✅ *Negocio Autorizado con Éxito*\n\n` +
      `🏡 *Lote:* ${approval.lotInfo}\n` +
      `👤 *Cliente:* ${approval.buyerNames}\n` +
      `📝 *Condiciones registradas:* "${cleanNotes || 'Sin condiciones adicionales'}"\n\n` +
      `El asesor *${approval.advisorName}* ya tiene la autorización registrada en el CRM para continuar.`
    : `❌ *Negocio No Autorizado*\n\n` +
      `🏡 *Lote:* ${approval.lotInfo}\n` +
      `👤 *Cliente:* ${approval.buyerNames}\n` +
      `📝 *Motivo:* "${cleanNotes || 'Rechazado por gerencia'}"\n\n` +
      `El asesor *${approval.advisorName}* fue notificado para ajustar el plan.`;

  try {
    const client = await getYcloudClientForCompany(params.companyId);
    await client.sendText(approval.approverPhone, confirmText);
  } catch (err) {
    logger.warn('[dealApproval] No se pudo enviar confirmación por WhatsApp a gerencia', { err });
  }

  return { ok: true, message: 'Resuelto exitosamente', approval: { ...approval, status } };
}

/**
 * Intercepta mensajes entrantes de WhatsApp en el webhook de YCloud para detectar
 * si provienen del número de gerencia y responden a una autorización pendiente.
 */
export async function handlePendingDealApprovalInbound(params: {
  companyId: string;
  fromPhone: string;
  textBody: string;
  msgId: string;
}): Promise<boolean> {
  const tail = phoneTail(params.fromPhone);
  if (!tail) return false;

  const latestPending = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
    docs
      .filter((d) => d.data().status === 'pending')
      .sort((a, b) => (b.get('requestedAt')?.toMillis?.() ?? 0) - (a.get('requestedAt')?.toMillis?.() ?? 0))[0];

  // 1. Buscar en la empresa del webhook (evita índice compuesto filtrando y ordenando en memoria)
  const companySnap = await db
    .collection('companies').doc(params.companyId)
    .collection('dealApprovals')
    .where('approverTail', '==', tail)
    .limit(50)
    .get();

  let approvalDoc = latestPending(companySnap.docs);

  // 2. Si no se encontró (por diferencias en enrutamiento de líneas), buscar en las otras empresas conocidas sin requerir collectionGroup
  if (!approvalDoc) {
    const KNOWN_COMPANIES = ['grupo_meraki_real', 'empresa_demo', 'meraki_luis_carlos'];
    for (const cid of KNOWN_COMPANIES) {
      if (cid === params.companyId) continue;
      const snap = await db
        .collection('companies').doc(cid)
        .collection('dealApprovals')
        .where('approverTail', '==', tail)
        .limit(50)
        .get();
      approvalDoc = latestPending(snap.docs);
      if (approvalDoc) break;
    }
  }

  if (!approvalDoc) return false;

  const approvalData = approvalDoc.data();
  const companyId = approvalData.companyId || params.companyId;
  const trimmed = params.textBody.trim();

  // Regex para aprobación:
  // "Autorizado", "Autorizados", "Ok autorizados. Gracias 🙏", "Autorizado sin referido", "Aprobar", "Aprobado", "Listo", "Dale"
  const isApproval =
    /^(autorizad[oa]s?|aprob[ao]d[oa]s?|apruebo|autorizo|ok\b|dale\b|listo\b|si\b|sí\b)/i.test(trimmed) ||
    /^(👍|✅|👌)/.test(trimmed);

  // Regex para rechazo:
  // "Rechazado", "Rechazar", "No", "No autorizado", "Denegado"
  const isRejection =
    /^(rechazad[oa]s?|rechazo|no\b|denegad[oa]s?|cancelad[oa]s?)/i.test(trimmed) ||
    /^(👎|❌)/.test(trimmed);

  if (isApproval) {
    logger.info('[dealApproval] Aprobación detectada vía WhatsApp', {
      from: params.fromPhone,
      text: trimmed,
      approvalId: approvalDoc.id,
    });
    await resolvePlanApproval({
      companyId,
      approvalId: approvalDoc.id,
      approved: true,
      notes: trimmed,
      resolvedBy: `Gerencia WhatsApp (+${params.fromPhone.replace(/\D/g, '')})`,
      via: 'whatsapp_reply',
      messageId: params.msgId,
    });
    return true;
  }

  if (isRejection) {
    logger.info('[dealApproval] Rechazo detectado vía WhatsApp', {
      from: params.fromPhone,
      text: trimmed,
      approvalId: approvalDoc.id,
    });
    await resolvePlanApproval({
      companyId,
      approvalId: approvalDoc.id,
      approved: false,
      notes: trimmed,
      resolvedBy: `Gerencia WhatsApp (+${params.fromPhone.replace(/\D/g, '')})`,
      via: 'whatsapp_reply',
      messageId: params.msgId,
    });
    return true;
  }

  // Si tiene solicitud pendiente pero escribió otra cosa (ej: pregunta o texto general):
  // Enviar mensaje recordatorio con opciones claras para no crear un lead falso.
  const helpText =
    `📋 Tienes una solicitud pendiente para el lote *${approvalData.lotInfo}* (${approvalData.buyerNames}).\n\n` +
    `• Para autorizar, responde: *AUTORIZADO* (o *AUTORIZADO sin referido*).\n` +
    `• Para rechazar, responde: *RECHAZAR*.\n` +
    `• O decide con 1 toque en tu celular:\n${approvalData.quickActionUrl}`;

  try {
    const client = await getYcloudClientForCompany(companyId);
    await client.sendText(params.fromPhone, helpText);
  } catch {}

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML de 1 toque para el celular de gerencia
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseApprovalHtml(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${escapeHtml(title)} - Meraki CRM</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0b0d11;
      color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 16px;
      padding-top: max(20px, env(safe-area-inset-top));
      padding-bottom: max(24px, env(safe-area-inset-bottom));
    }
    .container {
      width: 100%;
      max-width: 480px;
      background: #14171f;
      border: 1px solid #272a34;
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid #232733;
    }
    .header-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: #10b98120;
      color: #10b981;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
    }
    .header-sub {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 2px;
    }
    .card {
      background: #191d27;
      border: 1px solid #262a38;
      border-radius: 14px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .card-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .val-highlight {
      font-size: 18px;
      font-weight: 700;
      color: #34d399;
    }
    .grid-props {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 8px;
    }
    .prop-item {
      background: #12151d;
      border: 1px solid #202430;
      border-radius: 10px;
      padding: 8px 10px;
    }
    .prop-label {
      font-size: 10px;
      color: #94a3b8;
      text-transform: uppercase;
    }
    .prop-val {
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      margin-top: 2px;
    }
    .form-group {
      margin-top: 14px;
      margin-bottom: 16px;
    }
    .form-input {
      width: 100%;
      background: #0d0f14;
      border: 1px solid #272a36;
      border-radius: 10px;
      color: #ffffff;
      padding: 10px 12px;
      font-size: 13px;
      outline: none;
    }
    .form-input:focus { border-color: #10b981; }
    .actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 14px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 13px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      border: none;
      width: 100%;
    }
    .btn-approve {
      background: #059669;
      color: #ffffff;
    }
    .btn-reject {
      background: #dc2626;
      color: #ffffff;
    }
    .result-icon { font-size: 44px; text-align: center; margin-bottom: 10px; }
    .result-title { font-size: 18px; font-weight: 700; color: #ffffff; text-align: center; margin-bottom: 6px; }
    .result-text { font-size: 13px; color: #9ca3af; text-align: center; line-height: 1.4; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    ${bodyContent}
  </div>
</body>
</html>`;
}

/**
 * HTTP Endpoint para la decisión de gerencia con 1 toque desde el celular.
 */
export const quickDealPlanApprovalAction = onRequest(
  {
    region: 'us-central1',
    cors: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    invoker: 'public',
  },
  async (req, res) => {
    const companyId = String(req.query.companyId || req.body?.companyId || '').trim();
    const approvalId = String(req.query.id || req.body?.id || '').trim();
    const token = String(req.query.token || req.body?.token || '').trim();

    if (!companyId || !approvalId || !token) {
      res.status(400).send(
        baseApprovalHtml(
          'Error',
          `<div class="result-icon">⚠️</div>
           <div class="result-title">Enlace incompleto</div>
           <p class="result-text">El enlace de autorización no contiene los identificadores de seguridad requeridos.</p>`
        )
      );
      return;
    }

    try {
      const approvalRef = db.collection('companies').doc(companyId).collection('dealApprovals').doc(approvalId);
      const snap = await approvalRef.get();
      if (!snap.exists) {
        res.status(404).send(
          baseApprovalHtml(
            'No encontrado',
            `<div class="result-icon">🔍</div>
             <div class="result-title">Solicitud no encontrada</div>
             <p class="result-text">Esta solicitud de autorización ya no existe en el sistema.</p>`
          )
        );
        return;
      }

      const data = snap.data()!;
      if (!tokensMatch(data.actionToken, token)) {
        res.status(403).send(
          baseApprovalHtml(
            'No autorizado',
            `<div class="result-icon">🔒</div>
             <div class="result-title">Enlace no válido</div>
             <p class="result-text">Este enlace de autorización ya no es válido. Responde <b>AUTORIZADO</b> o <b>RECHAZAR</b> directamente en el chat de WhatsApp, o pide al asesor que reenvíe la solicitud.</p>`
          )
        );
        return;
      }

      // Si ya está resuelta:
      if (data.status !== 'pending') {
        const isApp = data.status === 'approved';
        res.status(200).send(
          baseApprovalHtml(
            isApp ? 'Plan Autorizado' : 'Plan Rechazado',
            `<div class="result-icon">${isApp ? '✅' : '❌'}</div>
             <div class="result-title">${isApp ? '¡Negocio ya Autorizado!' : 'Negocio Rechazado'}</div>
             <p class="result-text">Esta solicitud fue respondida el ${
               data.resolvedAt?.toDate?.()?.toLocaleString('es-CO', { timeZone: 'America/Bogota' }) ?? ''
             } por ${escapeHtml(data.resolvedBy)}.</p>
             ${data.responseNotes ? `<p class="result-text" style="color:#e2e8f0;font-style:italic;">"${escapeHtml(data.responseNotes)}"</p>` : ''}`
          )
        );
        return;
      }

      // Procesar POST (cuando el usuario hace clic en Aprobar o Rechazar en la página web)
      if (req.method === 'POST') {
        const action = String(req.body?.action || '').trim().toLowerCase();
        const notes = String(req.body?.notes || '').trim();
        const approved = action === 'approve';

        await resolvePlanApproval({
          companyId,
          approvalId,
          approved,
          notes,
          resolvedBy: `Gerencia Web (${data.approverName || 'Don Jhon'})`,
          via: 'web',
        });

        res.status(200).send(
          baseApprovalHtml(
            approved ? '¡Negocio Autorizado!' : 'Negocio Rechazado',
            `<div class="result-icon">${approved ? '🎉' : '❌'}</div>
             <div class="result-title">${approved ? '¡Negocio Autorizado con Éxito!' : 'Solicitud Rechazada'}</div>
             <p class="result-text">
               ${
                 approved
                   ? `La autorización para el <b>${escapeHtml(data.lotInfo)}</b> ha quedado registrada en el sistema. El asesor <b>${escapeHtml(
                       data.advisorName
                     )}</b> ya puede continuar.`
                   : `El asesor <b>${escapeHtml(data.advisorName)}</b> fue notificado en el sistema para ajustar la propuesta.`
               }
             </p>
             ${notes ? `<p class="result-text" style="color:#e2e8f0;font-style:italic;">Condiciones: "${escapeHtml(notes)}"</p>` : ''}`
          )
        );
        return;
      }

      // Renderizar formulario GET
      const prop = data.proposal || {};
      res.status(200).send(
        baseApprovalHtml(
          'Autorizar Plan Especial',
          `<div class="header">
             <div class="header-icon">📋</div>
             <div>
               <div class="header-title">Autorización de Plan Especial</div>
               <div class="header-sub">${escapeHtml(data.projectName || 'Meraki Constructora')}</div>
             </div>
           </div>

           <div class="card">
             <div class="card-title">Detalles del Negocio</div>
             <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:4px;">${escapeHtml(data.lotInfo)}</div>
             <div style="font-size:13px;color:#9ca3af;">Cliente: <b style="color:#ffffff;">${escapeHtml(data.buyerNames)}</b></div>
             <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Asesor solicitante: <b>${escapeHtml(data.advisorName)}</b></div>

             <div class="grid-props">
               <div class="prop-item">
                 <div class="prop-label">Valor Negociado</div>
                 <div class="prop-val val-highlight">${formatPesosCol(prop.totalLand)}</div>
               </div>
               <div class="prop-item">
                 <div class="prop-label">Plazo Propuesto</div>
                 <div class="prop-val">${prop.termMonths === 0 ? 'Contado' : `${prop.termMonths} meses`}</div>
               </div>
               ${
                 prop.listPrice
                   ? `<div class="prop-item"><div class="prop-label">Precio Lista</div><div class="prop-val">${formatPesosCol(
                       prop.listPrice
                     )}</div></div>`
                   : ''
               }
               ${
                 prop.benefit > 0
                   ? `<div class="prop-item"><div class="prop-label">Bono / Descuento</div><div class="prop-val" style="color:#fbbf24;">${formatPesosCol(
                       prop.benefit
                     )}</div></div>`
                   : ''
               }
             </div>
           </div>

           <div class="card">
             <div class="card-title">Forma de Pago Propuesta</div>
             <div style="font-size:13px;margin-bottom:6px;"><b>Separación:</b> ${escapeHtml(prop.separationSummary)}</div>
             <div style="font-size:13px;margin-bottom:6px;"><b>Saldo cuotas:</b> ${escapeHtml(prop.ordinarySummary)}</div>
             ${prop.extraordinarySummary ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;"><b>Extraordinarias:</b><br>${escapeHtml(prop.extraordinarySummary)}</div>` : ''}
             ${prop.notes ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:4px;"><b>Observaciones:</b> ${escapeHtml(prop.notes)}</div>` : ''}
             ${prop.referredBy ? `<div style="font-size:12px;color:#cbd5e1;"><b>Referido por:</b> ${escapeHtml(prop.referredBy)}</div>` : ''}
           </div>

           <form method="POST">
             <input type="hidden" name="companyId" value="${escapeHtml(companyId)}">
             <input type="hidden" name="id" value="${escapeHtml(approvalId)}">
             <input type="hidden" name="token" value="${escapeHtml(token)}">

             <div class="form-group">
               <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;font-weight:600;">
                 CONDICIÓN O NOTA ADICIONAL (Opcional, ej: "Sin referido"):
               </label>
               <input type="text" name="notes" class="form-input" placeholder="Ej: Autorizado sin referido" autocomplete="off">
             </div>

             <div class="actions-grid">
               <button type="submit" name="action" value="reject" class="btn btn-reject">
                 ❌ Rechazar
               </button>
               <button type="submit" name="action" value="approve" class="btn btn-approve">
                 ✅ AUTORIZAR
               </button>
             </div>
           </form>`
        )
      );
    } catch (err) {
      logger.error('[dealApproval] Error en quickDealPlanApprovalAction', { err });
      res.status(500).send(
        baseApprovalHtml(
          'Error',
          `<div class="result-icon">⚠️</div>
           <div class="result-title">Error del servidor</div>
           <p class="result-text">Ocurrió un error inesperado al procesar la solicitud.</p>`
        )
      );
    }
  }
);
