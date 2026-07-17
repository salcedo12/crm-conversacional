import { onRequest } from 'firebase-functions/v2/https';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { assignLead } from '../modules/leads/leadAssignment.service';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { getSchedulingConfig } from '../modules/appointments/schedulingConfig';
import {
  findNearbyAvailableSlots,
  formatAvailabilityDate,
  AvailabilityError,
} from '../modules/appointments/availability.service';
import { bookAppointment } from '../modules/appointments/appointments.service';
import { verifyDaptaRequest } from '../integrations/dapta/dapta.auth';

/**
 * Devuelve horarios disponibles reales del asesor asignado a un lead (Google
 * Calendar + citas del CRM), para que la IA de voz de Dapta los ofrezca en la
 * llamada. Reemplaza el nodo "get_slots" que antes apuntaba a GoHighLevel.
 *
 * Query/body: { leadId } (también acepta contact_id, que es como Dapta llama
 * al leadId en su payload).
 */
export const daptaGetFreeSlots = onRequest(
  { region: 'us-central1', cors: false, timeoutSeconds: 45, invoker: 'public' },
  async (req, res) => {
    if (!verifyDaptaRequest(req)) { res.sendStatus(401); return; }

    const companyId = env.defaultCompanyId();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const leadId = (req.query.leadId as string)
      ?? (req.query.contact_id as string)
      ?? (body.leadId as string)
      ?? (body.contact_id as string);

    if (!leadId) {
      res.status(400).json({ error: 'leadId requerido' });
      return;
    }

    try {
      const lead = await leadsRepository.findById(companyId, leadId);
      if (!lead) {
        res.status(404).json({ error: 'Lead no encontrado' });
        return;
      }

      const advisorId = lead.assignedTo ?? (await assignLead(companyId, leadId)) ?? undefined;
      const conn = advisorId ? await googleConnectionRepository.getActive(companyId, advisorId) : null;

      const config = await getSchedulingConfig(companyId);
      const durationMinutes = 30;
      const earliest = new Date(Date.now() + config.minAdvanceMinutes * 60_000);
      const end = new Date(earliest.getTime() + durationMinutes * 60_000);

      const slots = await findNearbyAvailableSlots(
        { companyId, advisorId, refreshToken: conn?.refreshToken ?? undefined, start: earliest, end },
        [],
        config,
        earliest
      );

      const formatted = slots.map((d) => ({ iso: d.toISOString(), label: formatAvailabilityDate(d) }));

      logger.info('[daptaGetFreeSlots] Horarios encontrados', { leadId, advisorId, count: formatted.length });

      res.status(200).json({
        slots: formatted,
        slotsText: formatted.map((s) => s.label).join('; '),
      });
    } catch (err) {
      logger.error('[daptaGetFreeSlots] Error', {
        leadId, error: err instanceof Error ? err.message : String(err),
      });
      res.status(200).json({ slots: [], slotsText: '' });
    }
  }
);

/**
 * Agenda una cita real (Google Calendar + Meet + Firestore) para un lead —
 * misma función que usa la IA de texto y el agendamiento manual. Reemplaza el
 * nodo "create_appointment" que antes apuntaba al motor interno de Dapta
 * (dependiente de GoHighLevel).
 *
 * Body: { leadId (o contact_id), startTime (ISO), durationMinutes? }
 */
export const daptaBookAppointment = onRequest(
  { region: 'us-central1', cors: false, timeoutSeconds: 30, invoker: 'public' },
  async (req, res) => {
    if (!verifyDaptaRequest(req)) { res.sendStatus(401); return; }

    const companyId = env.defaultCompanyId();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const leadId = (body.leadId as string) ?? (body.contact_id as string) ?? (req.query.leadId as string);
    const startTimeRaw = (body.startTime as string) ?? (body.start_time as string);
    const durationMinutes = Number(body.durationMinutes ?? body.duration_minutes ?? 30) || 30;

    if (!leadId || !startTimeRaw) {
      res.status(200).json({ ok: false, error: 'leadId y startTime requeridos' });
      return;
    }

    const startTime = new Date(startTimeRaw);
    if (Number.isNaN(startTime.getTime())) {
      res.status(200).json({ ok: false, error: 'startTime inválido' });
      return;
    }

    try {
      const appointment = await bookAppointment({ companyId, leadId, startTime, durationMinutes, source: 'ai' });
      logger.info('[daptaBookAppointment] Cita agendada', { leadId, appointmentId: appointment.id });
      res.status(200).json({
        ok: true,
        appointmentId: appointment.id,
        meetLink: appointment.googleMeetLink ?? null,
        startTime: appointment.startTime.toDate().toISOString(),
      });
    } catch (err) {
      if (err instanceof AvailabilityError) {
        logger.warn('[daptaBookAppointment] Horario no disponible', { leadId, message: err.message });
        res.status(200).json({
          ok: false,
          error: 'not_available',
          suggestions: err.suggestions.map((d) => d.toISOString()),
        });
        return;
      }
      logger.error('[daptaBookAppointment] Error agendando', {
        leadId, error: err instanceof Error ? err.message : String(err),
      });
      res.status(200).json({ ok: false, error: 'internal' });
    }
  }
);
