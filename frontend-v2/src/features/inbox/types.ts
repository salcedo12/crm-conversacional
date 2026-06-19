import type { Timestamp } from 'firebase/firestore';

export type LeadStatus  = 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
export type LeadSource  = 'whatsapp' | 'manual' | 'web' | 'facebook' | 'instagram';

export interface Lead {
  id:               string;
  companyId:        string;
  name?:            string;
  phone:            string;
  normalizedPhone:  string;
  status:           LeadStatus;
  source:           LeadSource;
  assignedTo?:      string;
  aiEnabled:        boolean;
  takeoverBy?:      string;
  lastMessageText?: string;
  lastMessageAt?:   Timestamp;
  lastInboundAt?:   Timestamp;
  createdAt:        Timestamp;
  updatedAt:        Timestamp;
  tags:             string[];
  metadata:         Record<string, string>;
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
  channel:          'whatsapp';
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
