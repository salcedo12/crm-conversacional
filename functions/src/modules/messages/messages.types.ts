import { Timestamp } from 'firebase-admin/firestore';
import type { LeadChannel } from '../leads/leads.types';

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
  /** Flag interno: evita doble procesamiento por el trigger de IA */
  aiProcessed?:     boolean;
  /** Media adjunta al mensaje */
  mediaUrl?:        string;   // URL pública para mostrar/descargar
  mediaType?:       string;   // MIME type: 'image/jpeg', 'video/mp4', 'audio/ogg', etc.
  mediaKind?:       MessageMediaKind; // tipo original de WhatsApp cuando está disponible
  mediaStoragePath?: string;  // Path en Firebase Storage (para gestión interna)
  createdAt:        Timestamp;
  metadata?:        Record<string, unknown>;
}

export type CreateMessageInput = Omit<Message, 'id'>;
