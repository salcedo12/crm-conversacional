import { Timestamp } from 'firebase-admin/firestore';

export type FollowUpStatus = 'pending' | 'sent' | 'cancelled';

export interface FollowUpTask {
  id:               string;
  companyId:        string;
  leadId:           string;
  stepIndex:        number;    // índice 0-based dentro de la secuencia
  scheduledAt:      Timestamp; // cuándo ejecutar
  aiMessageSentAt:  Timestamp; // timestamp del msg IA que disparó esta tarea
  status:           FollowUpStatus;
  createdAt:        Timestamp;
}

export type CreateFollowUpTaskInput = Omit<FollowUpTask, 'id'>;
