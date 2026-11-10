import { Timestamp } from 'firebase-admin/firestore';

export type AppointmentStatus = 'scheduled' | 'canceled' | 'completed';

/** Cómo se hace la cita: el asesor llama por teléfono, o videollamada por Google Meet. */
export type AppointmentModality = 'llamada' | 'videollamada';

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
  /** Sin valor = llamada (las citas anteriores a la elección eran llamadas). */
  modality?:      AppointmentModality;
  status:         AppointmentStatus;
  /** 'ai' = agendada por el asistente virtual; 'manual' = por un asesor; 'ficha_tecnica' = seguimiento interno */
  source?:        'ai' | 'manual' | 'ficha_tecnica';
  /** Si es true, es un seguimiento interno para el asesor (no dispara recordatorios al cliente) */
  isInternalReminder?: boolean;
  /** Recordatorios ya enviados (anti-duplicado) */
  remindersSent?: { h24?: boolean; h2?: boolean; m30?: boolean };
  createdAt:      Timestamp;
  updatedAt:      Timestamp;
}

export type CreateAppointmentInput = Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>;
