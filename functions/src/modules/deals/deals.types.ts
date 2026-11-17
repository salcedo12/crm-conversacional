import { Timestamp } from 'firebase-admin/firestore';

/**
 * Módulo Negocios: del lead que va a comprar a la preventa y la promesa firmadas.
 * Plan y decisiones en PLAN-gestion-comercial-contratos.md (raíz del repo).
 *
 * Colecciones (por empresa):
 *   companies/{companyId}/clients/{clientId}  — ficha de cada comprador (se reutiliza entre negocios)
 *   companies/{companyId}/deals/{dealId}      — negocio: compradores, lote, plan y documentos
 *
 * Las fechas del plan son fechas civiles 'YYYY-MM-DD' (sin hora ni zona) para que
 * no se corran un día al pasar por UTC.
 */

export type PersonKind = 'natural' | 'juridica';
export type IdentificationKind = 'CC' | 'CE' | 'NIT' | 'PAS' | 'PPT' | 'TI';
export type MaritalStatus = 'soltero' | 'casado' | 'union_libre' | 'divorciado' | 'viudo' | 'separado';
export type Gender = 'masculino' | 'femenino' | 'otro';

/** Ficha del comprador. Única por (identificationKind, identificationNumber) dentro de la empresa. */
export interface ClientProfile {
  id:                   string;
  companyId:            string;
  personKind:           PersonKind;
  firstNames:           string;
  lastNames:            string;
  birthDate?:           string;   // 'YYYY-MM-DD'
  maritalStatus?:       MaritalStatus;
  gender?:              Gender;
  residenceCity:        string;
  residenceCountry?:    string;   // como en DocuBlock; sin valor = Colombia
  address:              string;
  identificationKind:   IdentificationKind;
  identificationNumber: string;
  expeditionCity:       string;
  expeditionCountry?:   string;
  expeditionDate:       string;   // 'YYYY-MM-DD'
  mobile:               string;   // E.164
  email:                string;
  leadIds:              string[]; // leads del CRM vinculados a esta persona
  createdAt:            Timestamp;
  updatedAt:            Timestamp;
}

/** Comprador dentro de un negocio. El orden define "cliente", "cliente 2", "cliente 3"... */
export interface DealBuyer {
  clientId:  string;
  order:     number;   // 1 = titular
}

/** Lote tomado del inventario de disponibilidad (proyectos_resumen / inventario). */
export interface DealLot {
  projectId:     string;   // id del inventario: 'laguna-mar', 'cañon-arizona', ...
  sector:        string;   // 'MAR CANARIAS'
  lotNumber:     string;   // '053'
  lotCode:       string;   // código del terreno ('110542')
  inventoryLotId: string;  // id del doc en `inventario`
  areaM2:        number;
  corner:        boolean;  // esquinero
  reservedUntil?: string;  // ISO: vencimiento de la reserva en NEGOCIACION
}

export type InstallmentKind = 'separacion' | 'ordinaria' | 'extraordinaria' | 'bono';

/**
 * Una fila del plan tal como la digita el asesor (modo "específico" de SmartHome):
 * `count` cuotas mensuales de `amount`, la primera en `firstDate`.
 */
export interface PlanRow {
  kind:      InstallmentKind;
  count:     number;
  amount:    number;
  firstDate: string;   // 'YYYY-MM-DD'
}

/** Una cuota individual, ya expandida. */
export interface Installment {
  kind:   InstallmentKind;
  amount: number;
  date:   string;      // 'YYYY-MM-DD'
}

export interface Severance {
  fundName: string;    // fondo de cesantías
  amount:   number;
}

/** Datos del modo "simple" (como SmartHome): con ellos se generan las filas del plan. */
export interface SimplePlanInputs {
  separationTotal:     number;
  separationCount:     number;
  separationFirstDate: string;
  /** Pagos con valor y fecha independientes; ausente en negocios creados antes de esta opción. */
  separationPayments?: Array<{ amount: number; date: string }>;
  ordinaryCount:       number;
  ordinaryFirstDate:   string;
  ordinaryMode?:       'automatico' | 'rangos';
  ordinaryRanges?:     Array<{ amount: number; fromDate: string; toDate: string }>;
  extraordinary:       Array<{ amount: number; date: string }>;
}

export interface PaymentPlan {
  /** Lote para el que se hizo el plan: si el negocio cambia de lote, el plan hay que revisarlo. */
  lotId:       string;
  mode:        'simple' | 'especifico';
  simple?:     SimplePlanInputs;
  listPrice?:  number | null;    // precio de lista sugerido para ese plazo (referencia)
  landValue:   number;           // VALOR DEL TERRENO (según plazo en la lista de precios)
  termMonths:  number;           // plazo en meses (de la lista o el negociado si es especial)
  /** Plazo/valor por fuera de la lista de precios, aprobado por gerencia. null/ausente = de lista. */
  specialTerm?: { approvedBy: string } | null;
  benefit:     number;           // BENEFICIO
  severance:   Severance | null; // CESANTÍAS
  rows:        PlanRow[];
  referredBy?: string;
  notes?:      string;           // OBSERVACIONES
}

export type DealStatus =
  | 'borrador'
  | 'plan_listo'          // ficha + lote + plan válidos; lote reservado
  | 'preventa_en_firma'
  | 'preventa_firmada'    // lote VENDIDO; se genera la promesa
  | 'promesa_en_firma'
  | 'promesa_firmada'
  | 'anulado';

export type DealDocumentKind = 'preventa' | 'promesa';

export type SignatureStatus = 'generado' | 'en_firma' | 'firmado_parcial' | 'firmado' | 'rechazado' | 'vencido' | 'anulado';

export interface DocumentLot {
  projectId?: string;
  sector: string;
  lotNumber: string;
  lotCode?: string;
  inventoryLotId?: string;
}

export interface DealDocument {
  kind:               DealDocumentKind;
  version:            number;
  /** sha256 de los datos con que se generó: la promesa debe salir del mismo snapshot que la preventa firmada. */
  snapshotHash:       string;
  /** Word generado y los datos con que se generó (JSON), en Storage. */
  docxStoragePath:    string;
  dataStoragePath:    string;
  generatedAt:        Timestamp;
  generatedBy:        string;
  pdfStoragePath?:    string;
  signedPdfStoragePath?: string;
  signatureStatus:    SignatureStatus;
  docublockDocumentId?: string;
  sentAt?:            Timestamp;
  signedAt?:          Timestamp;
  lastStatusCheckAt?: Timestamp;
  /** Envío a DocuBlock: plantilla, directorio y firmantes con su avance. */
  signature?:         DealSignature;
  lot?:               DocumentLot | null;
  superseded?:        { at: Timestamp; reason: string } | null;
}

export interface DealSignatureSigner {
  source:        'buyer' | 'docublock_user';
  /** clientId del comprador o _id del usuario de DocuBlock. */
  refId:         string;
  name:          string;
  email:         string;
  typeSign:      string;
  iteration:     number;
  signed:        boolean;
  /** id del firmante en DocuBlock (para reenviar la invitación). */
  docublockSignerId?: string;
}

export interface DealSignature {
  templateId:     string;
  templateName:   string;
  directoryId:    string;
  directoryName:  string;
  responsibleId?: string;
  responsibleName?: string;
  requirePhoto:   boolean;
  signers:        DealSignatureSigner[];
  sentBy:         string;
  expiresAt?:     string | null;
  /** Envíos anteriores de este mismo documento (vencidos, rechazados o anulados). */
  previousDocumentIds?: string[];
  lastError?:     string | null;
}

export type DealAttachmentCategory =
  | 'buyer_identification'
  | 'benefit_authorization'
  | 'referral_evidence'
  | 'separation_payment';

/** Soporte privado del negocio (cédula, autorización, referido o pago). */
export interface DealAttachment {
  id:             string;
  category:       DealAttachmentCategory;
  fileName:       string;
  contentType:    string;
  size:           number;
  storagePath:    string;
  buyerClientId?: string;
  buyerName?:     string;
  paymentAmount?: number;
  paymentDate?:   string;
  note?:          string;
  lot?:           DocumentLot | null;
  uploadedAt:     Timestamp;
  uploadedBy:     string;
  uploadedByName: string;
}

export interface DealPlanApproval {
  id:              string;
  token?:          string;
  status:          'pending' | 'approved' | 'rejected';
  approverPhone:   string;
  approverName?:   string;
  requestedAt:     Timestamp;
  resolvedAt?:     Timestamp | null;
  resolvedBy?:     string | null;
  responseNotes?:  string | null;
}

export interface Deal {
  id:          string;
  companyId:   string;
  leadId:      string;
  advisorId:   string;
  status:      DealStatus;
  buyers:      DealBuyer[];
  buyerNames?: string[];   // denormalizado para listados
  lot:         DealLot | null;
  plan:        PaymentPlan | null;
  planApproval?: DealPlanApproval | null;
  documents:   DealDocument[];
  attachments?: DealAttachment[];
  cancelReason?: string;
  lotsBackfilled?: boolean;
  /** true mientras algún documento esté en firma (lo consulta la tarea periódica). */
  signaturePending?: boolean;
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}
