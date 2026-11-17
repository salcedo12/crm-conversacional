import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';
import { draftStatusFor, EDITABLE_STATUSES, loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { inventoryDb } from '../modules/inventory/inventory.client';
import { availableLotsFromSummary, INVENTORY_PROJECT_NAMES, normalizeStatus, type SummaryEntry } from '../modules/inventory/inventory.logic';
import { getLotStatus, releaseLot, reserveLot } from '../modules/inventory/lotReservation.service';
import { dealActivityDoc, dealActivityRef } from '../modules/deals/dealAudit';
import { lotLabel, supersedeForLotChange } from '../modules/deals/dealDocumentLot';

/**
 * Módulo Negocios — Fase 2: lote del negocio desde el inventario de disponibilidad.
 * Lectura desde proyectos_resumen (1 lectura por proyecto) y reserva en transacción.
 */

type Summary = { lots?: Record<string, Partial<SummaryEntry>> };

const CompanySchema = z.object({ companyId: z.string().min(1) });

/** Proyectos del inventario con cuántos lotes hay disponibles por sector. */
export const listInventoryProjects = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(CompanySchema, request.data, 'listar proyectos');
  assertCompany(ctx, data.companyId);

  const snap = await inventoryDb().collection('proyectos_resumen').get();
  const projects = snap.docs.map((doc) => {
    const available = availableLotsFromSummary((doc.data() as Summary).lots);
    const sectors: Record<string, number> = {};
    for (const lot of available) sectors[lot.sector] = (sectors[lot.sector] ?? 0) + 1;
    return {
      id: doc.id,
      name: INVENTORY_PROJECT_NAMES[doc.id] ?? doc.id,
      available: available.length,
      sectors: Object.entries(sectors)
        .map(([name, count]) => ({ name, available: count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return { projects };
});

const ListLotsSchema = z.object({ companyId: z.string().min(1), projectId: z.string().min(1) });

/** Lotes DISPONIBLES de un proyecto (el selector los vuelve a pedir cada pocos segundos). */
export const listAvailableLots = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(ListLotsSchema, request.data, 'listar lotes');
  assertCompany(ctx, data.companyId);

  const snap = await inventoryDb().collection('proyectos_resumen').doc(data.projectId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Proyecto no encontrado en el inventario.');
  const summary = snap.data() as Summary & { lastUpdated?: string };
  return { lots: availableLotsFromSummary(summary.lots), updatedAt: summary.lastUpdated ?? null };
});

const ReserveSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  lotId:     z.string().min(1),
});

/** Aparta el lote para el negocio (NEGOCIACION 24 h). Si el negocio tenía otro lote, lo libera. */
export const reserveDealLot = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(ReserveSchema, request.data, 'reservar el lote');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!EDITABLE_STATUSES.includes(deal.status)) {
    throw new HttpsError('failed-precondition', 'Este negocio ya tiene documentos; el lote no se puede cambiar.');
  }

  const actor = await userDisplayName(data.companyId, ctx.uid);
  const advisor = deal.advisorId === ctx.uid ? actor : await userDisplayName(data.companyId, deal.advisorId);
  const dealLot = await reserveLot(
    data.lotId,
    { dealId: deal.id, companyId: data.companyId, advisorName: advisor.name },
    actor,
  );

  const previous = deal.lot?.inventoryLotId;
  try {
    const now = Timestamp.now();
    // Preventa/promesa de otro lote: quedan vencidas (historial), no sirven para este lote.
    const { documents, superseded } = supersedeForLotChange(deal.documents ?? [], deal.lot, dealLot, now);
    const batch = db.batch();
    batch.update(ref, { lot: dealLot, documents, status: draftStatusFor({ ...deal, lot: dealLot }), updatedAt: now });
    batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
      companyId: data.companyId,
      leadId: deal.leadId,
      dealId: deal.id,
      actorId: ctx.uid,
      actorName: actor.name,
      event: 'lot_reserved',
      title: previous && previous !== data.lotId ? 'Lote del negocio cambiado' : 'Lote apartado',
      lines: [
        `${dealLot.projectId} · ${dealLot.sector} · Lote ${dealLot.lotNumber} · ${dealLot.areaM2} m²${dealLot.corner ? ' · Esquinero' : ''}`,
        ...(dealLot.reservedUntil ? [`Reserva vigente hasta ${dealLot.reservedUntil}`] : []),
        ...superseded.map((d) => `${d.kind === 'preventa' ? 'Preventa' : 'Promesa'} v${d.version} (${d.lot ? lotLabel(d.lot) : 'lote anterior'}) queda vencida`),
      ],
      createdAt: now,
    }));
    await batch.commit();
  } catch (err) {
    // El negocio no quedó con el lote: devolverlo al inventario para no dejarlo bloqueado.
    await releaseLot(data.lotId, deal.id, actor).catch(() => {});
    throw err;
  }
  if (previous && previous !== data.lotId) {
    await releaseLot(previous, deal.id, actor).catch((err) =>
      logger.warn('[DealLots] No se pudo liberar el lote anterior', { dealId: deal.id, previous, error: String(err) }));
  }

  logger.info('[DealLots] Lote reservado', { companyId: data.companyId, dealId: deal.id, lotId: data.lotId });
  return { lot: dealLot };
});

const DealSchema = z.object({ companyId: z.string().min(1), dealId: z.string().min(1) });

/** Devuelve el lote del negocio al inventario. */
export const releaseDealLot = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(DealSchema, request.data, 'liberar el lote');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!EDITABLE_STATUSES.includes(deal.status)) {
    throw new HttpsError('failed-precondition', 'Este negocio ya tiene documentos; el lote no se puede liberar desde aquí.');
  }
  if (!deal.lot) return { ok: true as const };

  const actor = await userDisplayName(data.companyId, ctx.uid);
  await releaseLot(deal.lot.inventoryLotId, deal.id, actor);
  const now = Timestamp.now();
  const batch = db.batch();
  batch.update(ref, { lot: null, status: draftStatusFor({ ...deal, lot: null }), updatedAt: now });
  batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'lot_released',
    title: 'Lote liberado',
    lines: [`${deal.lot.projectId} · ${deal.lot.sector} · Lote ${deal.lot.lotNumber}`],
    createdAt: now,
  }));
  await batch.commit();
  return { ok: true as const };
});

/**
 * Estado actual del lote del negocio en el inventario: si la reserva sigue vigente,
 * venció (tour-meraki lo devolvió a DISPONIBLE) o alguien más lo tomó.
 */
export const getDealLotStatus = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(DealSchema, request.data, 'consultar el lote');
  assertCompany(ctx, data.companyId);

  const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!deal.lot) return { state: 'sin_lote' as const };
  const current = await getLotStatus(deal.lot.inventoryLotId);
  if (!current) return { state: 'no_existe' as const };
  const ours = current.dealId === deal.id && normalizeStatus(current.status) !== 'DISPONIBLE';
  return {
    state: ours ? ('reservado' as const) : current.status === 'DISPONIBLE' ? ('vencido' as const) : ('tomado' as const),
    status: current.status,
    expiresAt: current.expiresAt,
  };
});
