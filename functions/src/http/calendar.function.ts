import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { appointmentsRepository } from '../modules/appointments/appointments.repository';
import {
  AvailabilityError,
  assertAppointmentAvailability,
} from '../modules/appointments/availability.service';
import { listEvents, createMeetEvent, deleteEvent } from '../integrations/google/google.client';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { logger } from '../utils/logger';

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

function isGoogleAuthError(err: unknown): boolean {
  const e = err as {
    status?: number;
    code?: number;
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
    errors?: { reason?: string; message?: string }[];
  };
  const code = e.response?.data?.error ?? '';
  const description = e.response?.data?.error_description ?? '';
  const message = e.message ?? '';
  const reasons = (e.errors ?? []).map((item) => `${item.reason ?? ''} ${item.message ?? ''}`).join(' ');

  return (
    code === 'invalid_grant' ||
    code === 'insufficient_scope' ||
    /expired|revoked|invalid_grant|insufficient/i.test(description) ||
    /invalid_grant|insufficient/i.test(message) ||
    /insufficient/i.test(reasons) ||
    e.status === 401 ||
    e.status === 403 ||
    e.code === 401 ||
    e.code === 403
  );
}

// ─── listCalendarEvents ──────────────────────────────────────────────────────────
// Une los eventos del Google Calendar del asesor con las citas del CRM (sin duplicar).

export const listCalendarEvents = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, fromISO, toISO } = z.object({
      companyId: z.string().min(1),
      fromISO:   z.string(),
      toISO:     z.string(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const advisorId = ctx.uid;
    const from = new Date(fromISO);
    const to   = new Date(toISO);

    const conn = await googleConnectionRepository.getActive(companyId, advisorId);

    // Eventos de Google Calendar del asesor
    let connected = !!conn;
    let googleEvents: CalendarEvent[] = [];
    if (conn) {
      try {
        googleEvents = (await listEvents(conn.refreshToken, from, to)).map((e) => ({
          id: e.id, title: e.title, start: e.start, end: e.end,
          allDay: e.allDay, meetLink: e.meetLink, source: 'google' as const,
        }));
      } catch (err) {
        if (!isGoogleAuthError(err)) throw err;
        logger.warn('[calendar] Google Calendar desconectado por token/permisos inválidos', {
          companyId,
          advisorId,
        });
        await googleConnectionRepository.disconnect(companyId, advisorId);
        connected = false;
      }
    }

    // Citas del CRM que NO estén ya en Google (evitar duplicados)
    const googleIds = new Set(googleEvents.map((e) => e.id));
    const allCrmAppts = await appointmentsRepository.listInRange(companyId, from, to);
    const crmAppts = ADMIN_ROLES.includes(ctx.role)
      ? allCrmAppts
      : allCrmAppts.filter((a) => a.advisorId === advisorId);
    const crmEvents: CalendarEvent[] = crmAppts
      .filter((a) => !a.googleEventId || !googleIds.has(a.googleEventId))
      .map((a) => ({
        id:       a.id,
        title:    a.title,
        start:    a.startTime.toMillis(),
        end:      a.endTime.toMillis(),
        allDay:   false,
        meetLink: a.googleMeetLink ?? null,
        source:   'crm' as const,
        status:   a.status,
        leadName: a.leadName ?? a.leadPhone,
      }));

    return { connected, events: [...googleEvents, ...crmEvents] };
  }
);

// ─── createCalendarEvent ─────────────────────────────────────────────────────────
// Crea un evento manual en el Google Calendar del asesor (con Meet opcional).

export const createCalendarEvent = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, title, startISO, durationMinutes, description, withMeet } = z.object({
      companyId:       z.string().min(1),
      title:           z.string().min(1).max(200),
      startISO:        z.string(),
      durationMinutes: z.number().min(5).max(600).default(30),
      description:     z.string().max(2000).optional(),
      withMeet:        z.boolean().default(true),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const conn = await googleConnectionRepository.getActive(companyId, ctx.uid);
    if (!conn) throw new HttpsError('failed-precondition', 'Conecta tu Google Calendar primero (Config → Conexiones).');

    const start = new Date(startISO);
    const end   = new Date(start.getTime() + durationMinutes * 60_000);

    try {
      await assertAppointmentAvailability({
        companyId,
        advisorId: ctx.uid,
        refreshToken: conn.refreshToken,
        start,
        end,
      });
    } catch (err) {
      if (err instanceof AvailabilityError) {
        throw new HttpsError('failed-precondition', err.message);
      }
      throw err;
    }

    const ev = await createMeetEvent(conn.refreshToken, {
      title, description: description ?? '', attendees: [conn.email], start, end, withMeet,
    });

    return { eventId: ev.eventId, meetLink: ev.meetLink };
  }
);

// ─── deleteCalendarEvent ─────────────────────────────────────────────────────────

export const deleteCalendarEvent = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, eventId } = z.object({
      companyId: z.string().min(1),
      eventId:   z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const conn = await googleConnectionRepository.getActive(companyId, ctx.uid);
    if (!conn) throw new HttpsError('failed-precondition', 'No hay conexión de Google activa.');

    await deleteEvent(conn.refreshToken, eventId);
    return { ok: true };
  }
);
