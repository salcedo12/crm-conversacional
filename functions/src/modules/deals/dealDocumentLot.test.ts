import { test, expect } from 'vitest';
import type { Timestamp } from 'firebase-admin/firestore';
import { isCurrentDocument, latestCurrentDocument, sameLot, supersedeForLotChange } from './dealDocumentLot.logic';
import type { DealDocument, DealLot } from './deals.types';

const now = { toMillis: () => 1 } as unknown as Timestamp;

const lot = (sector: string, lotNumber: string, inventoryLotId: string): DealLot => ({
  projectId: 'sobre-montañas', sector, lotNumber, lotCode: `${sector}-${lotNumber}`, inventoryLotId, areaM2: 1000, corner: false,
});

const doc = (kind: 'preventa' | 'promesa', version: number, extra: Partial<DealDocument> = {}): DealDocument => ({
  kind, version, snapshotHash: 'h', docxStoragePath: 'x.docx', dataStoragePath: 'x.json',
  generatedAt: now, generatedBy: 'u', signatureStatus: 'generado', ...extra,
});

const A = lot('AGUILA REAL', '3', 'inv-a');
const B = lot('AGUILA REAL', '6', 'inv-b');

test('sameLot: por id del inventario, por código o por sector + número', () => {
  expect(sameLot({ sector: 'X', lotNumber: '1', inventoryLotId: 'inv-a' }, A)).toBe(true);
  expect(sameLot({ sector: 'AGUILA REAL', lotNumber: '3', inventoryLotId: 'otro' }, A)).toBe(false);
  expect(sameLot({ sector: 'aguila real', lotNumber: '003' }, A)).toBe(true);
  expect(sameLot({ sector: 'AGUILA REAL', lotNumber: '6' }, A)).toBe(false);
  expect(sameLot({ sector: 'AGUILA REAL', lotNumber: '3' }, null)).toBe(false);
});

test('cambiar de lote vence los documentos del lote anterior (también los antiguos sin lote)', () => {
  const docs = [doc('preventa', 1), doc('promesa', 1)];
  const { documents, superseded } = supersedeForLotChange(docs, A, B, now);
  expect(superseded).toHaveLength(2);
  expect(documents.every((d) => d.superseded && d.lot?.inventoryLotId === 'inv-a')).toBe(true);
  expect(documents[0]!.superseded!.reason).toContain('Lote 3 → AGUILA REAL · Lote 6');
});

test('volver a apartar el mismo lote no vence nada', () => {
  const docs = [doc('preventa', 1, { lot: { sector: 'AGUILA REAL', lotNumber: '3', inventoryLotId: 'inv-a' } })];
  const { superseded } = supersedeForLotChange(docs, A, A, now);
  expect(superseded).toHaveLength(0);
});

test('la última preventa vigente ignora las de otro lote', () => {
  const deal = {
    lot: B,
    documents: [
      doc('preventa', 1, { lot: { sector: 'AGUILA REAL', lotNumber: '3', inventoryLotId: 'inv-a' }, superseded: { at: now, reason: 'cambio' } }),
    ],
  };
  expect(latestCurrentDocument(deal, 'preventa')).toBeUndefined();
  const v2 = doc('preventa', 2, { lot: { sector: 'AGUILA REAL', lotNumber: '6', inventoryLotId: 'inv-b' } });
  expect(latestCurrentDocument({ ...deal, documents: [...deal.documents, v2] }, 'preventa')?.version).toBe(2);
  expect(isCurrentDocument(v2, { lot: A })).toBe(false);
});
