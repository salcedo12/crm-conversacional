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
  suggestCities,
  missingSignerData,
  userEndorsement,
  userFullName,
  type EndorsementInput,
} from '../../integrations/docublock/docublock.logic';
import { moveLotToTramite } from '../inventory/lotReservation.service';
import { clientsCol } from './dealAccess';
import { dealActivityDoc, dealActivityRef } from './dealAudit';
import { isCurrentDocument, latestCurrentDocument, lotLabel } from './dealDocumentLot';
import { signatureDealStatus, isPendingSignature, signatureDocOf } from './dealSignature.logic';
import type { ClientProfile, Deal, DealDocument, DealDocumentKind, DealSignature, DealSignatureSigner } from './deals.types';

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
export async function buildSigners(
  companyId: string,
  kind: DealDocumentKind,
  choices: SignerChoice[],
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
    const typeSign = (choice.typeSigns[kind] ?? '').trim();
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
    const missing = missingSignerData(endorsement);
    if (missing.length) problems.push(`${name}: falta ${missing.join(', ')}`);
    endorsements.push(endorsement);
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

  // El lote pasa a TRAMITE antes de enviar (si otro lo tomó, no se envía nada).
  await moveLotToTramite(deal.lot.inventoryLotId, { dealId: deal.id, companyId: input.companyId, advisorName: actor.name }, actor);

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

/** Guarda documentos, estado del negocio y la marca de "en firma". */
async function saveSignatureState(ref: DocumentReference, deal: Deal) {
  const status = signatureDealStatus(deal);
  const pending = (deal.documents ?? []).some((d) => d.docublockDocumentId && isPendingSignature(d.signatureStatus));
  deal.status = status;
  await ref.update({ documents: deal.documents, status, signaturePending: pending, updatedAt: Timestamp.now() });
}

/**
 * Consulta en DocuBlock los documentos en firma del negocio y actualiza su avance.
 * Al quedar firmado, guarda el PDF firmado en Storage.
 */
export async function refreshSignatures(ref: DocumentReference, deal: Deal): Promise<{ changed: boolean }> {
  let changed = false;
  const companyId = deal.companyId;
  const updates: string[] = [];
  for (const doc of deal.documents ?? []) {
    if (!doc.docublockDocumentId || !isPendingSignature(doc.signatureStatus)) continue;
    try {
      const progress = documentProgress(await getDocument(doc.docublockDocumentId));
      const signers = (doc.signature?.signers ?? []).map((s) => {
        // DocuBlock conserva el correo que ya tenía la persona (si estaba registrada por su cédula),
        // así que se empareja por tipo de firmante (único en el documento, salvo "Avalador"), luego por correo o nombre.
        const key = (v: string) => placeKey(v);
        const sameType = progress.signers.filter((p) => key(p.typeSign) === key(s.typeSign));
        const match = (sameType.length === 1 ? sameType[0] : undefined)
          ?? progress.signers.find((p) => p.email && p.email.toLowerCase() === s.email.toLowerCase())
          ?? sameType.find((p) => key(p.name) === key(s.name));
        return match ? { ...s, signed: match.signed, docublockSignerId: match.endorsementId || s.docublockSignerId } : s;
      });
      const newlySigned = signers.filter((s, i) => s.signed && !doc.signature?.signers[i]?.signed).map((s) => s.name);
      doc.lastStatusCheckAt = Timestamp.now();
      if (doc.signature) doc.signature = { ...doc.signature, signers, expiresAt: progress.expiresAt, lastError: null };
      const label = doc.kind === 'preventa' ? 'Preventa' : 'Promesa';
      if (newlySigned.length) updates.push(`${label}: firmó ${newlySigned.join(', ')}`);
      if (progress.status === 'firmado') {
        // Solo queda "firmado" cuando el PDF firmado ya está en Storage (si falla, se reintenta).
        if (!progress.fileUrl) throw new Error('DocuBlock no entregó el archivo firmado');
        doc.signedPdfStoragePath = await saveSignedPdf(companyId, deal.id, doc, progress.fileUrl);
        doc.signedAt = Timestamp.now();
        doc.signatureStatus = 'firmado';
        updates.push(`${label} firmada por todos`);
      } else {
        doc.signatureStatus = progress.status;
      }
      if (progress.status === 'vencido') {
        updates.push(`${label}: venció el plazo de firma`);
      }
      changed = true;
    } catch (err) {
      logger.warn('[DealSignature] No se pudo consultar DocuBlock', { dealId: deal.id, kind: doc.kind, error: String(err) });
      if (doc.signature) doc.signature = { ...doc.signature, lastError: err instanceof Error ? err.message : String(err) };
      changed = true;
    }
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

async function saveSignedPdf(companyId: string, dealId: string, doc: DealDocument, url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`No se pudo descargar el PDF firmado (${res.status})`);
  const path = `companies/${companyId}/deals/${dealId}/${doc.kind}-v${doc.version}-firmado.pdf`;
  await storage.bucket().file(path).save(Buffer.from(await res.arrayBuffer()), { contentType: 'application/pdf', resumable: false });
  return path;
}

/** Se anuló en el panel de DocuBlock: el CRM lo marca y deja de consultarlo. */
export async function markSignatureCancelled(ref: DocumentReference, deal: Deal, kind: DealDocumentKind, actor: { uid: string; name: string }, reason: string) {
  const doc = signatureDocOf(deal, kind);
  if (!doc?.docublockDocumentId) throw new HttpsError('failed-precondition', 'Ese documento no se ha enviado a firma.');
  if (doc.signatureStatus === 'firmado') throw new HttpsError('failed-precondition', 'El documento ya está firmado.');
  doc.signatureStatus = 'anulado';
  await saveSignatureState(ref, deal);
  await dealActivityRef(deal.companyId, deal.leadId).set(dealActivityDoc({
    companyId: deal.companyId, leadId: deal.leadId, dealId: deal.id, actorId: actor.uid, actorName: actor.name,
    event: 'signature_update', title: `${kind === 'preventa' ? 'Preventa' : 'Promesa'}: firma anulada`, lines: [reason],
  }));
}
