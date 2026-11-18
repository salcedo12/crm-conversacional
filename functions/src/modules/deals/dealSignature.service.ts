import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { db, storage } from '../../lib/admin';
import { logger } from '../../utils/logger';
import {
  createPdfDocument,
  getDocument,
  listDirectories,
  listTemplates,
  listUsers,
  listPlaces,
  DocuBlockError,
  type DocuBlockTemplate,
} from '../../integrations/docublock/docublock.client';
import {
  buyerEndorsement,
  documentProgress,
  isMerakiUser,
  placeKey,
  matchCity,
  countryCode,
  localCellphone,
  suggestCities,
  missingSignerData,
  userEndorsement,
  userFullName,
  type EndorsementInput,
} from '../../integrations/docublock/docublock.logic';
import {
  classifyDocuBlockWebhookEvent,
  type DocuBlockWebhookEvent,
} from '../../integrations/docublock/docublockWebhook.logic';
import { webhookEventExpireAt } from '../../utils/webhookTtl';
import { getLotStatus, moveLotToTramite, releaseLot, reserveLot } from '../inventory/lotReservation.service';
import { sendAdvisorPush } from '../messages/pushNotifications.service';
import { clientsCol, dealsCol, userDisplayName } from './dealAccess';
import { dealActivityDoc, dealActivityRef, leadRef } from './dealAudit';
import { randomUUID } from 'crypto';
import { isCurrentDocument, latestCurrentDocument, lotLabel, lotSnapshot } from './dealDocumentLot';
import { signatureDealStatus, isPendingSignature, signatureDocOf } from './dealSignature.logic';
import type { ClientProfile, Deal, DealDocument, DealDocumentKind, DealSignature, DealSignatureSigner, ExtraSignatureDocument } from './deals.types';

/**
 * Firma de preventa y promesa con DocuBlock (Fase 5). Se envían los dos a la vez
 * (primero la preventa y enseguida la promesa); el lote pasa a TRAMITE. El estado se
 * consulta cada 10 min (no hay webhook: el del panel es de otro sistema).
 */

/** Tipo de firmante que DocuBlock acepta en todas las plantillas, además de los suyos. */
export const AVALADOR = 'Avalador';

export interface SignerChoice {
  source:    'buyer' | 'docublock_user';
  refId:     string;
  /** Tipo de firmante por documento (cada plantilla tiene los suyos). */
  typeSigns: Partial<Record<DealDocumentKind, string>>;
  iteration: number;
}

export interface DocumentChoice {
  kind:        DealDocumentKind;
  /** Versión escogida del documento; sin versión = la última (o se genera la promesa si falta). */
  version?:    number | null;
  templateId:  string;
  directoryId: string;
}

export interface SendExtraInput {
  companyId:      string;
  name:           string;
  fileName:       string;
  pdfBuffer:      Buffer;
  templateId:     string;
  directoryId:    string;
  signers:        Array<{ source: 'buyer' | 'docublock_user'; refId: string; typeSign: string; iteration: number }>;
  responsibleId?: string | null;
  requirePhoto:   boolean;
}

export interface SendInput {
  companyId:     string;
  documents:     DocumentChoice[];
  signers:       SignerChoice[];
  responsibleId?: string | null;
  requirePhoto:  boolean;
}

/**
 * Firmantes de la empresa que se ofrecen en "Enviar a firma" (los mismos de SmartHome).
 * Se buscan por nombre entre los usuarios de DocuBlock (allá tienen el nombre completo).
 */
export const COMPANY_SIGNERS: Array<{ name: string; role: string }> = [
  { name: 'Javier Eduardo Buitrago', role: 'Manager' },
  { name: 'Jhon Esper Toledo Castañeda', role: 'Administrator' },
  { name: 'Leidy Ramírez', role: 'Manager' },
  { name: 'Luis Eduardo Salcedo', role: 'Administrator' },
];

/** El firmante de la lista que corresponde a un usuario de DocuBlock (todas las palabras de la lista están en su nombre). */
export function companySignerFor(fullName: string): { name: string; role: string } | undefined {
  const words = (v: string) => placeKey(v).split(' ').filter(Boolean);
  const have = new Set(words(fullName));
  return COMPANY_SIGNERS.find((s) => words(s.name).every((w) => have.has(w)));
}

/** Lo que muestra la pantalla "Enviar a firma": plantillas, directorios, responsables y firmantes de la empresa. */
export async function signatureOptions() {
  const [templates, directories, users] = await Promise.all([listTemplates(), listDirectories(), listUsers()]);
  return {
    templates: templates
      .filter((t) => t.state !== 0)
      .map((t) => ({ id: t._id, name: t.name.trim(), directoryId: t.directory ?? '', signerTypes: [...(t.typeSigners ?? []).map((s) => ({ name: s.name.trim(), principal: s.principal, required: s.type === 'mandatory' })), { name: AVALADOR, principal: false, required: false }] })),
    directories: directories.map((d) => ({ id: d._id, name: d.name.trim() })),
    users: users
      .filter(isMerakiUser)
      .map((u) => ({ id: u._id, name: userFullName(u), email: u.email ?? '', role: companySignerFor(userFullName(u))?.role ?? '', signer: !!companySignerFor(userFullName(u)), complete: missingSignerData(userEndorsement(u, { typeSign: 'x', iteration: 2 })).length === 0 }))
      .filter((u) => u.name && !/docublock/i.test(u.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}


/** Nombre del documento en DocuBlock: "PREVENTA - SAN ANTONIO 19 - PEREZ GOMEZ". */
function docublockName(deal: Deal, kind: DealDocumentKind, buyers: ClientProfile[]): string {
  const label = kind === 'preventa' ? 'CONTRATO DE PREVENTA' : 'PROMESA DE COMPRAVENTA';
  const lot = deal.lot ? `${deal.lot.sector} ${deal.lot.lotNumber}` : deal.id;
  const who = buyers[0] ? `${buyers[0].firstNames} ${buyers[0].lastNames}`.trim() : '';
  return [label, lot, who].filter(Boolean).join(' - ').toUpperCase();
}

/** Arma los firmantes de DocuBlock y avisa qué datos faltan (antes de enviar nada). */
async function buildSignersCore<T extends { source: 'buyer' | 'docublock_user'; refId: string; iteration: number }>(
  companyId: string,
  getTypeSign: (choice: T) => string,
  choices: T[],
  template: DocuBlockTemplate,
  requirePhoto: boolean,
): Promise<{ endorsements: EndorsementInput[]; signers: DealSignatureSigner[] }> {
  if (!choices.length) throw new HttpsError('invalid-argument', 'Escoge al menos un firmante.');
  // "Avalador" se puede usar en cualquier plantilla (así lo ofrece SmartHome).
  const allowed = new Set([...(template.typeSigners ?? []).map((t) => t.name.trim()), AVALADOR]);
  const buyerIds = choices.filter((c) => c.source === 'buyer').map((c) => c.refId);
  const buyerSnaps = buyerIds.length ? await db.getAll(...buyerIds.map((id) => clientsCol(companyId).doc(id))) : [];
  const buyers = new Map(buyerSnaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() } as ClientProfile]));
  const users = choices.some((c) => c.source === 'docublock_user') ? new Map((await listUsers()).map((u) => [u._id, u])) : new Map();

  const places = await listPlaces();
  const endorsements: EndorsementInput[] = [];
  const signers: DealSignatureSigner[] = [];
  const problems: string[] = [];
  let principalSet = false;
  for (const choice of [...choices].sort((a, b) => a.iteration - b.iteration)) {
    const typeSign = getTypeSign(choice).trim();
    if (allowed.size && !allowed.has(typeSign)) problems.push(`"${typeSign}" no es un tipo de firmante de la plantilla ${template.name.trim()}`);
    let endorsement: EndorsementInput;
    let name: string;
    if (choice.source === 'buyer') {
      const client = buyers.get(choice.refId);
      if (!client) { problems.push('Un comprador ya no existe en el negocio'); continue; }
      const principal = !principalSet;
      principalSet = true;
      endorsement = buyerEndorsement(client, { typeSign, iteration: choice.iteration, principal, requirePhoto });
      name = `${client.firstNames} ${client.lastNames}`.trim();
    } else {
      const user = users.get(choice.refId);
      if (!user) { problems.push('Un firmante de Meraki ya no está en DocuBlock'); continue; }
      if (!companySignerFor(userFullName(user))) { problems.push(`${userFullName(user)} no es firmante de la empresa`); continue; }
      endorsement = userEndorsement(user, { typeSign, iteration: choice.iteration });
      name = userFullName(user);
      logger.info('[DealSignature] docublock_user raw', {
        idType: typeof user.identificationType,
        idStr: typeof user.identificationType === 'string' ? user.identificationType : Object.keys((user.identificationType ?? {}) as object),
        cityType: typeof user.city,
        expCityType: typeof user.expeditionCity,
        countryType: typeof user.country,
        resolvedKind: endorsement.identificationKind,
      });
    }
    // Ciudades con el nombre exacto de DocuBlock (si no, DocuBlock rechaza el envío).
    for (const field of ['city', 'expeditionCity'] as const) {
      const value = endorsement[field];
      if (!value) continue;
      const client = choice.source === 'buyer' ? buyers.get(choice.refId) : undefined;
      const country = field === 'city' ? endorsement.country : client?.expeditionCountry;
      const match = matchCity(value, places.cities, places.countries, country);
      if (match) {
        endorsement[field] = match.city;
        if (field === 'city') endorsement.country = match.country;
      } else if (choice.source === 'buyer') {
        const hint = suggestCities(value, places.cities);
        problems.push(`${name}: la ciudad ${field === 'city' ? 'de residencia' : 'de expedición'} "${value}" no existe en DocuBlock${hint.length ? ` (¿${hint.join(', ')}?)` : ''}; corrígela en la ficha`);
      }
    }
    // DocuBlock pide el país como abreviatura ("CO"), no el nombre.
    endorsement.country = countryCode(endorsement.country, places.countries);
    const rawMobile = choice.source === 'buyer' ? (buyers.get(choice.refId)?.mobile ?? '') : (users.get(choice.refId)?.phone ?? '');
    endorsement.cellphone = localCellphone(rawMobile, endorsement.country);
    const missing = missingSignerData(endorsement);
    if (missing.length) problems.push(`${name}: falta ${missing.join(', ')}`);
    endorsements.push(endorsement);
    logger.info('[DealSignature] endorsement normalized', {
      source: choice.source,
      identificationKind: endorsement.identificationKind,
      country: endorsement.country,
      hasCity: Boolean(endorsement.city),
      hasExpCity: Boolean(endorsement.expeditionCity),
      cellLen: endorsement.cellphone.length,
      kindPerson: endorsement.kindPerson,
      iteration: endorsement.iteration,
    });
    signers.push({ source: choice.source, refId: choice.refId, name, email: endorsement.email, typeSign, iteration: choice.iteration, signed: false });
  }
  const typesUsed = endorsements.map((e) => e.typeSign);
  // Varios pueden ser "Avalador"; los demás tipos son de un solo firmante.
  const duplicated = typesUsed.filter((t, i) => t !== AVALADOR && typesUsed.indexOf(t) !== i);
  if (duplicated.length) problems.push(`Cada firmante necesita un tipo distinto (repetido: ${[...new Set(duplicated)].join(', ')})`);
  for (const required of (template.typeSigners ?? []).filter((t) => t.type === 'mandatory')) {
    if (!typesUsed.includes(required.name.trim())) problems.push(`La plantilla exige un firmante "${required.name.trim()}"`);
  }
  if (problems.length) throw new HttpsError('failed-precondition', problems.join('. ') + '.');
  return { endorsements, signers };
}

export function buildSigners(
  companyId: string,
  kind: DealDocumentKind,
  choices: SignerChoice[],
  template: DocuBlockTemplate,
  requirePhoto: boolean,
) {
  return buildSignersCore(companyId, (c) => c.typeSigns[kind] ?? '', choices, template, requirePhoto);
}

/**
 * Envía a DocuBlock los documentos escogidos (preventa primero). Si uno ya está en firma
 * no se reenvía; si falla a mitad, lo enviado queda guardado y se puede reintentar.
 */
export async function sendToSignature(opts: {
  ref: DocumentReference;
  deal: Deal;
  input: SendInput;
  actor: { uid: string; name: string; email: string };
  ensureDocument: (kind: DealDocumentKind) => Promise<DealDocument>;
  pdfOf: (doc: DealDocument) => Promise<Buffer>;
  fileNameOf: (doc: DealDocument) => string;
}): Promise<{ sent: DealDocumentKind[] }> {
  const { ref, deal, input, actor } = opts;
  if (!deal.lot || !deal.plan) throw new HttpsError('failed-precondition', 'El negocio no tiene lote y plan.');
  if (deal.status === 'anulado') throw new HttpsError('failed-precondition', 'El negocio está anulado.');
  const kinds = (['preventa', 'promesa'] as DealDocumentKind[]).filter((k) => input.documents.some((d) => d.kind === k));
  if (!kinds.length) throw new HttpsError('invalid-argument', 'Escoge qué documentos enviar a firma.');

  const [templates, directories] = await Promise.all([listTemplates(), listDirectories()]);
  const buyersForName = await db.getAll(...deal.buyers.map((b) => clientsCol(input.companyId).doc(b.clientId)));
  const buyerProfiles = buyersForName.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() } as ClientProfile));

  // Validar todo antes de enviar el primero.
  const plans = [];
  for (const kind of kinds) {
    const choice = input.documents.find((d) => d.kind === kind)!;
    const template = templates.find((t) => t._id === choice.templateId);
    if (!template) throw new HttpsError('invalid-argument', `La plantilla escogida para la ${kind} no existe en DocuBlock.`);
    const directory = directories.find((d) => d._id === choice.directoryId);
    if (!directory) throw new HttpsError('invalid-argument', `El directorio escogido para la ${kind} no existe en DocuBlock.`);
    // Solo documentos del lote actual: uno de un lote anterior no se puede firmar.
    if (choice.version) {
      const chosenDoc = (deal.documents ?? []).find((d) => d.kind === kind && d.version === choice.version);
      if (chosenDoc && !isCurrentDocument(chosenDoc, deal)) {
        throw new HttpsError('failed-precondition', `La ${kind} v${choice.version} es de otro lote (${chosenDoc.lot ? lotLabel(chosenDoc.lot) : 'lote anterior'}). Genera una nueva para ${lotLabel(deal.lot)}.`);
      }
    }
    if (kind === 'promesa' && !choice.version && !latestCurrentDocument(deal, 'promesa') && !latestCurrentDocument(deal, 'preventa')) {
      throw new HttpsError('failed-precondition', `No hay preventa vigente para ${lotLabel(deal.lot)}: genérala primero.`);
    }
    const built = await buildSigners(input.companyId, kind, input.signers, template, input.requirePhoto);
    plans.push({ kind, template, directory, ...built });
  }

  const broker = deal.advisorId === actor.uid ? actor : await userDisplayName(input.companyId, deal.advisorId);
  const prevLotStatus = await getLotStatus(deal.lot.inventoryLotId).catch(() => null);
  // El lote pasa a TRAMITE antes de enviar (si otro lo tomó, no se envía nada).
  await moveLotToTramite(deal.lot.inventoryLotId, { dealId: deal.id, companyId: input.companyId, advisorName: broker.name }, actor);

  const users = input.responsibleId ? await listUsers() : [];
  const responsible = users.find((u) => u._id === input.responsibleId);
  const sent: DealDocumentKind[] = [];
  try {
    for (const plan of plans) {
      // La promesa se genera si falta (sale de los mismos datos de la preventa).
      const chosen = input.documents.find((d) => d.kind === plan.kind)?.version;
      let doc = chosen
        ? (deal.documents ?? []).find((d) => d.kind === plan.kind && d.version === chosen)
        : latestCurrentDocument(deal, plan.kind) ?? await opts.ensureDocument(plan.kind);
      if (!doc) throw new HttpsError('not-found', `No existe la ${plan.kind} v${chosen}.`);
      const inSigning = signatureDocOf(deal, plan.kind);
      if (inSigning && inSigning.version !== doc.version && inSigning.docublockDocumentId && isPendingSignature(inSigning.signatureStatus)) {
        throw new HttpsError('failed-precondition', `La ${plan.kind} v${inSigning.version} ya está en firma: márcala anulada antes de enviar otra versión.`);
      }
      if (doc.docublockDocumentId && isPendingSignature(doc.signatureStatus)) continue;
      if (doc.signatureStatus === 'firmado') continue;
      const pdf = await opts.pdfOf(doc);
      const { id } = await createPdfDocument({
        name: docublockName(deal, plan.kind, buyerProfiles),
        filename: opts.fileNameOf(doc).replace(/\.docx$/, '.pdf'),
        baseFile: pdf.toString('base64'),
        template: plan.template._id,
        directory: plan.directory._id,
        endorsementInput: plan.endorsements,
        relatedInfo: { crmCompanyId: input.companyId, crmDealId: deal.id, documento: plan.kind, version: String(doc.version), lote: `${deal.lot.sector} ${deal.lot.lotNumber}` },
        ...(responsible ? { user: responsible._id } : {}),
      });
      const signature: DealSignature = {
        templateId: plan.template._id,
        templateName: plan.template.name.trim(),
        directoryId: plan.directory._id,
        directoryName: plan.directory.name.trim(),
        ...(responsible ? { responsibleId: responsible._id, responsibleName: userFullName(responsible) } : {}),
        requirePhoto: input.requirePhoto,
        signers: plan.signers,
        sentBy: actor.uid,
        previousDocumentIds: [...(doc.signature?.previousDocumentIds ?? []), ...(doc.docublockDocumentId ? [doc.docublockDocumentId] : [])],
        lastError: null,
      };
      doc = { ...doc, docublockDocumentId: id, signatureStatus: 'en_firma', sentAt: Timestamp.now(), signature };
      deal.documents = (deal.documents ?? []).map((d) => (d.kind === doc.kind && d.version === doc.version ? doc : d));
      await saveSignatureState(ref, deal);
      sent.push(plan.kind);
      logger.info('[DealSignature] Enviado a DocuBlock', { dealId: deal.id, kind: plan.kind, version: doc.version, docublockId: id });
    }
  } catch (err) {
    // Si no alcanzó a salir ningún contrato a DocuBlock, restauramos el estado previo del lote.
    if (sent.length === 0 && !deal.signaturePending) {
      try {
        if (prevLotStatus?.status === 'DISPONIBLE') {
          await releaseLot(deal.lot.inventoryLotId, deal.id, actor);
        } else if (prevLotStatus?.status === 'NEGOCIACION' && prevLotStatus.dealId === deal.id) {
          const restored = await reserveLot(deal.lot.inventoryLotId, { dealId: deal.id, companyId: input.companyId, advisorName: broker.name }, actor);
          await ref.update({ 'lot.reservedUntil': restored.reservedUntil ?? '', updatedAt: Timestamp.now() });
        }
      } catch (rollbackErr) {
        logger.warn('[DealSignature] No se pudo revertir el lote tras fallo en DocuBlock', {
          dealId: deal.id,
          lotId: deal.lot.inventoryLotId,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        });
      }
    }
    if (err instanceof DocuBlockError) {
      throw new HttpsError('unavailable', `${sent.length ? `Se envió ${sent.join(' y ')}, pero ` : ''}DocuBlock rechazó el envío: ${err.message}`);
    }
    throw err;
  } finally {
    if (sent.length) {
      await dealActivityRef(input.companyId, deal.leadId).set(dealActivityDoc({
        companyId: input.companyId, leadId: deal.leadId, dealId: deal.id, actorId: actor.uid, actorName: actor.name,
        event: 'sent_to_signature',
        title: sent.length === 2 ? 'Preventa y promesa enviadas a firma' : `${sent[0] === 'preventa' ? 'Preventa' : 'Promesa'} enviada a firma`,
        lines: [`Firmantes: ${plans[0]!.signers.map((s) => s.name).join(', ')}`, 'Lote en TRÁMITE mientras se firma'],
      }));
    }
  }
  return { sent };
}

/** Envía un documento PDF adicional (otrosí, anexo, acta, etc.) a DocuBlock. */
export async function sendExtraToSignature(opts: {
  ref: DocumentReference;
  deal: Deal;
  input: SendExtraInput;
  actor: { uid: string; name: string };
}): Promise<{ extra: ExtraSignatureDocument }> {
  const { ref, deal, input, actor } = opts;
  if (!deal.lot) throw new HttpsError('failed-precondition', 'El negocio no tiene lote asignado.');
  if (deal.status === 'anulado') throw new HttpsError('failed-precondition', 'El negocio está anulado.');
  if (!deal.buyers?.length) throw new HttpsError('failed-precondition', 'El negocio no tiene compradores.');

  const [templates, directories] = await Promise.all([listTemplates(), listDirectories()]);
  const template = templates.find((t) => t._id === input.templateId);
  if (!template) throw new HttpsError('invalid-argument', 'La plantilla escogida no existe en DocuBlock.');
  const directory = directories.find((d) => d._id === input.directoryId);
  if (!directory) throw new HttpsError('invalid-argument', 'El directorio escogido no existe en DocuBlock.');

  const buyersForName = await db.getAll(...deal.buyers.map((b) => clientsCol(input.companyId).doc(b.clientId)));
  const buyerProfiles = buyersForName.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() } as ClientProfile));
  const built = await buildSignersCore(input.companyId, (c) => c.typeSign, input.signers, template, input.requirePhoto);

  const users = input.responsibleId ? await listUsers() : [];
  const responsible = users.find((u) => u._id === input.responsibleId);
  const id = randomUUID().slice(0, 12);
  const safeName = input.name.trim().toUpperCase();
  const lotText = `${deal.lot.sector} ${deal.lot.lotNumber}`;
  const who = buyerProfiles[0] ? `${buyerProfiles[0].firstNames} ${buyerProfiles[0].lastNames}`.trim() : '';
  const docName = [safeName, lotText, who].filter(Boolean).join(' - ').toUpperCase();
  const pdfStoragePath = `companies/${input.companyId}/deals/${deal.id}/extra-signatures/${id}.pdf`;

  let docublockId: string;
  try {
    const res = await createPdfDocument({
      name: docName,
      filename: input.fileName.replace(/[\\/:*?"<>|]/g, '') || `${id}.pdf`,
      baseFile: input.pdfBuffer.toString('base64'),
      template: template._id,
      directory: directory._id,
      endorsementInput: built.endorsements,
      relatedInfo: { crmCompanyId: input.companyId, crmDealId: deal.id, documento: 'adicional', extraSignatureId: id, nombre: input.name.trim(), lote: lotText },
      ...(responsible ? { user: responsible._id } : {}),
    });
    docublockId = res.id;
  } catch (err) {
    if (err instanceof DocuBlockError) {
      throw new HttpsError('unavailable', `DocuBlock rechazó el envío: ${err.message}`);
    }
    throw err;
  }

  await storage.bucket().file(pdfStoragePath).save(input.pdfBuffer, { contentType: 'application/pdf', resumable: false });

  const extra: ExtraSignatureDocument = {
    id,
    name: input.name.trim(),
    fileName: input.fileName,
    pdfStoragePath,
    signatureStatus: 'en_firma',
    docublockDocumentId: docublockId,
    sentAt: Timestamp.now(),
    sentBy: actor.uid,
    lot: lotSnapshot(deal.lot),
    signature: {
      templateId: template._id,
      templateName: template.name.trim(),
      directoryId: directory._id,
      directoryName: directory.name.trim(),
      ...(responsible ? { responsibleId: responsible._id, responsibleName: userFullName(responsible) } : {}),
      requirePhoto: input.requirePhoto,
      signers: built.signers,
      sentBy: actor.uid,
      previousDocumentIds: [],
      lastError: null,
    },
  };
  deal.extraSignatures = [...(deal.extraSignatures ?? []), extra];
  await saveSignatureState(ref, deal);
  await dealActivityRef(input.companyId, deal.leadId).set(dealActivityDoc({
    companyId: input.companyId, leadId: deal.leadId, dealId: deal.id, actorId: actor.uid, actorName: actor.name,
    event: 'sent_to_signature',
    title: `Documento adicional enviado a firma: ${extra.name}`,
    lines: [`Firmantes: ${built.signers.map((s) => s.name).join(', ')}`],
  }));
  logger.info('[DealSignature] Adicional enviado a DocuBlock', { dealId: deal.id, extraId: id, docublockId });
  return { extra };
}

/** Guarda documentos, estado del negocio y la marca de "en firma". */
async function saveSignatureState(ref: DocumentReference, deal: Deal): Promise<Deal['status']> {
  const prevStatus = deal.status;
  const status = signatureDealStatus(deal);
  const pendingDocs = (deal.documents ?? []).some((d) => d.docublockDocumentId && isPendingSignature(d.signatureStatus));
  const pendingExtras = (deal.extraSignatures ?? []).some((e) => e.docublockDocumentId && isPendingSignature(e.signatureStatus));
  const pending = pendingDocs || pendingExtras;
  const now = Timestamp.now();
  deal.status = status;
  await ref.update({
    documents: deal.documents ?? [],
    ...(deal.extraSignatures ? { extraSignatures: deal.extraSignatures } : {}),
    status,
    signaturePending: pending,
    updatedAt: now,
  });

  // Fase 6: al firmarse la promesa, el lote sigue en TRAMITE (auditoría interna) y el lead pasa a Vendido (closed → CAPI Purchase).
  if (prevStatus !== 'promesa_firmada' && status === 'promesa_firmada' && deal.leadId) {
    try {
      const lRef = leadRef(deal.companyId, deal.leadId);
      const lSnap = await lRef.get();
      if (lSnap.exists && lSnap.get('status') !== 'closed') {
        await lRef.update({ status: 'closed', closedByDealId: deal.id, updatedAt: now });
        await ref.update({ closedLeadAt: now });
        await dealActivityRef(deal.companyId, deal.leadId).set(dealActivityDoc({
          companyId: deal.companyId,
          leadId: deal.leadId,
          dealId: deal.id,
          actorId: 'docublock',
          actorName: 'DocuBlock',
          event: 'signature_update',
          title: 'Lead marcado como Vendido',
          lines: ['Promesa firmada por todos · Lote se mantiene en TRÁMITE para auditoría interna'],
          createdAt: now,
        }));
      }
    } catch (err) {
      logger.warn('[DealSignature] No se pudo marcar el lead como closed al firmar promesa', {
        dealId: deal.id,
        leadId: deal.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Si ya no queda ninguna firma pendiente ni contrato firmado, el lote vuelve de TRAMITE a reserva (NEGOCIACION 24 h).
  const hadActiveSigning = prevStatus === 'preventa_en_firma' || prevStatus === 'promesa_en_firma';
  if (hadActiveSigning && status === 'plan_listo' && !pending && deal.lot?.inventoryLotId) {
    try {
      const restored = await reserveLot(
        deal.lot.inventoryLotId,
        { dealId: deal.id, companyId: deal.companyId, advisorName: 'DocuBlock' },
        { name: 'DocuBlock', email: '' },
      );
      deal.lot = restored;
      await ref.update({ 'lot.reservedUntil': restored.reservedUntil ?? '', updatedAt: Timestamp.now() });
    } catch (err) {
      logger.warn('[DealSignature] No se pudo devolver el lote a NEGOCIACION al detenerse la firma', {
        dealId: deal.id,
        lotId: deal.lot.inventoryLotId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Notificación push al asesor en hitos relevantes de firma.
  if (prevStatus !== status && deal.advisorId) {
    const lotText = deal.lot ? lotLabel(deal.lot) : 'Negocio';
    const pushPayload =
      status === 'preventa_firmada'
        ? { title: 'Preventa firmada', body: `${lotText}: todos firmaron la preventa en DocuBlock.`, type: 'deal_signature' }
        : status === 'promesa_firmada'
          ? { title: 'Promesa firmada · Vendido', body: `${lotText}: todos firmaron la promesa de compraventa.`, type: 'deal_signature' }
          : hadActiveSigning && status === 'plan_listo'
            ? { title: 'Firma detenida en DocuBlock', body: `${lotText}: la firma fue anulada, rechazada o venció. El lote volvió a reserva.`, type: 'deal_signature' }
            : null;
    if (pushPayload) {
      await sendAdvisorPush(deal.companyId, deal.advisorId, {
        ...pushPayload,
        url: `/dashboard/deals/${deal.id}`,
        leadId: deal.leadId,
      }).catch((err) => logger.warn('[DealSignature] Error enviando push al asesor', { dealId: deal.id, error: String(err) }));
    }
  }

  return status;
}

async function syncDocuBlockItem(
  item: {
    docublockDocumentId?: string;
    signatureStatus: DealDocument['signatureStatus'];
    signature?: DealSignature;
    lastStatusCheckAt?: Timestamp;
    signedPdfStoragePath?: string;
    signedAt?: Timestamp;
  },
  opts: { dealId: string; label: string; signedPdfPath: string },
  updates: string[],
): Promise<boolean> {
  if (!item.docublockDocumentId || !isPendingSignature(item.signatureStatus)) return false;
  try {
    const progress = documentProgress(await getDocument(item.docublockDocumentId));
    const signers = (item.signature?.signers ?? []).map((s) => {
      // DocuBlock conserva el correo que ya tenía la persona (si estaba registrada por su cédula),
      // así que se empareja por tipo de firmante (único en el documento, salvo "Avalador"), luego por correo o nombre.
      const key = (v: string) => placeKey(v);
      const sameType = progress.signers.filter((p) => key(p.typeSign) === key(s.typeSign));
      const match = (sameType.length === 1 ? sameType[0] : undefined)
        ?? progress.signers.find((p) => p.email && p.email.toLowerCase() === s.email.toLowerCase())
        ?? sameType.find((p) => key(p.name) === key(s.name));
      return match ? { ...s, signed: match.signed, docublockSignerId: match.endorsementId || s.docublockSignerId } : s;
    });
    const newlySigned = signers.filter((s, i) => s.signed && !item.signature?.signers[i]?.signed).map((s) => s.name);
    item.lastStatusCheckAt = Timestamp.now();
    if (item.signature) item.signature = { ...item.signature, signers, expiresAt: progress.expiresAt, lastError: null };
    if (newlySigned.length) updates.push(`${opts.label}: firmó ${newlySigned.join(', ')}`);
    if (progress.status === 'firmado') {
      // Solo queda "firmado" cuando el PDF firmado ya está en Storage (si falla, se reintenta).
      if (!progress.fileUrl) throw new Error('DocuBlock no entregó el archivo firmado');
      item.signedPdfStoragePath = await saveSignedPdf(opts.signedPdfPath, progress.fileUrl);
      item.signedAt = Timestamp.now();
      item.signatureStatus = 'firmado';
      updates.push(`${opts.label}: firmado por todos`);
    } else {
      item.signatureStatus = progress.status;
    }
    if (progress.status === 'vencido') {
      updates.push(`${opts.label}: venció el plazo de firma`);
    }
    return true;
  } catch (err) {
    logger.warn('[DealSignature] No se pudo consultar DocuBlock', { dealId: opts.dealId, label: opts.label, error: String(err) });
    if (item.signature) item.signature = { ...item.signature, lastError: err instanceof Error ? err.message : String(err) };
    return true;
  }
}

/**
 * Consulta en DocuBlock los documentos en firma del negocio (contratos y adicionales)
 * y actualiza su avance. Al quedar firmado, guarda el PDF firmado en Storage.
 */
export async function refreshSignatures(ref: DocumentReference, deal: Deal): Promise<{ changed: boolean }> {
  let changed = false;
  const companyId = deal.companyId;
  const updates: string[] = [];
  for (const doc of deal.documents ?? []) {
    const label = doc.kind === 'preventa' ? 'Preventa' : 'Promesa';
    const path = `companies/${companyId}/deals/${deal.id}/${doc.kind}-v${doc.version}-firmado.pdf`;
    if (await syncDocuBlockItem(doc, { dealId: deal.id, label, signedPdfPath: path }, updates)) changed = true;
  }
  for (const extra of deal.extraSignatures ?? []) {
    const path = `companies/${companyId}/deals/${deal.id}/extra-signatures/${extra.id}-firmado.pdf`;
    if (await syncDocuBlockItem(extra, { dealId: deal.id, label: extra.name, signedPdfPath: path }, updates)) changed = true;
  }
  if (changed) await saveSignatureState(ref, deal);
  if (updates.length) {
    await dealActivityRef(companyId, deal.leadId).set(dealActivityDoc({
      companyId, leadId: deal.leadId, dealId: deal.id, actorId: 'docublock', actorName: 'DocuBlock',
      event: 'signature_update', title: 'Avance de la firma', lines: updates,
    }));
  }
  return { changed };
}

async function saveSignedPdf(path: string, url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`No se pudo descargar el PDF firmado (${res.status})`);
  await storage.bucket().file(path).save(Buffer.from(await res.arrayBuffer()), { contentType: 'application/pdf', resumable: false });
  return path;
}

/** Se anuló en el panel de DocuBlock: el CRM lo marca y deja de consultarlo. */
export async function markSignatureCancelled(
  ref: DocumentReference,
  deal: Deal,
  target: { kind?: DealDocumentKind; extraId?: string },
  actor: { uid: string; name: string },
  reason: string,
) {
  const doc = target.extraId
    ? (deal.extraSignatures ?? []).find((e) => e.id === target.extraId)
    : target.kind
      ? signatureDocOf(deal, target.kind)
      : undefined;
  if (!doc?.docublockDocumentId) throw new HttpsError('failed-precondition', 'Ese documento no se ha enviado a firma.');
  if (doc.signatureStatus === 'firmado') throw new HttpsError('failed-precondition', 'El documento ya está firmado.');
  doc.signatureStatus = 'anulado';
  await saveSignatureState(ref, deal);
  const titleLabel = target.extraId
    ? (doc as ExtraSignatureDocument).name
    : target.kind === 'preventa' ? 'Preventa' : 'Promesa';
  await dealActivityRef(deal.companyId, deal.leadId).set(dealActivityDoc({
    companyId: deal.companyId, leadId: deal.leadId, dealId: deal.id, actorId: actor.uid, actorName: actor.name,
    event: 'signature_update', title: `${titleLabel}: firma anulada`, lines: [reason],
  }));
}

function dealHasDocuBlockDocument(deal: Deal, documentId: string): boolean {
  return (deal.documents ?? []).some((d) => d.docublockDocumentId === documentId)
    || (deal.extraSignatures ?? []).some((e) => e.docublockDocumentId === documentId);
}

async function findDealForWebhookDocument(
  event: DocuBlockWebhookEvent,
): Promise<{ ref: DocumentReference; deal: Deal } | null> {
  const companyId = event.relatedInfo.crmCompanyId;
  const dealId = event.relatedInfo.crmDealId;
  if (companyId && dealId) {
    const ref = dealsCol(companyId).doc(dealId);
    const snap = await ref.get();
    if (snap.exists) {
      const deal = { id: snap.id, companyId, ...snap.data() } as Deal;
      if (dealHasDocuBlockDocument(deal, event.documentId)) {
        return { ref, deal };
      }
    }
  }
  const pendingSnap = await db.collectionGroup('deals').where('signaturePending', '==', true).limit(200).get();
  for (const snap of pendingSnap.docs) {
    const data = snap.data() as Deal;
    if (dealHasDocuBlockDocument(data, event.documentId)) {
      const derivedCompanyId = data.companyId || snap.ref.parent.parent?.id || '';
      return { ref: snap.ref, deal: { ...data, id: snap.id, companyId: derivedCompanyId } };
    }
  }
  return null;
}

/**
 * Procesa un evento de DocuBlock Webhooks v2 sobre un documento del CRM.
 * Ignora silenciosamente eventos de prueba o de otros sistemas (SmartHome) que
 * no corresponden a ningún negocio del CRM.
 */
export async function applyDocuBlockWebhookEvent(
  event: DocuBlockWebhookEvent,
): Promise<{ matched: boolean; ignored?: boolean; duplicate?: boolean; changed?: boolean }> {
  const action = classifyDocuBlockWebhookEvent(event.type);
  if (action.kind === 'ignore') return { matched: false, ignored: true };

  const found = await findDealForWebhookDocument(event);
  if (!found) return { matched: false, ignored: true };
  const { ref, deal } = found;

  if (event.id) {
    const eventRef = db.collection('companies').doc(deal.companyId).collection('webhookEvents').doc(`docublock_${event.id}`);
    try {
      await eventRef.create({
        eventId: event.id,
        type: event.type,
        documentId: event.documentId,
        processedAt: Timestamp.now(),
        expireAt: webhookEventExpireAt(),
        channel: 'docublock_v2',
      });
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 6) return { matched: true, duplicate: true };
      throw err;
    }
  }

  if (action.kind === 'refresh') {
    const res = await refreshSignatures(ref, deal);
    return { matched: true, changed: res.changed };
  }

  const targetDoc = (deal.documents ?? []).find((d) => d.docublockDocumentId === event.documentId);
  const targetExtra = (deal.extraSignatures ?? []).find((e) => e.docublockDocumentId === event.documentId);
  const item = targetDoc ?? targetExtra;
  if (!item || item.signatureStatus === 'firmado' || item.signatureStatus === action.status) {
    return { matched: true, changed: false };
  }

  item.signatureStatus = action.status;
  item.lastStatusCheckAt = Timestamp.now();
  await saveSignatureState(ref, deal);

  const label = targetDoc ? (targetDoc.kind === 'preventa' ? 'Preventa' : 'Promesa') : targetExtra!.name;
  const actionLabel = action.status === 'rechazado'
    ? `rechazada${event.signerEmail ? ` por ${event.signerEmail}` : ''}`
    : action.status === 'anulado' ? 'anulada en DocuBlock' : 'vencida sin completar';
  await dealActivityRef(deal.companyId, deal.leadId).set(dealActivityDoc({
    companyId: deal.companyId,
    leadId: deal.leadId,
    dealId: deal.id,
    actorId: 'docublock',
    actorName: 'DocuBlock',
    event: 'signature_update',
    title: `${label}: firma ${actionLabel}`,
    lines: [`Evento webhook v2 (${event.type})`],
  }));
  return { matched: true, changed: true };
}
