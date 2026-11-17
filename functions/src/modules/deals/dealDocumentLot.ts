import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { storage } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { leadRef } from './dealAudit';
import type { Deal, DealAttachment, DealDocument, DocumentLot } from './deals.types';

/**
 * Lote de cada documento y soporte del negocio.
 *
 * Cuando el cliente cambia de lote, la preventa/promesa ya generadas siguen siendo del lote
 * anterior (su Word y sus datos lo dicen así). Por eso cada documento guarda su lote y, al
 * cambiar a otro, los anteriores quedan VENCIDOS: se ven como historial, pero no se usan
 * para generar la promesa ni para enviar a firma.
 */

export { isCurrentDocument, latestCurrentDocument, lotLabel, lotSnapshot, sameLot, supersedeForLotChange } from './dealDocumentLot.logic';
import { lotLabel, sameLot } from './dealDocumentLot.logic';

/** Lote leído de los datos (JSON) con que se generó un documento. */
async function lotFromContractData(doc: DealDocument): Promise<DocumentLot | null> {
  try {
    const [json] = await storage.bucket().file(doc.dataStoragePath).download();
    const data = JSON.parse(json.toString('utf8')) as Record<string, unknown>;
    const sector = String(data['lote.sector'] ?? '').trim();
    const lotNumber = String(data['lote.numero'] ?? '').trim();
    if (!sector || !lotNumber) return null;
    const lotCode = String(data['lote.codigo'] ?? '').trim();
    return { sector, lotNumber, ...(lotCode ? { lotCode } : {}) };
  } catch (err) {
    logger.warn('[DealDocumentLot] No se pudieron leer los datos del documento', { path: doc.dataStoragePath, error: String(err) });
    return null;
  }
}

/** "rio-claro · RIO LAGUNILLA · Lote 2 · 350 m²" (línea de la bitácora al apartar un lote). */
function lotFromActivityLine(line: string): DocumentLot | null {
  const match = /^•?\s*([^·]+?)\s·\s(.+?)\s·\sLote\s([^·]+?)(?:\s·|$)/.exec(line.trim());
  if (!match) return null;
  return { projectId: match[1]!.trim(), sector: match[2]!.trim(), lotNumber: match[3]!.trim() };
}

/** Historial de lotes del negocio según la bitácora del lead (cuándo se apartó cada uno). */
async function lotHistory(companyId: string, deal: Deal): Promise<Array<{ at: number; lot: DocumentLot }>> {
  const snap = await leadRef(companyId, deal.leadId).collection('notes')
    .where('dealId', '==', deal.id)
    .where('dealEvent', '==', 'lot_reserved')
    .get();
  return snap.docs
    .map((d) => {
      const text = String(d.get('text') ?? '');
      const lot = text.split('\n').slice(1).map(lotFromActivityLine).find(Boolean) ?? null;
      const at = (d.get('createdAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
      return lot ? { at, lot } : null;
    })
    .filter((x): x is { at: number; lot: DocumentLot } => !!x)
    .sort((a, b) => a.at - b.at);
}

/**
 * Una sola vez por negocio: completa el lote de los documentos y soportes creados antes de
 * que se guardara, y deja vencidos los documentos de un lote que ya no es el del negocio.
 * Devuelve el negocio actualizado (o el mismo si no había nada que completar).
 */
export async function backfillDealLots(companyId: string, ref: DocumentReference, deal: Deal): Promise<Deal> {
  if (deal.lotsBackfilled) return deal;
  const documents = deal.documents ?? [];
  const attachments = deal.attachments ?? [];
  const pendingDocs = documents.some((d) => !d.lot);
  const pendingAttachments = attachments.some((a) => !a.lot);
  if (!pendingDocs && !pendingAttachments) return deal;

  try {
    const now = Timestamp.now();
    const nextDocuments: DealDocument[] = await Promise.all(documents.map(async (doc) => {
      if (doc.lot) return doc;
      const lot = await lotFromContractData(doc);
      if (!lot) return doc;
      const stale = !!deal.lot && !sameLot(lot, deal.lot);
      return {
        ...doc,
        lot,
        ...(stale && !doc.superseded ? { superseded: { at: now, reason: `Cambio de lote: ${lotLabel(lot)} → ${lotLabel(deal.lot!)}` } } : {}),
      };
    }));

    let nextAttachments: DealAttachment[] = attachments;
    if (pendingAttachments) {
      const history = await lotHistory(companyId, deal);
      nextAttachments = attachments.map((a) => {
        if (a.lot) return a;
        const at = a.uploadedAt?.toMillis?.() ?? 0;
        const lot = [...history].reverse().find((h) => h.at <= at)?.lot;
        return lot ? { ...a, lot } : a;
      });
    }

    await ref.update({ documents: nextDocuments, attachments: nextAttachments, lotsBackfilled: true });
    return { ...deal, documents: nextDocuments, attachments: nextAttachments, lotsBackfilled: true };
  } catch (err) {
    logger.warn('[DealDocumentLot] No se pudo completar el lote de documentos/soportes', { dealId: deal.id, error: String(err) });
    return deal;
  }
}
