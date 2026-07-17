import { Timestamp } from 'firebase-admin/firestore';

export type AppointmentStatus = 'scheduled' | 'canceled' | 'completed';

export interface Appointment {
  id:             string;
  companyId:      string;
  leadId:         string;
  advisorId?:     string;   // asesor asignado (dueño del calendario)
  leadName?:      string;
  leadPhone:      string;
  title:          string;
  description?:   string;
  startTime:      Timestamp;
  endTime:        Timestamp;
  googleEventId?: string;
  googleMeetLink?: string;
  status:         AppointmentStatus;
  /** 'ai' = agendada por el asistente virtual; 'manual' = por un asesor */
  source?:        'ai' | 'manual';
  /** Recordatorios ya enviados (anti-duplicado) */
  remindersSent?: { h24?: boolean; h2?: boolean; m30?: boolean };
  createdAt:      Timestamp;
  updatedAt:      Timestamp;
}

export type CreateAppointmentInput = Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>;
