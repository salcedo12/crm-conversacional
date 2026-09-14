import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { appointmentsRepository } from '../modules/appointments/appointments.repository';
import { bookAppointment, cancelAppointmentById } from '../modules/appointments/appointments.service';
import { leadsRepository } from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

// ─── listAppointments ──────────────────────────────────────────────────────────
// Devuelve las citas en un rango de fechas (para la vista de calendario).

export const listAppointments = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, fromISO, toISO } = z.object({
      companyId: z.string().min(1),
      fromISO:   z.string(),
      toISO:     z.string(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const allAppts = await appointmentsRepository.listInRange(
      companyId, new Date(fromISO), new Date(toISO)
    );
    const appts = (ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))
      ? allAppts
      : allAppts.filter((appt) => appt.advisorId === ctx.uid);

    // Serializar Timestamps a millis para el cliente
    return {
      appointments: appts.map((a) => ({
        id:             a.id,
        leadId:         a.leadId,
        advisorId:      a.advisorId ?? null,
        leadName:       a.leadName ?? null,
        leadPhone:      a.leadPhone,
        title:          a.title,
        startTime:      a.startTime.toMillis(),
        endTime:        a.endTime.toMillis(),
        googleMeetLink: a.googleMeetLink ?? null,
        status:         a.status,
      })),
    };
  }
);

// ─── listLeadAppointments ────────────────────────────────────────────────────────
// Devuelve las citas de un lead concreto (para el detalle del contacto).

export const listLeadAppointments = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const all = await appointmentsRepository.findByLead(companyId, leadId);
    const appts = ((ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))
      ? all
      : all.filter((appt) => appt.advisorId === ctx.uid)
    ).sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis());

    return {
      appointments: appts.map((a) => ({
        id:             a.id,
        leadId:         a.leadId,
        advisorId:      a.advisorId ?? null,
        leadName:       a.leadName ?? null,
        leadPhone:      a.leadPhone,
        title:          a.title,
        startTime:      a.startTime.toMillis(),
        endTime:        a.endTime.toMillis(),
        googleMeetLink: a.googleMeetLink ?? null,
        status:         a.status,
      })),
    };
  }
);

// ─── cancelAppointment ───────────────────────────────────────────────────────────

export const cancelAppointment = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, appointmentId } = z.object({
      companyId:     z.string().min(1),
      appointmentId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const appointment = await appointmentsRepository.findById(companyId, appointmentId);
    if (!appointment) throw new HttpsError('not-found', 'Cita no encontrada.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && appointment.advisorId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes cancelar tus citas asignadas.');
    }

    const ok = await cancelAppointmentById(companyId, appointmentId);
    return { ok };
  }
);

// ─── bookAppointmentManual ───────────────────────────────────────────────────────
// Permite a un asesor agendar manualmente desde el CRM.

export const bookAppointmentManual = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, leadId, startISO, durationMinutes, title } = z.object({
      companyId:       z.string().min(1),
      leadId:          z.string().min(1),
      startISO:        z.string(),
      durationMinutes: z.number().optional(),
      title:           z.string().optional(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes agendar leads asignados a ti.');
    }

    const appt = await bookAppointment({
      companyId, leadId, startTime: new Date(startISO), durationMinutes, title,
    });
    return { appointmentId: appt.id, googleMeetLink: appt.googleMeetLink ?? null };
  }
);
