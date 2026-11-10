import type { Deal, DealStatus } from './deals.types';
import { summarizePlan } from './paymentPlan';

/** Estados en los que todavía se pueden cambiar compradores, lote y plan (antes de generar documentos). */
export const EDITABLE_STATUSES: DealStatus[] = ['borrador', 'plan_listo'];

/**
 * Estado de un negocio mientras se arma: "plan_listo" cuando tiene compradores, lote
 * apartado y un plan válido hecho para ese mismo lote; si no, "borrador". Los estados
 * de firma en adelante no se tocan.
 */
export function draftStatusFor(deal: Pick<Deal, 'status' | 'buyers' | 'lot' | 'plan'>): DealStatus {
  if (!EDITABLE_STATUSES.includes(deal.status)) return deal.status;
  const ready =
    deal.buyers.length > 0 &&
    !!deal.lot &&
    !!deal.plan &&
    deal.plan.lotId === deal.lot.inventoryLotId &&
    summarizePlan(deal.plan).issues.length === 0;
  return ready ? 'plan_listo' : 'borrador';
}
