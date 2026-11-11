import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';
import { draftStatusFor, EDITABLE_STATUSES, loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { dealActivityDoc, dealActivityRef, money as formatMoney } from '../modules/deals/dealAudit';
import { parseCivilDate } from '../modules/deals/civilDate';
import { computeEarnestMoney, summarizePlan, termIssue } from '../modules/deals/paymentPlan';
import { getProjectLegalProfile } from '../modules/deals/legalProfiles';
import type { PaymentPlan } from '../modules/deals/deals.types';
import { loadPriceList, priceOptionsFor } from '../modules/pricing/priceList';

/**
 * Módulo Negocios — Fase 3: plan de negocio ("CIERRE DEL NEGOCIO" de la preventa):
 * valor del terreno, beneficio, cesantías, separación, cuotas, referido y observaciones.
 */

const DealSchema = z.object({ companyId: z.string().min(1), dealId: z.string().min(1) });

/** Precios de lista del lote del negocio por plazo (sugerencia para el valor del terreno) y % de arras. */
export const getDealPriceOptions = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(DealSchema, request.data, 'consultar precios');
  assertCompany(ctx, data.companyId);

  const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!deal.lot) return { options: [], earnestPercent: 30 };
  const rows = await loadPriceList();
  return {
    options: priceOptionsFor(rows, deal.lot.sector, deal.lot.lotNumber),
    earnestPercent: getProjectLegalProfile(deal.lot.projectId)?.earnestPercent ?? 30,
  };
});

const civilDate = z.string().refine((v) => { try { parseCivilDate(v); return true; } catch { return false; } }, 'Fecha inválida');
const money = z.number().int().min(0).max(100_000_000_000);

const PlanSchema = z.object({
  mode:       z.enum(['simple', 'especifico']),
  simple:     z.object({
    separationTotal:     money,
    separationCount:     z.number().int().min(1).max(24),
    separationFirstDate: civilDate,
    separationPayments:  z.array(z.object({ amount: money, date: civilDate })).min(1).max(24).optional(),
    ordinaryCount:       z.number().int().min(0).max(240),
    ordinaryFirstDate:   civilDate,
    ordinaryMode:        z.enum(['automatico', 'rangos']).optional(),
    ordinaryRanges:      z.array(z.object({ amount: money, fromDate: civilDate, toDate: civilDate })).max(60).optional(),
    extraordinary:       z.array(z.object({ amount: money, date: civilDate })).max(60),
  }).optional(),
  listPrice:  money.nullable().optional(),
  landValue:  money.refine((v) => v > 0, 'El valor del terreno debe ser mayor que cero'),
  termMonths: z.number().int().min(0).max(240),
  specialTerm: z.object({ approvedBy: z.string().trim().max(120) }).nullable().optional(),
  benefit:    money,
  severance:  z.object({ fundName: z.string().trim().max(120), amount: money }).nullable(),
  rows:       z.array(z.object({
    kind:      z.enum(['separacion', 'ordinaria', 'extraordinaria', 'bono']),
    count:     z.number().int().min(0).max(240),
    amount:    money,
    firstDate: civilDate,
  })).min(1).max(200),
  referredBy: z.string().trim().max(200).optional(),
  notes:      z.string().trim().max(2000).optional(),
});

const SavePlanSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  plan:      PlanSchema,
});

/** Guarda el plan del negocio. Solo se acepta si cuadra (cuotas + cesantías = total del terreno). */
export const saveDealPlan = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(SavePlanSchema, request.data, 'guardar el plan');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!EDITABLE_STATUSES.includes(deal.status)) {
    throw new HttpsError('failed-precondition', 'Este negocio ya tiene documentos; el plan no se puede cambiar.');
  }
  if (!deal.lot) throw new HttpsError('failed-precondition', 'Primero escoge el lote del negocio.');

  const plan: PaymentPlan = {
    ...data.plan,
    lotId: deal.lot.inventoryLotId,
    severance: data.plan.severance && data.plan.severance.amount > 0 ? data.plan.severance : null,
    referredBy: data.plan.referredBy || '',
    notes: data.plan.notes || '',
    specialTerm: data.plan.specialTerm ?? null,
    ...(data.plan.specialTerm ? { listPrice: null } : {}),
  };
  // Plazo especial de un lote que SÍ está en la lista: debe quedar quién lo aprobó.
  if (plan.specialTerm && !plan.specialTerm.approvedBy) {
    const listed = priceOptionsFor(await loadPriceList(), deal.lot.sector, deal.lot.lotNumber);
    if (listed.length) throw new HttpsError('invalid-argument', 'Escribe quién aprobó el plazo especial.');
  }
  const summary = summarizePlan(plan);
  if (summary.issues.length) {
    throw new HttpsError('invalid-argument', `El plan no cuadra: ${summary.issues.join(' ')}`);
  }
  // Todas las cuotas deben caber en el plazo escogido (desde la primera ordinaria).
  const outOfTerm = termIssue(summary.installments, plan.termMonths);
  if (outOfTerm) throw new HttpsError('invalid-argument', `${outOfTerm} Corrige las fechas.`);

  const status = draftStatusFor({ ...deal, plan });
  const now = Timestamp.now();
  const actor = await userDisplayName(data.companyId, ctx.uid);
  const batch = db.batch();
  batch.update(ref, {
    plan,
    planTotals: {
      totalLand: summary.totalLand,
      separation: summary.separationTotal,
      ordinary: summary.ordinaryTotal,
      extraordinary: summary.extraordinaryTotal,
      bonus: summary.bonusTotal,
      severance: summary.severanceTotal,
      installments: summary.installmentsTotal,
      earnestMoney: computeEarnestMoney(plan.landValue, getProjectLegalProfile(deal.lot.projectId)?.earnestPercent ?? 30),
    },
    status,
    updatedAt: now,
  });
  batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'plan_saved',
    title: deal.plan ? 'Plan de negocio actualizado' : 'Plan de negocio guardado',
    lines: [
      `Valor del terreno: ${formatMoney(plan.landValue)} · Plazo: ${plan.termMonths} meses`
        + (plan.specialTerm ? ` (especial${plan.specialTerm.approvedBy ? `, aprobado por ${plan.specialTerm.approvedBy}` : ''})` : ''),
      `Separación: ${formatMoney(summary.separationTotal)} · Ordinarias: ${formatMoney(summary.ordinaryTotal)} · Extraordinarias: ${formatMoney(summary.extraordinaryTotal)}`,
      `Beneficio: ${formatMoney(plan.benefit)} · Cesantías: ${formatMoney(summary.severanceTotal)}`,
      ...(plan.referredBy ? [`Referido por: ${plan.referredBy}`] : []),
      ...(plan.notes ? [`Observaciones: ${plan.notes}`] : []),
    ],
    createdAt: now,
  }));
  await batch.commit();

  logger.info('[DealPlan] Plan guardado', { companyId: data.companyId, dealId: deal.id, status });
  return { ok: true as const, status };
});
