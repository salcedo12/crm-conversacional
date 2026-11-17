import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, storage } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES, WRITE_ROLES, type AuthContext } from '../lib/authContext';
import { clientsCol, loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { getProjectLegalProfile, SELLERS } from '../modules/deals/legalProfiles';
import { bogotaNow, buildContractData, dataHash, type ContractData } from '../modules/contracts/contractData';
import { fechaCorta, fechaEnLetras, formatDMY } from '../modules/deals/civilDate';
import { formatoPesos, pesosEnLetras } from '../modules/deals/numeroALetras';
import { renderContract } from '../modules/contracts/contractRenderer';
import type { ClientProfile, Deal, DealDocument, DealDocumentKind } from '../modules/deals/deals.types';
import { dealActivityDoc, dealActivityRef } from '../modules/deals/dealAudit';
import { lotSnapshot } from '../modules/deals/dealDocumentLot';
import { isPendingSignature, signatureDealStatus } from '../modules/deals/dealSignature.logic';
import { draftStatusFor } from '../modules/deals/dealStatus';

/**
 * Módulo Negocios — Fase 4: genera la preventa y la promesa en Word desde las plantillas.
 * - Preventa: con los datos actuales del negocio (debe estar en "plan_listo").
 * - Promesa: con los MISMOS datos guardados de la última preventa (solo cambia la fecha),
 *   para que precio y forma de pago no puedan diferir (cláusula cuarta de la preventa).
 * El Word y sus datos (JSON) quedan en Storage; la descarga va por callable.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const GenerateSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  kind:      z.enum(['preventa', 'promesa']),
});

function basePath(companyId: string, dealId: string) {
  return `companies/${companyId}/deals/${dealId}`;
}

async function buyersOf(companyId: string, deal: Deal): Promise<ClientProfile[]> {
  const refs = [...deal.buyers].sort((a, b) => a.order - b.order).map((b) => clientsCol(companyId).doc(b.clientId));
  const snaps = refs.length ? await clientsCol(companyId).firestore.getAll(...refs) : [];
  return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() } as ClientProfile));
}

const pesos = (n: number) => formatoPesos(n).replace('$ ', '$\u00a0');

function extractNumber(val: unknown): number {
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9]/g, '');
  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

/** Cambia solo las fechas de emisión de unos datos ya guardados y asegura campos calculados de la promesa. */
export function withIssueDate(data: ContractData, issuedAt: { date: string; time: string }): ContractData {
  const f = fechaEnLetras(issuedAt.date);
  const updated: ContractData = {
    ...data,
    'fecha.corta': fechaCorta(issuedAt.date),
    'fecha.texto': f.texto,
    'fecha.dia': f.dia,
    'fecha.mesNombre': f.mesNombre,
    'fecha.anio': f.anio,
    'fecha.diligenciamiento': `${formatDMY(issuedAt.date)} ${issuedAt.time}`,
  };
  // Hidratar bono si viene de plan.beneficio o plan.bono (para promesas generadas desde preventas viejas)
  const bonoNum = extractNumber(updated['plan.bono']) || extractNumber(updated['plan.beneficio']);
  if (bonoNum > 0) {
    updated['plan.tieneBono'] = true;
    updated['plan.bono'] = pesos(bonoNum);
    updated['plan.bonoLetras'] = pesosEnLetras(bonoNum);
  } else {
    updated['plan.tieneBono'] = false;
    updated['plan.bono'] = '$ 0';
    updated['plan.bonoLetras'] = '';
  }
  return updated;
}

export function fileName(deal: Deal, kind: DealDocumentKind, version: number): string {
  const lot = deal.lot ? `${deal.lot.sector} ${deal.lot.lotNumber}` : deal.id;
  const label = kind === 'preventa' ? 'CONTRATO DE PREVENTA' : 'PROMESA DE COMPRAVENTA';
  return `${label} - ${lot} - v${version}.docx`.replace(/[\\/:*?"<>|]/g, '');
}

/**
 * Genera una nueva versión del Word (preventa o promesa) y la agrega al negocio.
 * La usan el botón "Generar" y "Enviar a firma" (si falta la promesa).
 */
export async function generateDocument(
  ctx: AuthContext,
  ref: DocumentReference,
  deal: Deal,
  data: { companyId: string; kind: DealDocumentKind },
): Promise<DealDocument> {
  if (!deal.lot || !deal.plan) throw new HttpsError('failed-precondition', 'El negocio no tiene lote y plan.');
  const profile = getProjectLegalProfile(deal.lot.projectId);
  if (!profile) throw new HttpsError('failed-precondition', `No hay ficha legal para el proyecto ${deal.lot.projectId}.`);
  if (profile.missingTexts.length) {
    throw new HttpsError('failed-precondition', `Faltan textos legales de ${profile.contractName}: ${profile.missingTexts.join(', ')}.`);
  }

  const documents = deal.documents ?? [];
  const issuedAt = bogotaNow();
  const bucket = storage.bucket();
  let contractData: ContractData;

  if (data.kind === 'preventa') {
    if (deal.status !== 'plan_listo') {
      throw new HttpsError('failed-precondition', 'Para generar la preventa el negocio debe estar en "Plan listo".');
    }
    contractData = buildContractData({
      buyers: await buyersOf(data.companyId, deal),
      lot: deal.lot,
      plan: deal.plan,
      profile,
      seller: SELLERS[profile.seller],
      advisorName: (await userDisplayName(data.companyId, deal.advisorId)).name,
      issuedAt,
    });
  } else {
    const preventa = [...documents].reverse().find((d) => d.kind === 'preventa');
    if (!preventa) throw new HttpsError('failed-precondition', 'Primero genera la preventa: la promesa sale de sus mismos datos.');
    const [json] = await bucket.file(preventa.dataStoragePath).download();
    contractData = withIssueDate(JSON.parse(json.toString('utf8')) as ContractData, issuedAt);
  }

  let docx: Buffer;
  try {
    docx = renderContract(data.kind, contractData, profile.templateVariant);
  } catch (err) {
    logger.error('[DealDocuments] Error llenando la plantilla', { dealId: deal.id, kind: data.kind, error: String(err) });
    throw new HttpsError('internal', `No se pudo generar el documento: ${err instanceof Error ? err.message : String(err)}`);
  }

  const version = documents.filter((d) => d.kind === data.kind).length + 1;
  const docxStoragePath = `${basePath(data.companyId, deal.id)}/${data.kind}-v${version}.docx`;
  const dataStoragePath = `${basePath(data.companyId, deal.id)}/${data.kind}-v${version}.json`;
  const pdfStoragePath = docxStoragePath.replace(/\.docx$/, '.pdf');

  // Elimina cualquier PDF previo de esta versión en Storage para evitar servir archivos obsoletos en caché
  await bucket.file(pdfStoragePath).delete({ ignoreNotFound: true }).catch(() => {});

  await Promise.all([
    bucket.file(docxStoragePath).save(docx, { contentType: DOCX_MIME, resumable: false }),
    bucket.file(dataStoragePath).save(JSON.stringify(contractData), { contentType: 'application/json', resumable: false }),
  ]);

  const doc: DealDocument = {
    kind: data.kind,
    version,
    snapshotHash: dataHash(contractData),
    docxStoragePath,
    dataStoragePath,
    generatedAt: Timestamp.now(),
    generatedBy: ctx.uid,
    signatureStatus: 'generado',
    lot: lotSnapshot(deal.lot),
  };
  const now = doc.generatedAt;
  const actor = await userDisplayName(data.companyId, ctx.uid);
  const batch = db.batch();
  batch.update(ref, { documents: [...documents, doc], updatedAt: now });
  batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'document_generated',
    title: data.kind === 'preventa' ? 'Contrato de preventa generado' : 'Promesa de compraventa generada',
    lines: [`Versión ${version} · Archivo Word guardado en el negocio`],
    createdAt: now,
  }));
  await batch.commit();

  logger.info('[DealDocuments] Documento generado', { dealId: deal.id, kind: data.kind, version });
  deal.documents = [...documents, doc];
  return doc;
}

export const generateDealDocument = onCall({ region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(GenerateSchema, request.data, 'generar el documento');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const doc = await generateDocument(ctx, ref, deal, data);
  return { kind: doc.kind, version: doc.version, fileName: fileName(deal, doc.kind, doc.version), snapshotHash: doc.snapshotHash };
});

const DownloadSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  kind:      z.enum(['preventa', 'promesa']),
  version:   z.number().int().min(1),
  /** 'signed': el PDF firmado que devolvió DocuBlock. */
  format:    z.enum(['docx', 'pdf', 'signed']).default('docx'),
});

/**
 * Word → PDF en nuestro VPS (Gotenberg/LibreOffice detrás de nginx, con llave), para verlo
 * en el CRM tal como se imprime. El PDF queda en Storage junto al Word y se reutiliza.
 */
const PDF_CONVERTER_URL = process.env.DOCX_PDF_URL || 'https://app.grupoconstructormeraki.com.co/docx-pdf/';

async function convertToPdf(docx: Buffer, name: string): Promise<Buffer> {
  const key = process.env.DOCX_PDF_KEY;
  if (!key) throw new HttpsError('failed-precondition', 'La conversión a PDF no está configurada.');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(docx)], { type: DOCX_MIME }), name);
  const res = await fetch(PDF_CONVERTER_URL, { method: 'POST', headers: { 'X-Pdf-Key': key }, body: form, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    logger.error('[DealDocuments] Falló la conversión a PDF', { status: res.status, body: (await res.text()).slice(0, 300) });
    throw new HttpsError('unavailable', 'No se pudo convertir el documento a PDF. Descárgalo en Word.');
  }
  return Buffer.from(await res.arrayBuffer());
}

/** PDF del documento (se convierte la primera vez y queda en Storage junto al Word). */
export async function documentPdf(deal: Deal, doc: DealDocument): Promise<Buffer> {
  const bucket = storage.bucket();
  const docxFile = bucket.file(doc.docxStoragePath);
  const pdfFile = bucket.file(doc.docxStoragePath.replace(/\.docx$/, '.pdf'));
  const [cached] = await pdfFile.exists();
  if (cached) {
    try {
      const [[pdfMeta], [docxMeta]] = await Promise.all([pdfFile.getMetadata(), docxFile.getMetadata()]);
      const pdfTime = new Date(String(pdfMeta.updated || pdfMeta.timeCreated || 0)).getTime();
      const docxTime = new Date(String(docxMeta.updated || docxMeta.timeCreated || 0)).getTime();
      if (pdfTime >= docxTime) {
        return (await pdfFile.download())[0];
      }
      logger.info('[DealDocuments] PDF en caché obsoleto respecto al docx; regenerando PDF...', {
        dealId: deal.id,
        version: doc.version,
        pdfTime,
        docxTime,
      });
    } catch (err) {
      logger.warn('[DealDocuments] Error verificando frescura del PDF cacheado', { error: String(err) });
    }
  }
  const [docx] = await docxFile.download();
  const pdf = await convertToPdf(docx, fileName(deal, doc.kind, doc.version));
  await pdfFile.save(pdf, { contentType: 'application/pdf', resumable: false });
  return pdf;
}

/** Devuelve el Word generado (o su PDF) en base64 (los archivos no son públicos en Storage). */
export const downloadDealDocument = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', secrets: ['DOCX_PDF_KEY'] }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(DownloadSchema, request.data, 'descargar el documento');
  assertCompany(ctx, data.companyId);

  const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const doc = (deal.documents ?? []).find((d) => d.kind === data.kind && d.version === data.version);
  if (!doc) throw new HttpsError('not-found', 'Documento no encontrado.');
  // Los asesores solo ven el contrato en pantalla (PDF); descargar el Word es de administradores.
  if (data.format === 'docx' && !ctx.platformAdmin && !ADMIN_ROLES.includes(ctx.role)) {
    throw new HttpsError('permission-denied', 'Solo un administrador puede descargar el contrato.');
  }
  const bucket = storage.bucket();
  const name = fileName(deal, doc.kind, doc.version);

  if (data.format === 'signed') {
    if (!doc.signedPdfStoragePath) throw new HttpsError('failed-precondition', 'El documento todavía no está firmado.');
    const [signed] = await bucket.file(doc.signedPdfStoragePath).download();
    return { fileName: name.replace(/\.docx$/, ' - FIRMADO.pdf'), mimeType: 'application/pdf', base64: signed.toString('base64') };
  }

  if (data.format === 'pdf') {
    const pdf = await documentPdf(deal, doc);
    return { fileName: name.replace(/\.docx$/, '.pdf'), mimeType: 'application/pdf', base64: pdf.toString('base64') };
  }

  const [buffer] = await bucket.file(doc.docxStoragePath).download();
  return { fileName: name, mimeType: DOCX_MIME, base64: buffer.toString('base64') };
});

const DeleteDocumentSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  kind:      z.enum(['preventa', 'promesa']),
  version:   z.number().int().min(1),
});

/**
 * Permite a un administrador eliminar una versión de preventa o promesa de un negocio.
 * Borra los archivos asociados en Storage (Word, JSON, PDF) y actualiza el array de documentos.
 */
export const deleteDealDocument = onCall({ region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(DeleteDocumentSchema, request.data, 'eliminar el documento');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const documents = deal.documents ?? [];
  const target = documents.find((d) => d.kind === data.kind && d.version === data.version);
  if (!target) throw new HttpsError('not-found', 'Documento no encontrado.');

  if (target.signatureStatus === 'firmado') {
    throw new HttpsError('failed-precondition', 'No se puede eliminar un documento que ya fue firmado legalmente.');
  }
  if (isPendingSignature(target.signatureStatus)) {
    throw new HttpsError('failed-precondition', 'Este documento está en firma; marca su firma como anulada antes de eliminarlo.');
  }

  // Borrar archivos asociados en Storage
  const bucket = storage.bucket();
  const pathsToDelete = [
    target.docxStoragePath,
    target.dataStoragePath,
    target.pdfStoragePath,
    target.signedPdfStoragePath,
    target.docxStoragePath ? target.docxStoragePath.replace(/\.docx$/, '.pdf') : null,
  ].filter((p): p is string => Boolean(p));

  await Promise.all(
    pathsToDelete.map(async (filePath) => {
      try {
        const file = bucket.file(filePath);
        const [exists] = await file.exists();
        if (exists) await file.delete();
      } catch (err) {
        logger.warn('[DealDocuments] Error eliminando archivo de Storage', { filePath, error: String(err) });
      }
    }),
  );

  const remaining = documents.filter((d) => !(d.kind === data.kind && d.version === data.version));
  const pending = remaining.some((d) => d.docublockDocumentId && isPendingSignature(d.signatureStatus));
  const hasSignedOrPending = remaining.some((d) => d.docublockDocumentId && (isPendingSignature(d.signatureStatus) || d.signatureStatus === 'firmado'));
  const nextStatus = deal.status === 'anulado'
    ? 'anulado'
    : hasSignedOrPending
      ? signatureDealStatus({ ...deal, documents: remaining })
      : draftStatusFor({ ...deal, status: 'borrador' });
  const now = Timestamp.now();
  const actor = await userDisplayName(data.companyId, ctx.uid);

  const batch = db.batch();
  batch.update(ref, { documents: remaining, status: nextStatus, signaturePending: pending, updatedAt: now });
  batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'document_deleted',
    title: data.kind === 'preventa' ? 'Contrato de preventa eliminado' : 'Promesa de compraventa eliminada',
    lines: [`Versión ${data.version} eliminada por el administrador`],
    createdAt: now,
  }));
  await batch.commit();

  logger.info('[DealDocuments] Documento eliminado', { dealId: deal.id, kind: data.kind, version: data.version });
  return { ok: true, remainingCount: remaining.length };
});
