import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { PlanRow, SimpleInputs } from '../utils/paymentPlan';

/**
 * Módulo Negocios (Fase 1): ficha de compradores y negocio desde el lead.
 * Todo va por callables (functions/src/http/deals.function.ts): las fichas tienen
 * cédulas y las reglas de Firestore no exponen `clients`.
 */

export type PersonKind = 'natural' | 'juridica';
export type IdentificationKind = 'CC' | 'CE' | 'NIT' | 'PAS' | 'PPT' | 'TI';
export type MaritalStatus = 'soltero' | 'casado' | 'union_libre' | 'divorciado' | 'viudo' | 'separado';
export type Gender = 'masculino' | 'femenino' | 'otro';

export type DealStatus =
  | 'borrador'
  | 'plan_listo'
  | 'preventa_en_firma'
  | 'preventa_firmada'
  | 'promesa_en_firma'
  | 'promesa_firmada'
  | 'anulado';

export interface ClientInput {
  personKind:           PersonKind;
  firstNames:           string;
  lastNames:            string;
  birthDate?:           string;   // 'YYYY-MM-DD'
  maritalStatus?:       MaritalStatus;
  gender?:              Gender;
  residenceCity:        string;
  residenceCountry?:    string;
  address:              string;
  identificationKind:   IdentificationKind;
  identificationNumber: string;
  expeditionCity:       string;
  expeditionCountry?:   string;
  expeditionDate:       string;   // 'YYYY-MM-DD'
  mobile:               string;   // +57...
  email:                string;
}

export interface ClientProfile extends ClientInput {
  id:        string;
  leadIds:   string[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface DealLot {
  projectId:      string;
  sector:         string;
  lotNumber:      string;
  lotCode:        string;
  inventoryLotId: string;
  areaM2:         number;
  corner:         boolean;
  reservedUntil?: string;   // ISO
}

export interface PaymentPlan {
  lotId:       string;
  mode:        'simple' | 'especifico';
  simple?:     SimpleInputs;
  listPrice?:  number | null;
  landValue:   number;
  termMonths:  number;
  benefit:     number;
  severance:   { fundName: string; amount: number } | null;
  rows:        PlanRow[];
  referredBy?: string;
  notes?:      string;
}

export interface DealSummary {
  id:            string;
  leadId:        string;
  advisorId:     string;
  advisorName?:  string;
  leadName?:     string;
  status:        DealStatus;
  buyers:        Array<{ clientId: string; order: number }>;
  buyerNames?:   string[];
  buyerProfiles: ClientProfile[];
  lot:           DealLot | null;
  plan?:         PaymentPlan | null;
  documents?:    DealDocumentInfo[];
  attachments?:  DealAttachment[];
  cancelReason?: string;
  createdAt:     number | null;
  updatedAt:     number | null;
}

export type DealAttachmentCategory =
  | 'buyer_identification'
  | 'benefit_authorization'
  | 'referral_evidence'
  | 'separation_payment';

export interface DealAttachment {
  id:             string;
  category:       DealAttachmentCategory;
  fileName:       string;
  contentType:    string;
  size:           number;
  buyerClientId?: string;
  buyerName?:     string;
  paymentAmount?: number;
  paymentDate?:   string;
  note?:          string;
  uploadedAt:     number | null;
  uploadedBy:     string;
  uploadedByName: string;
}

export const MAX_BUYERS = 4;

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  borrador:          'Borrador',
  plan_listo:        'Plan listo',
  preventa_en_firma: 'Preventa en firma',
  preventa_firmada:  'Preventa firmada',
  promesa_en_firma:  'Promesa en firma',
  promesa_firmada:   'Promesa firmada',
  anulado:           'Anulado',
};

export const IDENTIFICATION_LABELS: Record<IdentificationKind, string> = {
  CC:  'Cédula de ciudadanía',
  CE:  'Cédula de extranjería',
  NIT: 'NIT',
  PAS: 'Pasaporte',
  PPT: 'Permiso de protección temporal',
  TI:  'Tarjeta de identidad',
};

export const MARITAL_LABELS: Record<MaritalStatus, string> = {
  soltero:     'Soltero(a)',
  casado:      'Casado(a)',
  union_libre: 'Unión libre',
  divorciado:  'Divorciado(a)',
  viudo:       'Viudo(a)',
  separado:    'Separado(a)',
};

export const GENDER_LABELS: Record<Gender, string> = {
  masculino: 'Masculino',
  femenino:  'Femenino',
  otro:      'Otro',
};

const _list   = httpsCallable<{ companyId: string; leadId: string }, { deals: DealSummary[] }>(functions, 'listLeadDeals');
const _listCompany = httpsCallable<{ companyId: string }, { deals: DealSummary[] }>(functions, 'listCompanyDeals');
const _create = httpsCallable<{ companyId: string; leadId: string }, { dealId: string }>(functions, 'createDeal');
const _find   = httpsCallable<
  { companyId: string; identificationKind: IdentificationKind; identificationNumber: string },
  { client: ClientProfile | null }
>(functions, 'findClientByIdentification');
const _saveBuyers = httpsCallable<{ companyId: string; dealId: string; buyers: ClientInput[] }, { ok: true }>(functions, 'saveDealBuyers');
const _cancel = httpsCallable<{ companyId: string; dealId: string; reason: string }, { ok: true }>(functions, 'cancelDeal');

export async function listLeadDeals(companyId: string, leadId: string): Promise<DealSummary[]> {
  const res = await _list({ companyId, leadId });
  return res.data.deals;
}

export async function listCompanyDeals(companyId: string): Promise<DealSummary[]> {
  return (await _listCompany({ companyId })).data.deals;
}

export async function createDeal(companyId: string, leadId: string): Promise<string> {
  const res = await _create({ companyId, leadId });
  return res.data.dealId;
}

export async function findClientByIdentification(
  companyId: string, identificationKind: IdentificationKind, identificationNumber: string,
): Promise<ClientProfile | null> {
  const res = await _find({ companyId, identificationKind, identificationNumber });
  return res.data.client;
}

export async function saveDealBuyers(companyId: string, dealId: string, buyers: ClientInput[]): Promise<void> {
  await _saveBuyers({ companyId, dealId, buyers });
}

export async function cancelDeal(companyId: string, dealId: string, reason: string): Promise<void> {
  await _cancel({ companyId, dealId, reason });
}

const _uploadAttachment = httpsCallable<{
  companyId: string;
  dealId: string;
  category: DealAttachmentCategory;
  fileName: string;
  contentType: string;
  base64: string;
  buyerClientId?: string;
  paymentAmount?: number;
  paymentDate?: string;
  note?: string;
}, { attachment: DealAttachment }>(functions, 'uploadDealAttachment');
const _downloadAttachment = httpsCallable<
  { companyId: string; dealId: string; attachmentId: string },
  { fileName: string; contentType: string; base64: string }
>(functions, 'downloadDealAttachment');
const _deleteAttachment = httpsCallable<
  { companyId: string; dealId: string; attachmentId: string }, { ok: true }
>(functions, 'deleteDealAttachment');

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function uploadDealAttachment(input: {
  companyId: string;
  dealId: string;
  category: DealAttachmentCategory;
  file: File;
  buyerClientId?: string;
  paymentAmount?: number;
  paymentDate?: string;
  note?: string;
}): Promise<DealAttachment> {
  if (input.file.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar máximo 10 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(input.file.type)) {
    throw new Error('Solo se permiten imágenes JPG, PNG, WEBP o archivos PDF.');
  }
  const result = await _uploadAttachment({
    companyId: input.companyId,
    dealId: input.dealId,
    category: input.category,
    fileName: input.file.name,
    contentType: input.file.type,
    base64: await fileBase64(input.file),
    ...(input.buyerClientId ? { buyerClientId: input.buyerClientId } : {}),
    ...(input.paymentAmount ? { paymentAmount: input.paymentAmount } : {}),
    ...(input.paymentDate ? { paymentDate: input.paymentDate } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  });
  return result.data.attachment;
}

export async function downloadDealAttachment(companyId: string, dealId: string, attachmentId: string): Promise<void> {
  const { fileName, contentType, base64 } = (await _downloadAttachment({ companyId, dealId, attachmentId })).data;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteDealAttachment(companyId: string, dealId: string, attachmentId: string): Promise<void> {
  await _deleteAttachment({ companyId, dealId, attachmentId });
}

/** '3001112233' → '+573001112233'; deja intacto lo que ya trae indicativo. */
export function normalizeMobile(value: string): string {
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^3\d{9}$/.test(digits)) return `+57${digits}`;
  if (/^57\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

/** Campos que faltan para que la ficha sea válida (misma regla que el backend). */
export function missingClientFields(client: ClientInput): string[] {
  const missing: string[] = [];
  const req = (ok: unknown, label: string) => { if (!ok) missing.push(label); };
  const natural = client.personKind === 'natural';
  req(client.firstNames.trim(), natural ? 'nombres' : 'razón social');
  if (natural) {
    req(client.lastNames.trim(), 'apellidos');
    req(client.birthDate, 'fecha de nacimiento');
    req(client.maritalStatus, 'estado civil');
    req(client.gender, 'género');
  }
  req(client.residenceCity.trim(), 'ciudad de residencia');
  req(client.address.trim(), 'dirección');
  req(client.identificationNumber.trim().length >= 3, 'número de identificación');
  req(client.expeditionCity.trim(), 'ciudad de expedición');
  req(client.expeditionDate, 'fecha de expedición');
  req(/^\+\d{8,15}$/.test(client.mobile), 'celular');
  req(/^\S+@\S+\.\S+$/.test(client.email.trim()), 'correo');
  return missing;
}

// ─── Lote del inventario de disponibilidad (Fase 2) ──────────────────────────

export interface InventoryProject {
  id:        string;
  name:      string;
  available: number;
  sectors:   Array<{ name: string; available: number }>;
}

export interface AvailableLot {
  id:     string;
  sector: string;
  number: string;
  code:   string;
  areaM2: number;
  corner: boolean;
}

export type DealLotState = 'sin_lote' | 'reservado' | 'vencido' | 'tomado' | 'no_existe';

const _projects = httpsCallable<{ companyId: string }, { projects: InventoryProject[] }>(functions, 'listInventoryProjects');
const _lots     = httpsCallable<{ companyId: string; projectId: string }, { lots: AvailableLot[]; updatedAt: string | null }>(functions, 'listAvailableLots');
const _reserve  = httpsCallable<{ companyId: string; dealId: string; lotId: string }, { lot: DealLot }>(functions, 'reserveDealLot');
const _release  = httpsCallable<{ companyId: string; dealId: string }, { ok: true }>(functions, 'releaseDealLot');
const _lotState = httpsCallable<
  { companyId: string; dealId: string },
  { state: DealLotState; status?: string; expiresAt?: string }
>(functions, 'getDealLotStatus');

export async function listInventoryProjects(companyId: string): Promise<InventoryProject[]> {
  return (await _projects({ companyId })).data.projects;
}

export async function listAvailableLots(companyId: string, projectId: string) {
  return (await _lots({ companyId, projectId })).data;
}

export async function reserveDealLot(companyId: string, dealId: string, lotId: string): Promise<DealLot> {
  return (await _reserve({ companyId, dealId, lotId })).data.lot;
}

export async function releaseDealLot(companyId: string, dealId: string): Promise<void> {
  await _release({ companyId, dealId });
}

export async function getDealLotStatus(companyId: string, dealId: string) {
  return (await _lotState({ companyId, dealId })).data;
}

/** '313.6' → '313,6 m²' */
export function formatArea(areaM2: number): string {
  return `${areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²`;
}

// ─── Plan de negocio (Fase 3) ─────────────────────────────────────────────────

export interface PriceOption { termMonths: number; price: number }

const _prices   = httpsCallable<{ companyId: string; dealId: string }, { options: PriceOption[]; earnestPercent: number }>(functions, 'getDealPriceOptions');
const _savePlan = httpsCallable<{ companyId: string; dealId: string; plan: Omit<PaymentPlan, 'lotId'> }, { ok: true; status: DealStatus }>(functions, 'saveDealPlan');

export async function getDealPriceOptions(companyId: string, dealId: string) {
  return (await _prices({ companyId, dealId })).data;
}

export async function saveDealPlan(companyId: string, dealId: string, plan: Omit<PaymentPlan, 'lotId'>): Promise<DealStatus> {
  return (await _savePlan({ companyId, dealId, plan })).data.status;
}

// ─── Documentos: preventa y promesa (Fase 4) ─────────────────────────────────

export type DealDocumentKind = 'preventa' | 'promesa';

export type SignatureStatus = 'generado' | 'en_firma' | 'firmado_parcial' | 'firmado' | 'rechazado' | 'vencido' | 'anulado';

export interface DealSignatureSigner {
  source:    'buyer' | 'docublock_user';
  refId:     string;
  name:      string;
  email:     string;
  typeSign:  string;
  iteration: number;
  signed:    boolean;
  docublockSignerId?: string;
}

export interface DealSignatureInfo {
  templateName:     string;
  directoryName:    string;
  responsibleName?: string;
  requirePhoto:     boolean;
  signers:          DealSignatureSigner[];
  expiresAt?:       string | null;
  lastError?:       string | null;
}

export interface DealDocumentInfo {
  kind:            DealDocumentKind;
  version:         number;
  snapshotHash:    string;
  signatureStatus: SignatureStatus;
  generatedAt:     number | null;
  sentAt?:         number | null;
  signedAt?:       number | null;
  lastStatusCheckAt?: number | null;
  docublockDocumentId?: string;
  signedPdfStoragePath?: string;
  signature?:      DealSignatureInfo;
}

// ─── Firma con DocuBlock (Fase 5) ────────────────────────────────────────────

export interface SignatureOptions {
  templates:   Array<{ id: string; name: string; directoryId: string; signerTypes: Array<{ name: string; principal: boolean; required: boolean }> }>;
  directories: Array<{ id: string; name: string }>;
  /** Usuarios de DocuBlock (responsables). `signer`: firmante de la empresa, con su `role`. */
  users:       Array<{ id: string; name: string; email: string; role: string; signer: boolean; complete: boolean }>;
}

export interface SendToSignatureInput {
  documents:     Array<{ kind: DealDocumentKind; version?: number | null; templateId: string; directoryId: string }>;
  signers:       Array<{ source: 'buyer' | 'docublock_user'; refId: string; typeSigns: Partial<Record<DealDocumentKind, string>>; iteration: number }>;
  responsibleId?: string;
  requirePhoto:  boolean;
}

const _signatureOptions = httpsCallable<{ companyId: string }, SignatureOptions>(functions, 'getDealSignatureOptions', { timeout: 60_000 });
const _sendToSignature = httpsCallable<SendToSignatureInput & { companyId: string; dealId: string }, { sent: DealDocumentKind[] }>(functions, 'sendDealToSignature', { timeout: 180_000 });
const _refreshSignature = httpsCallable<{ companyId: string; dealId: string }, { status: DealStatus }>(functions, 'refreshDealSignature', { timeout: 120_000 });
const _resendSignature = httpsCallable<{ companyId: string; dealId: string; kind: DealDocumentKind; signerId: string }, { ok: true }>(functions, 'resendDealSignature');
const _cancelSignature = httpsCallable<{ companyId: string; dealId: string; kind: DealDocumentKind; reason: string }, { status: DealStatus }>(functions, 'markDealSignatureCancelled');

export async function getSignatureOptions(companyId: string): Promise<SignatureOptions> {
  return (await _signatureOptions({ companyId })).data;
}
export async function sendDealToSignature(companyId: string, dealId: string, input: SendToSignatureInput) {
  return (await _sendToSignature({ companyId, dealId, ...input })).data;
}
export async function refreshDealSignature(companyId: string, dealId: string) {
  return (await _refreshSignature({ companyId, dealId })).data;
}
export async function resendDealSignature(companyId: string, dealId: string, kind: DealDocumentKind, signerId: string) {
  await _resendSignature({ companyId, dealId, kind, signerId });
}
export async function markDealSignatureCancelled(companyId: string, dealId: string, kind: DealDocumentKind, reason: string) {
  return (await _cancelSignature({ companyId, dealId, kind, reason })).data;
}

const _generate = httpsCallable<
  { companyId: string; dealId: string; kind: DealDocumentKind },
  { kind: DealDocumentKind; version: number; fileName: string; snapshotHash: string }
>(functions, 'generateDealDocument');
const _download = httpsCallable<
  { companyId: string; dealId: string; kind: DealDocumentKind; version: number; format?: 'docx' | 'pdf' | 'signed' },
  { fileName: string; mimeType: string; base64: string }
>(functions, 'downloadDealDocument', { timeout: 120_000 });

export async function generateDealDocument(companyId: string, dealId: string, kind: DealDocumentKind) {
  return (await _generate({ companyId, dealId, kind })).data;
}

/** El documento generado como PDF (convertido en nuestro servidor) para verlo tal como se imprime. */
export async function fetchDealDocumentPdf(companyId: string, dealId: string, kind: DealDocumentKind, version: number, signed = false): Promise<{ fileName: string; blob: Blob }> {
  const { fileName, mimeType, base64 } = (await _download({ companyId, dealId, kind, version, format: signed ? 'signed' : 'pdf' })).data;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { fileName, blob: new Blob([bytes], { type: mimeType }) };
}

export function saveDealDocument(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Descarga el Word generado y lo entrega al navegador como archivo. */
export async function downloadDealDocument(companyId: string, dealId: string, kind: DealDocumentKind, version: number): Promise<void> {
  const { fileName, mimeType, base64 } = (await _download({ companyId, dealId, kind, version })).data;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface DocuBlockCountry { name: string; cities: string[] }

const _docublockPlaces = httpsCallable<{ companyId: string }, { countries: DocuBlockCountry[] }>(functions, 'getDocuBlockCities', { timeout: 60_000 });

/** Países y ciudades con el nombre exacto de DocuBlock (Colombia primero), para la ficha del comprador. */
export async function getDocuBlockPlaces(companyId: string): Promise<DocuBlockCountry[]> {
  return (await _docublockPlaces({ companyId })).data.countries;
}
