import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, storage } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';
import { leadsRepository } from '../modules/leads/leads.repository';
import { ClientInputSchema, clientDocId, normalizeIdentification, MAX_BUYERS } from '../modules/deals/clientProfile';
import type { ClientProfile, Deal, DealAttachment, DealAttachmentCategory } from '../modules/deals/deals.types';
import { clientsCol, dealsCol, draftStatusFor, EDITABLE_STATUSES, isAdmin, loadDeal, parseInput, userDisplayName } from '../modules/deals/dealAccess';
import { dealActivityDoc, dealActivityRef, leadRef } from '../modules/deals/dealAudit';
import { backfillDealLots, lotSnapshot } from '../modules/deals/dealDocumentLot';
import { isPendingSignature } from '../modules/deals/dealSignature.logic';
import { releaseLot } from '../modules/inventory/lotReservation.service';

/**
 * Módulo Negocios — Fase 1: ficha de compradores y negocio desde el lead.
 * Todo pasa por callables (las fichas tienen cédulas; las reglas no exponen `clients`).
 * Plan completo en PLAN-gestion-comercial-contratos.md.
 */

function serializeDeal(deal: Deal) {
  return {
    ...deal,
    createdAt: deal.createdAt?.toMillis?.() ?? null,
    updatedAt: deal.updatedAt?.toMillis?.() ?? null,
    documents: (deal.documents ?? []).map((d) => ({
      ...d,
      generatedAt: d.generatedAt?.toMillis?.() ?? null,
      sentAt: d.sentAt?.toMillis?.() ?? null,
      signedAt: d.signedAt?.toMillis?.() ?? null,
      lastStatusCheckAt: d.lastStatusCheckAt?.toMillis?.() ?? null,
    })),
    attachments: (deal.attachments ?? []).map((a) => ({
      ...a,
      uploadedAt: a.uploadedAt?.toMillis?.() ?? null,
    })),
  };
}

function serializeClient(client: ClientProfile) {
  return {
    ...client,
    createdAt: client.createdAt?.toMillis?.() ?? null,
    updatedAt: client.updatedAt?.toMillis?.() ?? null,
  };
}

async function loadBuyerProfiles(companyId: string, deal: Deal) {
  const refs = (deal.buyers ?? []).map((b) => clientsCol(companyId).doc(b.clientId));
  if (!refs.length) return [];
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((s) => s.exists)
    .map((s) => serializeClient({ id: s.id, ...s.data() } as ClientProfile));
}

// ─── Negocios del lead ───────────────────────────────────────────────────────

const LeadDealsSchema = z.object({ companyId: z.string().min(1), leadId: z.string().min(1) });

export const listLeadDeals = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(LeadDealsSchema, request.data, 'listar negocios');
  assertCompany(ctx, data.companyId);

  const snap = await dealsCol(data.companyId).where('leadId', '==', data.leadId).get();
  const deals = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Deal))
    .filter((d) => isAdmin(ctx) || d.advisorId === ctx.uid)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  const result = await Promise.all(deals.map(async (deal) => ({
    ...serializeDeal(deal),
    buyerProfiles: await loadBuyerProfiles(data.companyId, deal),
  })));
  return { deals: result };
});

/** Tablero central: administradores ven toda la empresa; asesores solo sus negocios. */
export const listCompanyDeals = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(z.object({ companyId: z.string().min(1) }), request.data, 'listar negocios');
  assertCompany(ctx, data.companyId);

  const snap = await dealsCol(data.companyId).get();
  const deals = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Deal))
    .filter((d) => isAdmin(ctx) || d.advisorId === ctx.uid)
    .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));

  const advisorIds = Array.from(new Set(deals.map((d) => d.advisorId)));
  const leadIds = Array.from(new Set(deals.map((d) => d.leadId)));
  const userRefs = advisorIds.map((id) => db.collection('companies').doc(data.companyId).collection('users').doc(id));
  const leadRefs = leadIds.map((id) => leadRef(data.companyId, id));
  const [userSnaps, leadSnaps] = await Promise.all([
    userRefs.length ? db.getAll(...userRefs) : Promise.resolve([]),
    leadRefs.length ? db.getAll(...leadRefs) : Promise.resolve([]),
  ]);
  const advisorNames = new Map(userSnaps.map((s) => [s.id, String(s.get('displayName') || s.get('email') || 'Asesor')]));
  const leadNames = new Map(leadSnaps.map((s) => [s.id, String(s.get('name') || s.get('phone') || 'Lead')]));

  return {
    deals: await Promise.all(deals.map(async (deal) => ({
      ...serializeDeal(deal),
      advisorName: advisorNames.get(deal.advisorId) || 'Asesor',
      leadName: leadNames.get(deal.leadId) || 'Lead',
      buyerProfiles: await loadBuyerProfiles(data.companyId, deal),
    }))),
  };
});

export const createDeal = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(LeadDealsSchema, request.data, 'crear el negocio');
  assertCompany(ctx, data.companyId);

  const lead = await leadsRepository.findById(data.companyId, data.leadId);
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
  if (!isAdmin(ctx) && lead.assignedTo !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Solo puedes crear negocios para tus leads asignados.');
  }

  const now = Timestamp.now();

  // Si el lead ya tiene otro negocio con compradores, heredarlos para no reescribirlos
  const prevSnap = await dealsCol(data.companyId).where('leadId', '==', data.leadId).get();
  const prevWithBuyers = prevSnap.docs
    .map((d) => d.data() as Deal)
    .filter((d) => Array.isArray(d.buyers) && d.buyers.length > 0)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))[0];

  let inheritedBuyers = prevWithBuyers?.buyers ?? [];
  let inheritedBuyerNames = prevWithBuyers?.buyerNames ?? [];
  let inheritedBuyerAttachments = (prevWithBuyers?.attachments ?? [])
    .filter((a) => a.category === 'buyer_identification');

  // Si no había compradores en deals previos, buscar si hay clientes ya registrados para este lead en clientsCol
  if (!inheritedBuyers.length) {
    try {
      const clientSnap = await clientsCol(data.companyId).where('leadIds', 'array-contains', data.leadId).get();
      if (!clientSnap.empty) {
        const sorted = clientSnap.docs.map((doc) => ({ ...(doc.data() as ClientProfile), id: doc.id }));
        inheritedBuyers = sorted.map((c, i) => ({ clientId: c.id, order: i + 1 }));
        inheritedBuyerNames = sorted.map((c) => `${c.firstNames} ${c.lastNames}`.trim());
      }
    } catch (clientErr) {
      logger.warn('[Deals] Error buscando clientes existentes para lead', { leadId: data.leadId, error: clientErr });
    }
  }

  const deal: Omit<Deal, 'id'> = {
    companyId: data.companyId,
    leadId: data.leadId,
    advisorId: lead.assignedTo || ctx.uid,
    status: 'borrador',
    buyers: inheritedBuyers,
    ...(inheritedBuyerNames.length ? { buyerNames: inheritedBuyerNames } : {}),
    lot: null,
    plan: null,
    documents: [],
    ...(inheritedBuyerAttachments.length ? { attachments: inheritedBuyerAttachments } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const actor = await userDisplayName(data.companyId, ctx.uid);
  const ref = dealsCol(data.companyId).doc();
  const batch = db.batch();
  batch.set(ref, { ...deal, createdBy: ctx.uid });
  batch.set(dealActivityRef(data.companyId, data.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: data.leadId,
    dealId: ref.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'created',
    title: inheritedBuyers.length ? 'Nuevo negocio creado (compradores vinculados)' : 'Negocio creado',
  }));
  await batch.commit();
  logger.info('[Deals] Negocio creado', { companyId: data.companyId, leadId: data.leadId, dealId: ref.id });
  return { dealId: ref.id };
});

const GetDealSchema = z.object({ companyId: z.string().min(1), dealId: z.string().min(1) });

export const getDeal = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(GetDealSchema, request.data, 'consultar el negocio');
  assertCompany(ctx, data.companyId);

  const { ref, deal: rawDeal } = await loadDeal(ctx, data.companyId, data.dealId);
  const deal = await backfillDealLots(data.companyId, ref, rawDeal);
  const [advisor, leadSnap, buyerProfiles] = await Promise.all([
    deal.advisorId ? userDisplayName(data.companyId, deal.advisorId) : Promise.resolve({ name: 'Sin asesor', email: '' }),
    leadRef(data.companyId, deal.leadId).get(),
    loadBuyerProfiles(data.companyId, deal),
  ]);
  const leadName = leadSnap.exists
    ? String(leadSnap.get('name') || leadSnap.get('phone') || 'Lead')
    : 'Lead';

  return {
    deal: {
      ...serializeDeal(deal),
      advisorName: advisor.name,
      leadName,
      buyerProfiles,
    },
  };
});

// ─── Fichas de compradores ───────────────────────────────────────────────────

const FindClientSchema = z.object({
  companyId:            z.string().min(1),
  identificationKind:   z.enum(['CC', 'CE', 'NIT', 'PAS', 'PPT', 'TI']),
  identificationNumber: z.string().trim().min(3).max(30),
});

/** Busca una ficha existente por documento para no volver a digitarla (otro negocio del mismo cliente). */
export const findClientByIdentification = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(FindClientSchema, request.data, 'buscar el cliente');
  assertCompany(ctx, data.companyId);

  const snap = await clientsCol(data.companyId).doc(clientDocId(data.identificationKind, data.identificationNumber)).get();
  if (!snap.exists) return { client: null };
  return { client: serializeClient({ id: snap.id, ...snap.data() } as ClientProfile) };
});

const SaveBuyersSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  buyers:    z.array(ClientInputSchema).min(1).max(MAX_BUYERS),
});

/**
 * Guarda los compradores del negocio en orden (1 = titular). Crea o actualiza cada
 * ficha por su documento y la vincula al lead del negocio.
 */
export const saveDealBuyers = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(SaveBuyersSchema, request.data, 'guardar los compradores');
  assertCompany(ctx, data.companyId);

  const ids = data.buyers.map((b) => clientDocId(b.identificationKind, b.identificationNumber));
  if (new Set(ids).size !== ids.length) {
    throw new HttpsError('invalid-argument', 'Hay compradores repetidos (mismo documento).');
  }

  const { ref: dealRef, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (!EDITABLE_STATUSES.includes(deal.status)) {
    throw new HttpsError('failed-precondition', 'Este negocio ya tiene documentos generados; los compradores no se pueden cambiar.');
  }

  const now = Timestamp.now();
  const actor = await userDisplayName(data.companyId, ctx.uid);
  await db.runTransaction(async (tx) => {
    const clientRefs = ids.map((id) => clientsCol(data.companyId).doc(id));
    const existing = await tx.getAll(...clientRefs);

    const auditLines: string[] = [];
    const labels: Array<[keyof (typeof data.buyers)[number], string]> = [
      ['firstNames', 'nombres'], ['lastNames', 'apellidos'], ['identificationKind', 'tipo de documento'],
      ['identificationNumber', 'documento'], ['email', 'correo'], ['mobile', 'móvil'],
      ['residenceCity', 'ciudad'], ['address', 'dirección'], ['expeditionCity', 'lugar de expedición'],
      ['expeditionDate', 'fecha de expedición'], ['birthDate', 'fecha de nacimiento'],
      ['maritalStatus', 'estado civil'], ['gender', 'género'],
    ];

    data.buyers.forEach((buyer, index) => {
      const prev = existing[index];
      const prevLeadIds = prev.exists ? ((prev.get('leadIds') as string[] | undefined) ?? []) : [];
      const previous = prev.exists ? prev.data() : undefined;
      const fullName = `${buyer.firstNames} ${buyer.lastNames}`.trim();
      if (!previous) {
        auditLines.push(`Comprador ${index + 1} agregado: ${fullName} · ${buyer.identificationKind} ${normalizeIdentification(buyer.identificationNumber)} · ${buyer.email} · ${buyer.mobile}`);
      } else {
        const changes = labels.flatMap(([field, label]) => {
          const before = String(previous[field as string] ?? '').trim();
          const after = String(buyer[field] ?? '').trim();
          return before !== after ? [`${label}: “${before || 'vacío'}” → “${after || 'vacío'}”`] : [];
        });
        auditLines.push(changes.length
          ? `Comprador ${index + 1} (${fullName}): ${changes.join('; ')}`
          : `Comprador ${index + 1} confirmado sin cambios: ${fullName}`);
      }
      const profile: Omit<ClientProfile, 'id'> = {
        companyId: data.companyId,
        personKind: buyer.personKind,
        firstNames: buyer.firstNames,
        lastNames: buyer.lastNames,
        ...(buyer.birthDate ? { birthDate: buyer.birthDate } : {}),
        ...(buyer.maritalStatus ? { maritalStatus: buyer.maritalStatus } : {}),
        ...(buyer.gender ? { gender: buyer.gender } : {}),
        residenceCity: buyer.residenceCity,
        residenceCountry: buyer.residenceCountry || 'Colombia',
        address: buyer.address,
        identificationKind: buyer.identificationKind,
        identificationNumber: normalizeIdentification(buyer.identificationNumber),
        expeditionCity: buyer.expeditionCity,
        expeditionCountry: buyer.expeditionCountry || 'Colombia',
        expeditionDate: buyer.expeditionDate,
        mobile: buyer.mobile,
        email: buyer.email,
        leadIds: Array.from(new Set([...prevLeadIds, deal.leadId])),
        createdAt: prev.exists ? (prev.get('createdAt') as Timestamp) : now,
        updatedAt: now,
      };
      tx.set(clientRefs[index], profile);
    });

    const buyers = ids.map((clientId, i) => ({ clientId, order: i + 1 }));
    tx.update(dealRef, {
      buyers,
      status: draftStatusFor({ ...deal, buyers }),
      buyerNames: data.buyers.map((b) => `${b.firstNames} ${b.lastNames}`.trim()),
      updatedAt: now,
    });

    const primary = data.buyers[0];
    tx.update(leadRef(data.companyId, deal.leadId), {
      name: `${primary.firstNames} ${primary.lastNames}`.trim(),
      email: primary.email,
      city: primary.residenceCity,
      documentNumber: normalizeIdentification(primary.identificationNumber),
      dealPrimaryBuyer: {
        dealId: deal.id,
        personKind: primary.personKind,
        firstNames: primary.firstNames,
        lastNames: primary.lastNames,
        identificationKind: primary.identificationKind,
        identificationNumber: normalizeIdentification(primary.identificationNumber),
        email: primary.email,
        mobile: primary.mobile,
        residenceCity: primary.residenceCity,
        address: primary.address,
        updatedAt: now,
      },
      updatedAt: now,
    });
    tx.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
      companyId: data.companyId,
      leadId: deal.leadId,
      dealId: deal.id,
      actorId: ctx.uid,
      actorName: actor.name,
      event: 'buyers_saved',
      title: 'Compradores guardados y ficha actualizada',
      lines: auditLines,
      createdAt: now,
    }));
  });

  logger.info('[Deals] Compradores guardados', { companyId: data.companyId, dealId: data.dealId, buyers: ids.length });
  return { ok: true as const };
});

// ─── Carpeta documental del negocio ─────────────────────────────────────────

const AttachmentCategorySchema = z.enum([
  'buyer_identification',
  'benefit_authorization',
  'referral_evidence',
  'separation_payment',
]);

const UploadAttachmentSchema = z.object({
  companyId:      z.string().min(1),
  dealId:         z.string().min(1),
  category:       AttachmentCategorySchema,
  fileName:       z.string().trim().min(1).max(180),
  contentType:    z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  base64:         z.string().min(1).max(15_000_000),
  buyerClientId:  z.string().max(120).optional(),
  paymentAmount:  z.number().int().min(0).max(100_000_000_000).optional(),
  paymentDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note:           z.string().trim().max(500).optional(),
});

const ATTACHMENT_LABELS: Record<DealAttachmentCategory, string> = {
  buyer_identification: 'Documento de identidad del comprador',
  benefit_authorization: 'Autorización de bono o descuento',
  referral_evidence: 'Evidencia del referido',
  separation_payment: 'Soporte de pago de separación',
};

function safeAttachmentName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'soporte';
}

export const uploadDealAttachment = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = parseInput(UploadAttachmentSchema, request.data, 'subir el soporte');
    assertCompany(ctx, data.companyId);
    const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);

    const buyer = data.buyerClientId
      ? deal.buyers.find((item) => item.clientId === data.buyerClientId)
      : undefined;
    if (data.category === 'buyer_identification' && !buyer) {
      throw new HttpsError('invalid-argument', 'Selecciona el comprador al que pertenece el documento.');
    }
    if (data.category === 'separation_payment' && (!data.paymentAmount || !data.paymentDate)) {
      throw new HttpsError('invalid-argument', 'El soporte de separación necesita valor y fecha del pago.');
    }

    const buffer = Buffer.from(data.base64, 'base64');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'El archivo debe pesar máximo 10 MB.');
    }

    const id = ref.collection('_attachment_ids').doc().id;
    const storagePath = `companies/${data.companyId}/deals/${deal.id}/attachments/${id}-${safeAttachmentName(data.fileName)}`;
    await storage.bucket().file(storagePath).save(buffer, {
      contentType: data.contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });

    const actor = await userDisplayName(data.companyId, ctx.uid);
    const buyerName = buyer
      ? (deal.buyerNames?.[Math.max(0, buyer.order - 1)] || `Comprador ${buyer.order}`)
      : undefined;
    const now = Timestamp.now();
    const attachment: DealAttachment = {
      id,
      category: data.category,
      fileName: data.fileName,
      contentType: data.contentType,
      size: buffer.length,
      storagePath,
      ...(buyer ? { buyerClientId: buyer.clientId, buyerName } : {}),
      ...(data.paymentAmount ? { paymentAmount: data.paymentAmount } : {}),
      ...(data.paymentDate ? { paymentDate: data.paymentDate } : {}),
      ...(data.note ? { note: data.note } : {}),
      ...(deal.lot ? { lot: lotSnapshot(deal.lot) } : {}),
      uploadedAt: now,
      uploadedBy: ctx.uid,
      uploadedByName: actor.name,
    };

    try {
      await db.runTransaction(async (tx) => {
        const currentSnap = await tx.get(ref);
        const current = currentSnap.data() as Deal;
        tx.update(ref, { attachments: [...(current.attachments ?? []), attachment], updatedAt: now });
        tx.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
          companyId: data.companyId,
          leadId: deal.leadId,
          dealId: deal.id,
          actorId: ctx.uid,
          actorName: actor.name,
          event: 'attachment_uploaded',
          title: 'Soporte agregado al negocio',
          lines: [
            ATTACHMENT_LABELS[data.category],
            ...(buyerName ? [`Comprador: ${buyerName}`] : []),
            ...(data.paymentAmount ? [`Pago: $ ${data.paymentAmount.toLocaleString('es-CO')} · ${data.paymentDate}`] : []),
            `Archivo: ${data.fileName}`,
            ...(data.note ? [`Nota: ${data.note}`] : []),
          ],
          createdAt: now,
        }));
      });
    } catch (err) {
      await storage.bucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
      throw err;
    }

    return { attachment: { ...attachment, uploadedAt: now.toMillis() } };
  },
);

const AttachmentSchema = z.object({
  companyId:    z.string().min(1),
  dealId:       z.string().min(1),
  attachmentId: z.string().min(1),
});

export const downloadDealAttachment = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = parseInput(AttachmentSchema, request.data, 'descargar el soporte');
    assertCompany(ctx, data.companyId);
    const { deal } = await loadDeal(ctx, data.companyId, data.dealId);
    const attachment = (deal.attachments ?? []).find((item) => item.id === data.attachmentId);
    if (!attachment) throw new HttpsError('not-found', 'Soporte no encontrado.');
    const [buffer] = await storage.bucket().file(attachment.storagePath).download();
    return { fileName: attachment.fileName, contentType: attachment.contentType, base64: buffer.toString('base64') };
  },
);

export const deleteDealAttachment = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(AttachmentSchema, request.data, 'eliminar el soporte');
  assertCompany(ctx, data.companyId);
  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  const attachment = (deal.attachments ?? []).find((item) => item.id === data.attachmentId);
  if (!attachment) return { ok: true as const };
  if (!isAdmin(ctx) && attachment.uploadedBy !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Solo quien subió el soporte o un administrador puede eliminarlo.');
  }

  const actor = await userDisplayName(data.companyId, ctx.uid);
  const now = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(ref);
    const current = currentSnap.data() as Deal;
    tx.update(ref, {
      attachments: (current.attachments ?? []).filter((item) => item.id !== attachment.id),
      updatedAt: now,
    });
    tx.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
      companyId: data.companyId,
      leadId: deal.leadId,
      dealId: deal.id,
      actorId: ctx.uid,
      actorName: actor.name,
      event: 'attachment_deleted',
      title: 'Soporte eliminado del negocio',
      lines: [ATTACHMENT_LABELS[attachment.category], `Archivo: ${attachment.fileName}`],
      createdAt: now,
    }));
  });
  await storage.bucket().file(attachment.storagePath).delete({ ignoreNotFound: true });
  return { ok: true as const };
});

// ─── Anular ──────────────────────────────────────────────────────────────────

const CancelDealSchema = z.object({
  companyId: z.string().min(1),
  dealId:    z.string().min(1),
  reason:    z.string().trim().min(3).max(500),
});

export const cancelDeal = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(CancelDealSchema, request.data, 'anular el negocio');
  assertCompany(ctx, data.companyId);

  const { ref, deal } = await loadDeal(ctx, data.companyId, data.dealId);
  if (deal.status === 'anulado') return { ok: true as const };
  // Con documentos en firma o firmados, anular es decisión administrativa (y se anula también en DocuBlock).
  if (!EDITABLE_STATUSES.includes(deal.status) && !isAdmin(ctx)) {
    throw new HttpsError('permission-denied', 'Este negocio ya tiene documentos; solo un administrador puede anularlo.');
  }

  const now = Timestamp.now();
  const actor = await userDisplayName(data.companyId, ctx.uid);
  const docs = deal.documents ?? [];
  const hadPendingSignatures = docs.some((d) => d.docublockDocumentId && isPendingSignature(d.signatureStatus));
  const cancelledDocs = docs.map((d) =>
    d.docublockDocumentId && isPendingSignature(d.signatureStatus)
      ? { ...d, signatureStatus: 'anulado' as const }
      : d,
  );

  const updateDeal: Record<string, unknown> = {
    status: 'anulado',
    cancelReason: data.reason,
    cancelledBy: ctx.uid,
    cancelledAt: now,
    signaturePending: false,
    updatedAt: now,
    ...(hadPendingSignatures ? { documents: cancelledDocs } : {}),
    ...(deal.planApproval?.status === 'pending'
      ? {
          'planApproval.status': 'cancelled',
          'planApproval.resolvedAt': now,
          'planApproval.resolvedBy': actor.name,
          'planApproval.responseNotes': `Negocio anulado: ${data.reason}`,
        }
      : {}),
  };

  const batch = db.batch();
  batch.update(ref, updateDeal);
  if (deal.planApproval?.status === 'pending' && deal.planApproval.id) {
    const apprRef = db.collection('companies').doc(data.companyId).collection('dealApprovals').doc(deal.planApproval.id);
    batch.set(apprRef, {
      status: 'cancelled',
      resolvedAt: now,
      resolvedBy: actor.name,
      responseNotes: `Negocio anulado: ${data.reason}`,
    }, { merge: true });
  }
  batch.set(dealActivityRef(data.companyId, deal.leadId), dealActivityDoc({
    companyId: data.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: ctx.uid,
    actorName: actor.name,
    event: 'cancelled',
    title: 'Negocio anulado',
    lines: [
      `Motivo: ${data.reason}`,
      ...(hadPendingSignatures ? ['Se detuvo el seguimiento de firma en el CRM (anula también en el panel de DocuBlock si siguen vigentes)'] : []),
    ],
    createdAt: now,
  }));
  await batch.commit();

  // Devolver el lote al inventario (solo si sigue apartado por este negocio; nunca un VENDIDO).
  if (deal.lot) {
    await releaseLot(deal.lot.inventoryLotId, deal.id, actor)
      .catch((err) => logger.warn('[Deals] No se pudo liberar el lote al anular', { dealId: deal.id, error: String(err) }));
  }

  // Si este negocio marcó el lead como Vendido (closed) y no hay otro negocio cerrado, revertir a qualified.
  try {
    const lRef = leadRef(data.companyId, deal.leadId);
    const lSnap = await lRef.get();
    if (lSnap.exists && lSnap.get('status') === 'closed' && lSnap.get('closedByDealId') === deal.id) {
      const otherDealsSnap = await dealsCol(data.companyId).where('leadId', '==', deal.leadId).get();
      const hasOtherSigned = otherDealsSnap.docs.some((d) => d.id !== deal.id && d.get('status') === 'promesa_firmada');
      if (!hasOtherSigned) {
        await lRef.update({ status: 'qualified', closedByDealId: null, updatedAt: now });
      }
    }
  } catch (leadErr) {
    logger.warn('[Deals] No se pudo revisar el estado del lead al anular', { dealId: deal.id, error: String(leadErr) });
  }

  logger.info('[Deals] Negocio anulado', { companyId: data.companyId, dealId: data.dealId });
  return { ok: true as const };
});
