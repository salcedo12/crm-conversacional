import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface AppointmentDTO {
  id:             string;
  leadId:         string;
  advisorId:      string | null;
  leadName:       string | null;
  leadPhone:      string;
  title:          string;
  startTime:      number;  // millis
  endTime:        number;  // millis
  googleMeetLink: string | null;
  status:         'scheduled' | 'canceled' | 'completed';
}

export interface CalendarEvent {
  id:       string;
  title:    string;
  start:    number;  // millis
  end:      number;  // millis
  allDay:   boolean;
  meetLink: string | null;
  source:   'google' | 'crm' | 'reminder';
  status?:  string;
  leadId?:  string;
  leadName?: string | null;
  leadPhone?: string;
  project?: string;
  nextAction?: string;
  advisorId?: string;
  postCitaStatus?: string;
  attended?: boolean;
}

export interface CreateEventInput {
  title:           string;
  startISO:        string;
  durationMinutes: number;
  description?:    string;
  withMeet:        boolean;
}

export interface BookAppointmentInput {
  leadId: string;
  startISO: string;
  durationMinutes?: number;
  title?: string;
}

const _startGoogleAuth   = httpsCallable<{ companyId: string }, { url: string }>(functions, 'startGoogleAuth');
const _getGoogleConn     = httpsCallable<{ companyId: string }, { connected: boolean; email: string | null }>(functions, 'getGoogleConnection');
const _disconnectGoogle  = httpsCallable<{ companyId: string }, { ok: boolean }>(functions, 'disconnectGoogle');
const _listAppointments  = httpsCallable<{ companyId: string; fromISO: string; toISO: string }, { appointments: AppointmentDTO[] }>(functions, 'listAppointments');
const _listLeadAppointments = httpsCallable<{ companyId: string; leadId: string }, { appointments: AppointmentDTO[] }>(functions, 'listLeadAppointments');
const _cancelAppointment = httpsCallable<{ companyId: string; appointmentId: string }, { ok: boolean }>(functions, 'cancelAppointment');
const _bookAppointmentManual = httpsCallable<
  { companyId: string } & BookAppointmentInput,
  { appointmentId: string; googleMeetLink: string | null }
>(functions, 'bookAppointmentManual');

export async function startGoogleAuth(companyId: string): Promise<string> {
  const r = await _startGoogleAuth({ companyId });
  return r.data.url;
}

export async function getGoogleConnection(companyId: string) {
  const r = await _getGoogleConn({ companyId });
  return r.data;
}

export async function disconnectGoogle(companyId: string): Promise<void> {
  await _disconnectGoogle({ companyId });
}

export async function listAppointments(companyId: string, from: Date, to: Date): Promise<AppointmentDTO[]> {
  const r = await _listAppointments({ companyId, fromISO: from.toISOString(), toISO: to.toISOString() });
  return r.data.appointments;
}

export async function listLeadAppointments(companyId: string, leadId: string): Promise<AppointmentDTO[]> {
  const r = await _listLeadAppointments({ companyId, leadId });
  return r.data.appointments;
}

export async function cancelAppointment(companyId: string, appointmentId: string): Promise<void> {
  await _cancelAppointment({ companyId, appointmentId });
}

export async function bookAppointmentManual(companyId: string, input: BookAppointmentInput) {
  const r = await _bookAppointmentManual({ companyId, ...input });
  return r.data;
}

export interface ReportAppointmentFichaInput {
  appointmentId?:  string;
  leadId?:         string;
  actionType?:     'cita_reunion' | 'llamada' | 'envio_informacion' | 'visita_terreno' | 'seguimiento_general';
  result?:         string;
  attended?:       boolean;
  evidenceUrl?:    string;
  nextAction:      string;
  nextActionDate?: string;
  notes?:          string;
  pipelineStage?:  string;
  inviteReferralProgram?: boolean;
  project?:        string;
}

export interface ReportAppointmentFichaResult {
  ok: boolean;
  appointmentId: string | null;
  leadId?: string;
  reminderScheduled?: boolean;
  googleSync?: {
    synced: boolean;
    eventId: string | null;
    meetLink: string | null;
    htmlLink: string | null;
    directCalendarUrl: string;
  };
}

const _reportAppointmentFicha = httpsCallable<
  { companyId: string } & ReportAppointmentFichaInput,
  ReportAppointmentFichaResult
>(functions, 'reportAppointmentFicha');

export async function reportAppointmentFicha(companyId: string, input: ReportAppointmentFichaInput) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await _reportAppointmentFicha({ companyId, ...input });
      return r.data;
    } catch (err: any) {
      lastError = err;
      const isTransient =
        err?.code === 'internal' ||
        err?.code === 'unavailable' ||
        err?.code === 'deadline-exceeded' ||
        err?.message?.includes('network') ||
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('500');

      if (!isTransient || attempt === 3) {
        throw err;
      }
      console.warn(`[reportAppointmentFicha] Intento ${attempt} falló por microcorte, reintentando en ${attempt * 700}ms...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError;
}

const _listCalendarEvents  = httpsCallable<{ companyId: string; fromISO: string; toISO: string }, { connected: boolean; events: CalendarEvent[] }>(functions, 'listCalendarEvents');
const _createCalendarEvent = httpsCallable<{ companyId: string } & CreateEventInput, { eventId: string | null; meetLink: string | null }>(functions, 'createCalendarEvent');
const _deleteCalendarEvent = httpsCallable<{ companyId: string; eventId: string }, { ok: boolean }>(functions, 'deleteCalendarEvent');
const _completeLeadFollowUp = httpsCallable<{ companyId: string; leadId: string }, { ok: boolean }>(functions, 'completeLeadFollowUp');
const _sendMorningAgendaSummaryNow = httpsCallable<
  { companyId: string; advisorId?: string },
  { ok: boolean; advisorsNotified: number; totalItems: number }
>(functions, 'sendMorningAgendaSummaryNow');

export async function listCalendarEvents(companyId: string, from: Date, to: Date) {
  const r = await _listCalendarEvents({ companyId, fromISO: from.toISOString(), toISO: to.toISOString() });
  return r.data;
}

export async function createCalendarEvent(companyId: string, input: CreateEventInput) {
  const r = await _createCalendarEvent({ companyId, ...input });
  return r.data;
}

export async function deleteCalendarEvent(companyId: string, eventId: string): Promise<void> {
  await _deleteCalendarEvent({ companyId, eventId });
}

export async function completeLeadFollowUp(companyId: string, leadId: string): Promise<void> {
  await _completeLeadFollowUp({ companyId, leadId });
}

export async function sendMorningAgendaSummaryNow(companyId: string, advisorId?: string) {
  const r = await _sendMorningAgendaSummaryNow({ companyId, advisorId });
  return r.data;
}
