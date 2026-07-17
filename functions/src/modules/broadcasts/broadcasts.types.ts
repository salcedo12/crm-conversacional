import { Timestamp } from 'firebase-admin/firestore';

export type BroadcastStatus = 'queued' | 'processing' | 'sending' | 'completed' | 'failed';

/** Filtro de audiencia de un envío masivo. */
export interface BroadcastAudience {
  type:  'all' | 'status' | 'tag' | 'list';
  value?: string;   // estado, etiqueta o lista (no aplica para 'all')
}

/** Error individual de un destinatario (se guardan acotados). */
export interface BroadcastError {
  leadId: string;
  phone:  string;
  error:  string;
}

export interface Broadcast {
  id:           string;
  companyId:    string;
  templateId:   string;
  templateName: string;
  audience:     BroadcastAudience;
  /** Variables estáticas aplicadas a todos (además de las auto por lead). */
  variables:    Record<string, string>;
  total:        number;   // destinatarios resueltos
  sent:         number;
  delivered?:   number;
  read?:        number;
  undelivered?: number;
  failed:       number;
  status:       BroadcastStatus;
  cursor?:      string;
  createdBy:    string;   // uid del admin/manager
  createdAt:    Timestamp;
  updatedAt?:    Timestamp;
  completedAt?: Timestamp;
  errors?:      BroadcastError[];
}

export type CreateBroadcastInput = Omit<Broadcast, 'id'>;
