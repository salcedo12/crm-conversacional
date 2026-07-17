import type { Timestamp } from 'firebase/firestore';

export type LeadStatus  = 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
export type LeadSource  = 'whatsapp' | 'manual' | 'web' | 'facebook' | 'instagram' | 'meta_ads';
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
  aiEnabled:        boolean;
  takeoverBy?:      string;
  lastMessageText?: string;
  lastMessageAt?:   Timestamp;
  lastInboundAt?:   Timestamp;
  createdAt:        Timestamp;
  updatedAt:        Timestamp;
  tags:             string[];
  listIds?:         string[];
  metadata:         Record<string, string>;
  /** Permiso de llamada de voz WhatsApp otorgado por el lead (requerido para llamar saliente). */
  callPermission?:  LeadCallPermission;
}

export interface LeadCallPermission {
  granted:          boolean;
  isPermanent?:     boolean;
  expiresAt?:       Timestamp | null;
  grantedAt?:       Timestamp;
  lastRequestedAt?: Timestamp;
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
  advisorId?:       string;
  aiProcessed?:     boolean;
  mediaUrl?:        string;
  mediaType?:       string;
  mediaKind?:       MessageMediaKind;
  mediaStoragePath?: string;
  createdAt:        Timestamp;
  metadata?:        Record<string, unknown>;
}
