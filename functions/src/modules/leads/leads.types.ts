import { Timestamp } from 'firebase-admin/firestore';
import type { LeadAnalysis } from '../ai/leadAnalysis.types';

export type LeadStatus = 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
export type LeadSource = 'whatsapp' | 'manual' | 'web' | 'facebook' | 'instagram' | 'meta_ads';

/** Proveedor/canal por el que entró y debe salir la conversación. */
export type InboxProvider = 'ycloud' | 'twilio';

/** Canal de mensajería del lead. Ausente = 'whatsapp' (leads creados antes de esta migración). */
export type LeadChannel = 'whatsapp' | 'messenger' | 'instagram';

/** Datos del anuncio de origen cuando source = 'meta_ads' (click to WhatsApp). */
export interface LeadSourceMeta {
  adId?:      string;   // referral.source_id
  headline?:  string;   // referral.headline
  sourceUrl?: string;   // referral.source_url
  mediaType?: string;   // referral.media_type
  ctwaClid?:  string;   // referral.ctwa_clid — click id para atribución de conversiones
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

export interface Lead {
  id:               string;
  companyId:        string;
  name?:            string;
  /**
   * E.164 para leads de WhatsApp: +573213443603.
   * Sentinel '' para leads de Messenger/Instagram (no tienen teléfono) — ver `channel`/`externalId`.
   */
  phone:            string;
  normalizedPhone:  string;           // lowercase, para queries. '' si no aplica (ver `phone`)
  status:           LeadStatus;
  source:           LeadSource;
  /** Detalle del anuncio de Meta que originó el lead (solo si source = 'meta_ads') */
  sourceMeta?:      LeadSourceMeta;
  /** Número de negocio (E.164) que recibió esta conversación. Ej: +573148209662 */
  inboxId?:         string;
  /** Proveedor por el que entró/sale la conversación (define el número de salida, solo WhatsApp) */
  inboxProvider?:   InboxProvider;
  /** Canal de mensajería. Ausente = 'whatsapp' (compatibilidad con leads existentes). */
  channel?:         LeadChannel;
  /** PSID (Messenger) o IGSID (Instagram) — id del usuario en la plataforma. Solo si channel !== 'whatsapp'. */
  externalId?:      string;
  /** Campo de búsqueda `${channel}:${externalId}` para lookup de un solo campo. Solo si channel !== 'whatsapp'. */
  channelExternalId?: string;
  assignedTo?:      string;           // userId del asesor asignado
  aiEnabled:        boolean;          // true = IA responde automáticamente
  takeoverBy?:      string;           // userId que tomó control manual
  /** Control de costo IA: nº de respuestas automáticas en la ventana horaria actual. */
  aiHourlyCount?:       number;
  /** Inicio de la ventana horaria del contador anti-loop de la IA. */
  aiHourlyWindowStart?: Timestamp;
  lastMessageText?: string;
  lastMessageAt?:   Timestamp;
  /** Último mensaje ENTRANTE del lead — usado para calcular la ventana de 24h de WhatsApp */
  lastInboundAt?:   Timestamp;
  readBy?:          Record<string, Timestamp>;
  createdAt:        Timestamp;
  updatedAt:        Timestamp;
  tags:             string[];
  listIds?:         string[];
  metadata:         Record<string, string>;
  /** Permiso de llamada de voz WhatsApp otorgado por el lead (requerido para llamar saliente). */
  callPermission?:  LeadCallPermission;
  /** Radiografía IA más reciente del lead (score + análisis de la conversación). */
  aiAnalysis?:      LeadAnalysis;
  /** Conversiones ya enviadas a Meta (CAPI) por nombre de evento — idempotencia. */
  capiEvents?:      Record<string, Timestamp>;
  /** Id del cliente/prospecto creado en SmartHome (idempotencia; ausente = no sincronizado). */
  smartHomeCustomerId?: string;
  /** Cuándo se creó en SmartHome. */
  smartHomeSyncedAt?:   Timestamp;
  /** Último error de sincronización con SmartHome (vacío = sin error). */
  smartHomeSyncError?:  string;
  /** Coincidencias encontradas en SmartHome cuando se bloquea una creacion por duplicado. */
  smartHomeDuplicateMatches?: SmartHomeDuplicateMatch[];
}

export interface LeadCallPermission {
  granted:          boolean;
  isPermanent?:     boolean;
  expiresAt?:       Timestamp | null;
  grantedAt?:       Timestamp;
  lastRequestedAt?: Timestamp;
}

export type CreateLeadInput = Omit<Lead, 'id'>;
export type UpdateLeadInput = Partial<Omit<Lead, 'id' | 'companyId' | 'createdAt' | 'normalizedPhone' | 'phone'>>;
