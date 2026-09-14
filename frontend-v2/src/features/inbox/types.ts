import type { Timestamp } from 'firebase/firestore';

export type LeadStatus  = 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
export type LeadSource  = 'whatsapp' | 'manual' | 'web' | 'facebook' | 'instagram' | 'meta_ads' | 'advisor_whatsapp';
export type InboxProvider = 'ycloud' | 'twilio';

/** Canal de mensajería del lead. Ausente = 'whatsapp' (leads creados antes de esta migración). */
export type LeadChannel = 'whatsapp' | 'messenger' | 'instagram';

/** Datos del anuncio de origen cuando source = 'meta_ads' (click to WhatsApp). */
export interface LeadSourceMeta {
  adId?:      string;
  headline?:  string;
  sourceUrl?: string;
  mediaType?: string;
  ctwaClid?:  string;
}

export interface Lead {
  id:               string;
  companyId:        string;
  name?:            string;
  /** E.164 para WhatsApp. Sentinel '' para Messenger/Instagram (ver `channel`/`externalId`). */
  phone:            string;
  normalizedPhone:  string;
  status:           LeadStatus;
  source:           LeadSource;
  /** Detalle del anuncio de Meta que originó el lead (solo si source = 'meta_ads') */
  sourceMeta?:      LeadSourceMeta;
  /** Número de negocio (E.164) que recibió esta conversación */
  inboxId?:         string;
  /** Proveedor/canal por el que entró y sale la conversación (solo WhatsApp) */
  inboxProvider?:   InboxProvider;
  /** Canal de mensajería. Ausente = 'whatsapp'. */
  channel?:         LeadChannel;
  /** PSID (Messenger) o IGSID (Instagram). Solo si channel !== 'whatsapp'. */
  externalId?:      string;
  assignedTo?:      string;
  /** true = asesor fijado manualmente; bloquea la reasignacion automatica. */
  assignmentLocked?: boolean;
  aiEnabled:        boolean;
  takeoverBy?:      string;
  lastMessageText?: string;
  lastMessageAt?:   Timestamp;
  /** Primer mensaje humano enviado por un asesor. Bloquea la reasignacion automatica por falta de contacto. */
  advisorFirstContactAt?: Timestamp;
  /** Asesor que hizo el primer contacto humano con el lead. */
  advisorFirstContactBy?: string;
  /** Ultimo mensaje humano enviado por un asesor. */
  lastAdvisorMessageAt?:  Timestamp;
  lastInboundAt?:   Timestamp;
  readBy?:          Record<string, Timestamp>;
  createdAt:        Timestamp;
  updatedAt:        Timestamp;
  tags:             string[];
  listIds?:         string[];
  metadata:         Record<string, string>;
  /** Permiso de llamada de voz WhatsApp otorgado por el lead (requerido para llamar saliente). */
  callPermission?:  LeadCallPermission;
  /** Radiografía IA más reciente del lead. */
  aiAnalysis?:      LeadAnalysis;
  smartHomeCustomerId?: string;
  smartHomeProspectId?: string;
  smartHomeProjectCode?: string;
  smartHomeAdvisorId?: string;
  smartHomeSyncAttemptedAt?: Timestamp;
  smartHomeSyncedAt?:   Timestamp;
  smartHomeSyncError?:  string;
  smartHomeDuplicateMatches?: SmartHomeDuplicateMatch[];
}

export interface SmartHomeDuplicateMatch {
  prospectId?:    string;
  customerId?:    string;
  ownerId?:       string;
  ownerName?:     string;
  firstName?:     string;
  lastName?:      string;
  mobileNumber?:  string;
  phoneNumber?:   string;
  email?:         string;
  moduleName?:    string;
  projectName?:   string;
  stageName?:     string;
  saleCycleName?: string;
}

export interface LeadCallPermission {
  granted:          boolean;
  isPermanent?:     boolean;
  expiresAt?:       Timestamp | null;
  grantedAt?:       Timestamp;
  lastRequestedAt?: Timestamp;
}

export type LeadTemperature = 'hot' | 'warm' | 'cold';

export type LeadLossCategory =
  | 'precio' | 'ubicacion' | 'competencia' | 'sin_respuesta'
  | 'tiempo' | 'no_califica' | 'atencion' | 'otro' | 'ninguno';

/** Estado comercial que la IA sugiere según la conversación ('ninguno' = sin cambio). */
export type LeadSuggestedStatus =
  | 'active' | 'qualified' | 'scheduled' | 'lost' | 'ninguno';

/** Radiografía IA del lead (score + análisis de la conversación) guardada en el doc. */
export interface LeadAnalysis {
  score:            number;
  temperature:      LeadTemperature;
  summary:          string;
  interestLevel:    string;
  buyingSignals:    string[];
  objections:       string[];
  budget:           string | null;
  interestArea:     string | null;
  nextAction:       string;
  nextActionReason: string;
  lossRisk:         string;
  lossCategory:     LeadLossCategory;
  scoreReasons:     string[];
  /** Estado comercial sugerido por la IA ('ninguno' o ausente = sin sugerencia). */
  suggestedStatus?:       LeadSuggestedStatus;
  /** Motivo del estado sugerido. */
  suggestedStatusReason?: string;
  messageCount:     number;
  model:            string;
  analyzedBy:       string;
  analyzedAt:       Timestamp;
}

export type MessageDirection  = 'inbound' | 'outbound';
export type MessageSenderType = 'lead' | 'ai' | 'advisor' | 'system';
export type MessageStatus     = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageMediaKind  = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'file';

export interface Message {
  id:               string;
  companyId:        string;
  leadId:           string;
  direction:        MessageDirection;
  senderType:       MessageSenderType;
  content:          string;
  channel:          LeadChannel;
  status:           MessageStatus;
  twilioMessageSid?: string;
  /** Motivo legible del fallo de entrega cuando status === 'failed'. */
  failureReason?:   string;
  /** Código de error de Meta/WhatsApp del fallo (p.ej. "131049"). */
  failureCode?:     string;
  advisorId?:       string;
  aiProcessed?:     boolean;
  mediaUrl?:        string;
  mediaType?:       string;
  fileName?:        string;
  mediaKind?:       MessageMediaKind;
  mediaStoragePath?: string;
  /** Media aún subiéndose en segundo plano (se muestra "cargando"). */
  mediaPending?:    boolean;
  /** Reacción (emoji) que el asesor puso a este mensaje del lead. Vacío/ausente = sin reacción. */
  reaction?:        string;
  reactionBy?:      string;
  reactionAt?:      Timestamp;
  createdAt:        Timestamp;
  metadata?:        Record<string, unknown>;
}
