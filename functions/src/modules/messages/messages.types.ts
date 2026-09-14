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
  /** Motivo legible del fallo de entrega (WhatsApp/Meta) cuando status === 'failed'. */
  failureReason?:   string;
  /** Código de error de Meta/WhatsApp del fallo (p.ej. "131049"). */
  failureCode?:     string;
  advisorId?:       string;
  /** Flag interno: evita doble procesamiento por el trigger de IA */
  aiProcessed?:     boolean;
  /** Media adjunta al mensaje */
  mediaUrl?:        string;   // URL pública para mostrar/descargar
  mediaType?:       string;   // MIME type: 'image/jpeg', 'video/mp4', 'audio/ogg', etc.
  fileName?:        string;   // Nombre original del archivo (documentos); se manda a WhatsApp como filename
  mediaKind?:       MessageMediaKind; // tipo original de WhatsApp cuando está disponible
  mediaStoragePath?: string;  // Path en Firebase Storage (para gestión interna)
  /** Media aún no re-alojada: la sube el trigger onMediaRehost en segundo plano. */
  mediaPending?:    boolean;
  /** URL temporal de origen (ycloud) para que el trigger descargue y re-aloje la media. */
  mediaSourceUrl?:  string;
  /** Reintentos de re-alojo ya hechos (para desistir tras N y no reintentar por siempre). */
  mediaRehostAttempts?: number;
  createdAt:        Timestamp;
  metadata?:        Record<string, unknown>;
}

export type CreateMessageInput = Omit<Message, 'id'>;
