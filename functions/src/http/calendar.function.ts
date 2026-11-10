import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
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
  source:   'google' | 'crm' | 'reminder';
  status?:  string;
  leadId?:  string;
  leadName?: string | null;
  leadPhone?: string;
  project?: string;
  nextAction?: string;
  actionType?: string;
  advisorId?: string;
  postCitaStatus?: string;
  attended?: boolean;
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
// Une los eventos del Google Calendar del asesor con las citas del CRM y recordatorios (sin duplicar).

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
    let rawGoogleEvents: CalendarEvent[] = [];
    if (conn) {
      try {
        rawGoogleEvents = (await listEvents(conn.refreshToken, from, to)).map((e) => ({
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

    // Citas del CRM: preferimos la entidad CRM (que conserva leadId, teléfono y estado SLA)
    // y descartamos del listado rawGoogleEvents aquellas que ya corresponden a un googleEventId del CRM.
    const googleMeetByEventId = new Map(rawGoogleEvents.map((e) => [e.id, e.meetLink]));
    const allCrmAppts = await appointmentsRepository.listInRange(companyId, from, to);
    const crmAppts = (ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))
      ? allCrmAppts
      : allCrmAppts.filter((a) => a.advisorId === advisorId);

    const syncedGoogleEventIds = new Set(
      crmAppts.map((a) => a.googleEventId).filter(Boolean) as string[]
    );

    const googleEvents = rawGoogleEvents.filter((e) => !syncedGoogleEventIds.has(e.id));

    const crmEvents: CalendarEvent[] = crmAppts.map((a) => ({
      id:       a.id,
      title:    a.title,
      start:    a.startTime.toMillis(),
      end:      a.endTime.toMillis(),
      allDay:   false,
      meetLink: a.googleMeetLink ?? (a.googleEventId ? googleMeetByEventId.get(a.googleEventId) ?? null : null),
      source:   'crm' as const,
      status:   a.status,
      leadId:   a.leadId,
      leadName: a.leadName ?? a.leadPhone,
      leadPhone: a.leadPhone,
      advisorId: a.advisorId,
      postCitaStatus: (a as any).postCitaStatus,
      attended: (a as any).attended,
    }));

    // Recordatorios de Ficha Técnica / Próximos Seguimientos programados
    const reminderEvents: CalendarEvent[] = [];
    try {
      const leadsSnap = await db.collection('companies').doc(companyId).collection('leads')
        .where('nextFollowUpDate', '!=', null)
        .get();

      for (const d of leadsSnap.docs) {
        const data = d.data();
        if (!ctx.platformAdmin && !ADMIN_ROLES.includes(ctx.role)) {
          if (data.assignedTo && data.assignedTo !== advisorId) continue;
        }

        const dateStr = data.nextFollowUpDate;
        if (!dateStr || typeof dateStr !== 'string') continue;

        // Si no tiene zona horaria especificada, se asume Colombia (-05:00)
        const cleanDateStr = dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
          ? dateStr
          : (dateStr.trim().includes('T') ? dateStr.trim() : dateStr.trim().replace(' ', 'T')) + '-05:00';
        const parsedDate = new Date(cleanDateStr);
        if (isNaN(parsedDate.getTime())) continue;

        const startMs = parsedDate.getTime();
        // Filtrar al rango visible (o permitir todos los vencidos recientes dentro de los últimos 30 días)
        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        const effectiveFrom = Math.min(from.getTime() - 86400000, thirtyDaysAgo);
        if (startMs < effectiveFrom || startMs > to.getTime() + 86400000) continue;

        const leadName = data.name || data.phone || 'Prospecto';
        const action = data.nextFollowUpAction || 'Seguimiento';
        const project = data.projectInterest?.[0] || data.project || '';

        reminderEvents.push({
          id: `rem_${d.id}`,
          title: `⏰ ${action}: ${leadName}`,
          start: startMs,
          end: startMs + 30 * 60 * 1000,
          allDay: false,
          meetLink: null,
          source: 'reminder',
          status: 'scheduled',
          leadId: d.id,
          leadName,
          leadPhone: data.phone || '',
          project,
          nextAction: action,
          advisorId: data.assignedTo || undefined,
        });
      }
    } catch (err) {
      logger.warn('[calendar] Error consultando recordatorios de leads:', { err });
    }

    return { connected, events: [...googleEvents, ...crmEvents, ...reminderEvents] };
  }
);

// ─── completeLeadFollowUp ────────────────────────────────────────────────────────
// Marca como evacuado/realizado el recordatorio activo de un lead desde la bandeja de pendientes.

export const completeLeadFollowUp = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const leadRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) throw new HttpsError('not-found', 'Prospecto no encontrado.');

    const leadData = leadSnap.data() ?? {};
    if (!ctx.platformAdmin && !ADMIN_ROLES.includes(ctx.role) && leadData.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes gestionar seguimientos de tus prospectos asignados.');
    }

    const now = Timestamp.now();
    await leadRef.update({
      nextFollowUpDate: null,
      nextFollowUpAction: null,
      lastFollowUpAt: now,
      updatedAt: now,
    });

    // Marcar también recordatorios abiertos en la subcolección notes
    const openReminders = await leadRef.collection('notes')
      .where('kind', '==', 'reminder')
      .where('done', '==', false)
      .get();

    if (!openReminders.empty) {
      const batch = db.batch();
      for (const rDoc of openReminders.docs) {
        batch.update(rDoc.ref, { done: true, notified: true, completedAt: now });
      }
      await batch.commit();
    }

    return { ok: true };
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
