import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { leadsRepository } from '../leads/leads.repository';
import { assignLead } from '../leads/leadAssignment.service';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { createMeetEvent, deleteEvent } from '../../integrations/google/google.client';
import { appointmentsRepository } from './appointments.repository';
import { assertAppointmentAvailability } from './availability.service';
import { buildEventTitle, buildEventDescription } from './appointmentMessages';
import { getAiConfig } from '../ai/aiConfig.repository';
import { postLeadSmartHomeBitacora } from '../smarthome/smarthomeEvents.service';
import type { Appointment } from './appointments.types';

export interface BookInput {
  companyId:        string;
  leadId:           string;
  startTime:        Date;
  durationMinutes?: number;
  title?:           string;
  description?:     string;
  /** 'ai' si la agendó el asistente virtual; 'manual' si la creó un asesor. */
  source?:          'ai' | 'manual';
}

/**
 * Agenda una cita: crea el evento en el Google Calendar del asesor asignado
 * (con Google Meet) y guarda la cita en Firestore.
 *
 * Si el asesor no tiene Google conectado, la cita se guarda igualmente pero sin
 * enlace de Meet (se registra una advertencia).
 */
export async function bookAppointment(input: BookInput): Promise<Appointment> {
  const { companyId, leadId } = input;
  const durationMinutes = input.durationMinutes ?? 30;

  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) throw new Error('Lead no encontrado.');

  const startTime = input.startTime;
  const endTime   = new Date(startTime.getTime() + durationMinutes * 60_000);
  const fromAi    = input.source === 'ai';
  const businessName = (await getAiConfig(companyId)).businessName;
  const title       = input.title?.trim() || buildEventTitle(lead.name);
  const description = input.description?.trim() || buildEventDescription(businessName, lead.name, fromAi);

  // Leads creados antes de tener asignación automática pueden no tener asesor:
  // se asigna de forma perezosa (round-robin) para que la cita pueda crearse en
  // el Google Calendar de un asesor y generar el enlace de Meet.
  const advisorId = lead.assignedTo ?? (await assignLead(companyId, leadId)) ?? undefined;
  const conn = advisorId ? await googleConnectionRepository.getActive(companyId, advisorId) : null;

  await assertAppointmentAvailability({
    companyId,
    advisorId,
    refreshToken: conn?.refreshToken,
    start: startTime,
    end: endTime,
    enforceMinAdvance: fromAi, // la IA exige anticipación mínima; los asesores no
  });

  // ── Crear evento en el calendario del asesor (si está conectado) ───────────
  let googleMeetLink: string | undefined;
  let googleEventId:  string | undefined;

  if (conn) {
    try {
      const ev = await createMeetEvent(conn.refreshToken, {
        title,
        description,
        attendees:   [conn.email],
        start:       startTime,
        end:         endTime,
      });
      googleMeetLink = ev.meetLink ?? undefined;
      googleEventId  = ev.eventId  ?? undefined;
    } catch (err) {
      logger.error('[Appointments] Error creando evento en Google', {
        companyId, leadId, error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn('[Appointments] Asesor sin Google conectado — cita sin Meet', { companyId, leadId, advisorId });
  }

  // ── Guardar cita ───────────────────────────────────────────────────────────
  const appointment = await appointmentsRepository.create({
    companyId,
    leadId,
    advisorId,
    leadName:  lead.name,
    leadPhone: lead.phone,
    title,
    description,
    startTime: Timestamp.fromDate(startTime),
    endTime:   Timestamp.fromDate(endTime),
    googleEventId,
    googleMeetLink,
    status:    'scheduled',
    source:    input.source ?? 'manual',
  });

  await leadsRepository.update(companyId, leadId, { status: 'scheduled' });

  const when = new Intl.DateTimeFormat('es-CO', {
    timeZone: env.calendarTimeZone(),
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(startTime);
  try {
    await postLeadSmartHomeBitacora(
      { ...lead, assignedTo: advisorId, companyId, id: leadId },
      [
        `Registro automático enviado desde CRM Meraki: ${fromAi ? 'el asistente IA agendó una cita' : 'se agendó una cita desde el CRM'} para ${when}.`,
        `Duración: ${durationMinutes} minutos.`,
        googleMeetLink ? `Enlace Meet: ${googleMeetLink}` : '',
      ].filter(Boolean).join('\n')
    );
  } catch (err) {
    logger.warn('[Appointments] SmartHome bitacora no registrada', {
      companyId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('[Appointments] Cita agendada', {
    companyId, leadId, appointmentId: appointment.id, meet: googleMeetLink, tz: env.calendarTimeZone(),
  });
  return appointment;
}

// ─── Cancelar / reagendar ───────────────────────────────────────────────────

/**
 * Devuelve la cita activa (status 'scheduled') del lead: la próxima futura, o la
 * más reciente si todas ya pasaron. `null` si no tiene ninguna activa.
 */
export async function findActiveAppointmentForLead(
  companyId: string,
  leadId:    string
): Promise<Appointment | null> {
  const appts = (await appointmentsRepository.findByLead(companyId, leadId))
    .filter((a) => a.status === 'scheduled');
  if (appts.length === 0) return null;

  const now = Date.now();
  const upcoming = appts
    .filter((a) => a.startTime.toMillis() >= now)
    .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());
  if (upcoming.length > 0) return upcoming[0];

  return appts.sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis())[0];
}

/**
 * Marca una cita como cancelada y borra su evento del Google Calendar del asesor
 * (si lo tiene). No toca el estado del lead.
 */
export async function cancelAppointmentRecord(companyId: string, appt: Appointment): Promise<void> {
  if (appt.googleEventId && appt.advisorId) {
    const conn = await googleConnectionRepository.getActive(companyId, appt.advisorId);
    if (conn) {
      try {
        await deleteEvent(conn.refreshToken, appt.googleEventId);
      } catch (err) {
        logger.error('[Appointments] Error borrando evento de Google al cancelar', {
          companyId, appointmentId: appt.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await appointmentsRepository.updateStatus(companyId, appt.id, 'canceled');
}

/** Cancela una cita por su ID (usado por el callable del frontend). */
export async function cancelAppointmentById(companyId: string, appointmentId: string): Promise<boolean> {
  const appt = await appointmentsRepository.findById(companyId, appointmentId);
  if (!appt) return false;
  await cancelAppointmentRecord(companyId, appt);
  return true;
}

/**
 * Cancela la cita activa del lead (la que el lead "tiene"). Devuelve la cita
 * cancelada, o `null` si no tenía ninguna. Regresa el lead a estado 'active'.
 */
export async function cancelActiveAppointment(companyId: string, leadId: string): Promise<Appointment | null> {
  const appt = await findActiveAppointmentForLead(companyId, leadId);
  if (!appt) return null;
  await cancelAppointmentRecord(companyId, appt);
  await leadsRepository.update(companyId, leadId, { status: 'active' });
  logger.info('[Appointments] Cita cancelada', { companyId, leadId, appointmentId: appt.id });
  return appt;
}

export interface RescheduleInput {
  companyId:        string;
  leadId:           string;
  startTime:        Date;
  durationMinutes?: number;
}

/**
 * Reagenda la cita activa del lead a un nuevo horario: cancela la anterior
 * (liberando el slot y borrando el evento viejo de Google) y crea una nueva.
 * Si el lead no tenía cita, simplemente agenda una nueva (`hadPrevious=false`).
 *
 * Nota: se cancela primero la cita anterior para no chocar consigo misma en la
 * verificación de disponibilidad. Si el nuevo horario está ocupado, `bookAppointment`
 * lanza AvailabilityError (con sugerencias) y la conversación pide otro horario.
 */
export async function rescheduleAppointment(
  input: RescheduleInput
): Promise<{ appointment: Appointment; hadPrevious: boolean }> {
  const previous = await findActiveAppointmentForLead(input.companyId, input.leadId);

  // Conservar la duración de la cita anterior si no se especifica una nueva.
  let durationMinutes = input.durationMinutes;
  if (!durationMinutes && previous) {
    const mins = Math.round((previous.endTime.toMillis() - previous.startTime.toMillis()) / 60_000);
    if (mins > 0) durationMinutes = mins;
  }

  if (previous) await cancelAppointmentRecord(input.companyId, previous);

  const appointment = await bookAppointment({
    companyId:       input.companyId,
    leadId:          input.leadId,
    startTime:       input.startTime,
    durationMinutes,
    source:          'ai',
  });

  return { appointment, hadPrevious: !!previous };
}
