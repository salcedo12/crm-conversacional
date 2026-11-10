import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES, WRITE_ROLES } from '../lib/authContext';
import { loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { listPlaces, resendEndorsement } from '../integrations/docublock/docublock.client';
import {
  markSignatureCancelled,
  refreshSignatures,
  sendToSignature,
  signatureOptions,
} from '../modules/deals/dealSignature.service';
import { documentPdf, fileName, generateDocument } from './dealDocuments.function';
import { signatureDocOf } from '../modules/deals/dealSignature.logic';

/**
 * Módulo Negocios — Fase 5: firma con DocuBlock. Enviar a firma, reenviar la invitación
 * y marcar anulado lo hacen administradores y gerentes (los asesores solo ven el estado).
 */

const OPTS = { region: 'us-central1', timeoutSeconds: 180, memory: '512MiB' as const, secrets: ['DOCUBLOCK_API_KEY', 'DOCX_PDF_KEY'] };

const CompanySchema = z.object({ companyId: z.string().min(1) });

export const getDealSignatureOptions = onCall(OPTS, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(CompanySchema, request.data, 'cargar las opciones de firma');
  assertCompany(ctx, data.companyId);
  return signatureOptions();
});

/**
 * Países y sus ciudades tal como los escribe DocuBlock (con tildes), para las listas de la
 * ficha del comprador: así la firma no falla (SmartHome fallaba con "Ibague" vs "Ibagué").
 */
export const getDocuBlockCities = onCall({ ...OPTS, timeoutSeconds: 60 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(CompanySchema, request.data, 'cargar las ciudades');
  assertCompany(ctx, data.companyId);
  const { cities, countries } = await listPlaces();
  const byCountry = new Map<string, Set<string>>();
  for (const city of cities) {
    const id = typeof city.country === 'string' ? city.country : city.country?._id ?? '';
    const name = city.name.trim();
    if (!id || !name) continue;
    if (!byCountry.has(id)) byCountry.set(id, new Set());
    byCountry.get(id)!.add(name);
  }
  const list = countries
    .map((c) => ({ name: c.name.trim(), cities: [...(byCountry.get(c._id) ?? [])].sort((a, b) => a.localeCompare(b, 'es')) }))
    .filter((c) => c.name && c.cities.length)
    .sort((a, b) => (a.name === 'Colombia' ? -1 : b.name === 'Colombia' ? 1 : a.name.localeCompare(b.name, 'es')));
  return { countries: list };
});

const SendSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  documents: z.array(z.object({
    kind:        z.enum(['preventa', 'promesa']),
    version:     z.number().int().min(1).nullish(),
    templateId:  z.string().min(1),
    directoryId: z.string().min(1),
  })).min(1).max(2),
  signers: z.array(z.object({
    source:    z.enum(['buyer', 'docublock_user']),
    refId:     z.string().min(1),
    typeSigns: z.object({ preventa: z.string().min(1).optional(), promesa: z.string().min(1).optional() }),
    iteration: z.number().int().min(1).max(10),
  })).min(1).max(20),
  responsibleId: z.string().nullish(),
  requirePhoto:  z.boolean().default(false),
});

export const sendDealToSignature = onCall(OPTS, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(SendSchema, request.data, 'enviar a firma');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const actor = await userDisplayName(data.companyId, ctx.uid);
  return sendToSignature({
    ref,
    deal,
    input: data,
    actor: { uid: ctx.uid, ...actor },
    ensureDocument: (kind) => generateDocument(ctx, ref, deal, { companyId: data.companyId, kind }),
    pdfOf: (doc) => documentPdf(deal, doc),
    fileNameOf: (doc) => fileName(deal, doc.kind, doc.version),
  });
});

const DealSchema = z.object({ companyId: z.string().min(1), dealId: z.string().min(1) });

/** "Actualizar estado" desde el negocio (además de la consulta automática cada 10 min). */
export const refreshDealSignature = onCall(OPTS, async (request) => {
  const ctx = requireAuth(request);
  const data = parseInput(DealSchema, request.data, 'actualizar la firma');
  assertCompany(ctx, data.companyId);
  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  await refreshSignatures(ref, deal);
  return { status: deal.status };
});

const ResendSchema = DealSchema.extend({ kind: z.enum(['preventa', 'promesa']), signerId: z.string().min(1) });

export const resendDealSignature = onCall(OPTS, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(ResendSchema, request.data, 'reenviar la invitación');
  assertCompany(ctx, data.companyId);
  const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const doc = signatureDocOf(deal, data.kind);
  if (!doc?.docublockDocumentId) throw new HttpsError('failed-precondition', 'Ese documento no se ha enviado a firma.');
  await resendEndorsement(doc.docublockDocumentId, data.signerId);
  return { ok: true };
});

const CancelSchema = DealSchema.extend({ kind: z.enum(['preventa', 'promesa']), reason: z.string().min(3).max(300) });

/** La firma se anula en el panel de DocuBlock; aquí se marca para dejar de consultarla. */
export const markDealSignatureCancelled = onCall(OPTS, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(CancelSchema, request.data, 'marcar la firma como anulada');
  assertCompany(ctx, data.companyId);
  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const actor = await userDisplayName(data.companyId, ctx.uid);
  await markSignatureCancelled(ref, deal, data.kind, { uid: ctx.uid, name: actor.name }, data.reason);
  return { status: deal.status };
});
