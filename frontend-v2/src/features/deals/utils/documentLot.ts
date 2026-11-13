import type { DealAttachment, DealDocumentInfo, DealDocumentKind, DealLot, DealSummary, DocumentLot } from '../services/deals.service';

/**
 * Lote de cada documento/soporte (mismas reglas que el backend, functions/.../dealDocumentLot.logic.ts):
 * al cambiar de lote, la preventa y la promesa anteriores quedan vencidas y solo sirven de historial.
 */

const norm = (value: string | undefined) => String(value ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

export function sameLot(a: DocumentLot | null | undefined, b: DocumentLot | DealLot | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.inventoryLotId && b.inventoryLotId) return a.inventoryLotId === b.inventoryLotId;
  if (a.lotCode && b.lotCode) return norm(a.lotCode) === norm(b.lotCode);
  if (a.projectId && b.projectId && a.projectId !== b.projectId) return false;
  return norm(a.sector) === norm(b.sector) && norm(a.lotNumber) === norm(b.lotNumber);
}

/** Vigente: no vencido y del lote actual (los antiguos sin lote se asumen del actual). */
export function isCurrentDocument(doc: DealDocumentInfo, deal: Pick<DealSummary, 'lot'>): boolean {
  if (doc.superseded) return false;
  if (!doc.lot) return true;
  return sameLot(doc.lot, deal.lot);
}

export function latestCurrentDocument(deal: Pick<DealSummary, 'documents' | 'lot'>, kind: DealDocumentKind): DealDocumentInfo | undefined {
  return [...(deal.documents ?? [])].reverse().find((d) => d.kind === kind && isCurrentDocument(d, deal));
}

/** Soporte subido cuando el negocio tenía OTRO lote (los antiguos sin lote se asumen del actual). */
export function isAttachmentFromOtherLot(attachment: DealAttachment, deal: Pick<DealSummary, 'lot'>): boolean {
  return !!attachment.lot && !!deal.lot && !sameLot(attachment.lot, deal.lot);
}

export const lotLabel = (lot: DocumentLot | DealLot) => `${lot.sector} · Lote ${lot.lotNumber}`;
