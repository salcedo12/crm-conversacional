import type { Timestamp } from 'firebase-admin/firestore';
import type { Deal, DealDocument, DealDocumentKind, DealLot, DocumentLot } from './deals.types';

/**
 * Reglas puras del lote de cada documento (sin Firebase, para probarlas):
 * mismo lote, documento vigente y vencimiento al cambiar de lote.
 */

/** Foto del lote para guardarla en un documento o soporte. */
export function lotSnapshot(lot: DealLot): DocumentLot {
  return {
    projectId: lot.projectId,
    sector: lot.sector,
    lotNumber: lot.lotNumber,
    ...(lot.lotCode ? { lotCode: lot.lotCode } : {}),
    inventoryLotId: lot.inventoryLotId,
  };
}

const norm = (value: string | undefined) => String(value ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');

/** ¿Es el mismo lote? Usa el id del inventario si ambos lo tienen; si no, código o sector + número. */
export function sameLot(a: DocumentLot | null | undefined, b: DocumentLot | DealLot | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.inventoryLotId && b.inventoryLotId) return a.inventoryLotId === b.inventoryLotId;
  if (a.lotCode && b.lotCode) return norm(a.lotCode) === norm(b.lotCode);
  if (a.projectId && b.projectId && a.projectId !== b.projectId) return false;
  return norm(a.sector) === norm(b.sector) && norm(a.lotNumber) === norm(b.lotNumber);
}

/** Documento vigente: no está vencido y es del lote actual (los antiguos sin lote se asumen del actual). */
export function isCurrentDocument(doc: DealDocument, deal: Pick<Deal, 'lot'>): boolean {
  if (doc.superseded) return false;
  if (!doc.lot) return true;
  return sameLot(doc.lot, deal.lot);
}

/** Última versión VIGENTE de un tipo de documento. */
export function latestCurrentDocument(deal: Pick<Deal, 'documents' | 'lot'>, kind: DealDocumentKind): DealDocument | undefined {
  return [...(deal.documents ?? [])].reverse().find((d) => d.kind === kind && isCurrentDocument(d, deal));
}

export const lotLabel = (lot: DocumentLot | DealLot) => `${lot.sector} · Lote ${lot.lotNumber}`;

/**
 * Al cambiar de lote: los documentos que no son del lote nuevo quedan vencidos. Los antiguos
 * sin lote se generaron con el lote anterior, así que se les pone ese.
 */
export function supersedeForLotChange(
  documents: DealDocument[],
  previous: DealLot | null,
  next: DealLot,
  now: Timestamp,
): { documents: DealDocument[]; superseded: DealDocument[] } {
  const superseded: DealDocument[] = [];
  const updated = documents.map((doc) => {
    const lot = doc.lot ?? (previous ? lotSnapshot(previous) : undefined);
    if (doc.superseded || !lot || sameLot(lot, next)) return lot && !doc.lot ? { ...doc, lot } : doc;
    const out: DealDocument = { ...doc, lot, superseded: { at: now, reason: `Cambio de lote: ${lotLabel(lot)} → ${lotLabel(next)}` } };
    superseded.push(out);
    return out;
  });
  return { documents: updated, superseded };
}
