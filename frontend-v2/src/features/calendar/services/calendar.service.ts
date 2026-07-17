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
  source:   'google' | 'crm';
  status?:  string;
  leadName?: string | null;
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

export async function cancelAppointment(companyId: string, appointmentId: string): Promise<void> {
  await _cancelAppointment({ companyId, appointmentId });
}

export async function bookAppointmentManual(companyId: string, input: BookAppointmentInput) {
  const r = await _bookAppointmentManual({ companyId, ...input });
  return r.data;
}

const _listCalendarEvents  = httpsCallable<{ companyId: string; fromISO: string; toISO: string }, { connected: boolean; events: CalendarEvent[] }>(functions, 'listCalendarEvents');
const _createCalendarEvent = httpsCallable<{ companyId: string } & CreateEventInput, { eventId: string | null; meetLink: string | null }>(functions, 'createCalendarEvent');
const _deleteCalendarEvent = httpsCallable<{ companyId: string; eventId: string }, { ok: boolean }>(functions, 'deleteCalendarEvent');

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
