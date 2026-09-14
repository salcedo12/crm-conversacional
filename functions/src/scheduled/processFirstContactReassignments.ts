import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { appointmentsRepository } from '../modules/appointments/appointments.repository';
import { transferFutureAppointmentsToAdvisor } from '../modules/appointments/appointments.service';
import { getSchedulingConfigCached } from '../modules/appointments/schedulingConfig';
import { pickAdvisorForFirstContactReassignment } from '../modules/leads/leadAssignment.service';
import type { Lead } from '../modules/leads/leads.types';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
import { logger } from '../utils/logger';

const TERMINAL_STATUSES = new Set(['lost', 'closed', 'perdido', 'cerrado']);

/** Zona horaria local para decidir la franja en la que se permite reasignar. */
const REASSIGN_TIMEZONE = 'America/Bogota';

/** Hora del día (0–23) en la zona indicada, para respetar la franja de reasignación. */
function currentHourInTimeZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

async function hasFutureAppointment(companyId: string, leadId: string): Promise<boolean> {
  const appointments = await appointmentsRepository.findByLead(companyId, leadId);
  return appointments.some((appointment) =>
    appointment.status === 'scheduled' && appointment.endTime.toMillis() > Date.now()
  );
}

export const processFirstContactReassignments = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'us-central1',
    timeZone: 'America/Bogota',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const now = Timestamp.now();
    const localHour = currentHourInTimeZone(REASSIGN_TIMEZONE);
    const companyRefs = await db.collection('companies').listDocuments();

    for (const companyRef of companyRefs) {
      const companyId = companyRef.id;
      // Caché en memoria (TTL 5 min): evita 1 lectura Firestore/empresa/minuto.
      const config = await getSchedulingConfigCached(companyId);
      if (!config.autoReassignFirstContactEnabled) continue;

      // Franja horaria: fuera de [reassignStartHour, reassignEndHour) NO se reasigna
      // (p. ej. de 22:00 a 06:59) para no notificar a los asesores de madrugada.
      // No se toca advisorAssignedAt: el reloj sigue corriendo y, al abrir la franja,
      // los leads vencidos se reasignan de inmediato.
      if (localHour < config.reassignStartHour || localHour >= config.reassignEndHour) {
        continue;
      }

      const timeoutMs = Math.max(1, config.firstContactTimeoutMinutes) * 60_000;
      const cutoff = Timestamp.fromMillis(now.toMillis() - timeoutMs);

      // Query filtrada: SOLO leads pendientes de primer contacto cuyo tiempo de
      // espera ya venció. Antes se leía TODA la colección de leads cada minuto
      // (O(leads) por corrida → costo y riesgo de timeout con bases grandes).
      // Ahora se leen únicamente los candidatos reales. Requiere el índice
      // compuesto (pendingFirstContact ASC, advisorAssignedAt ASC) en firestore.indexes.json.
      const leadsSnapshot = await companyRef.collection('leads')
        .where('pendingFirstContact', '==', true)
        .where('advisorAssignedAt', '<=', cutoff)
        .get();

      for (const leadDoc of leadsSnapshot.docs) {
        const lead = { id: leadDoc.id, ...leadDoc.data() } as Lead;
        // Guardas de defensa (la query ya excluye la mayoría de estos casos):
        if (
          !lead.assignedTo
          || lead.assignmentLocked        // asesor fijado manualmente: nunca reasignar
          || !lead.advisorAssignedAt
          || lead.advisorFirstContactAt
          || lead.lastAdvisorMessageAt
          || TERMINAL_STATUSES.has(String(lead.status ?? '').toLowerCase())
        ) {
          continue;
        }

        if (now.toMillis() - lead.advisorAssignedAt.toMillis() < timeoutMs) continue;

        const futureAppointment = await hasFutureAppointment(companyId, lead.id);
        const newAdvisorId = await pickAdvisorForFirstContactReassignment(companyId, lead.id, lead.assignedTo, {
          requireGoogle: futureAppointment,
        });

        if (!newAdvisorId) {
          // Reinicia la espera para no consultar y registrar el mismo caso cada minuto.
          await leadDoc.ref.update({ advisorAssignedAt: now });
          logger.warn('[FirstContactReassignment] Sin asesor alterno disponible', {
            companyId,
            leadId: lead.id,
            currentAdvisorId: lead.assignedTo,
            futureAppointment,
          });
          continue;
        }

        const reassigned = await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(leadDoc.ref);
          if (!currentSnapshot.exists) return false;

          const current = currentSnapshot.data() as Lead;
          if (
            current.assignmentLocked
            || current.advisorFirstContactAt
            || current.lastAdvisorMessageAt
            || current.assignedTo !== lead.assignedTo
            || current.advisorAssignedAt?.toMillis() !== lead.advisorAssignedAt?.toMillis()
          ) {
            return false;
          }

          transaction.update(leadDoc.ref, {
            assignedTo: newAdvisorId,
            advisorAssignedAt: now,
            lastAutoReassignedAt: now,
            advisorReassignmentCount: FieldValue.increment(1),
            updatedAt: now,
          });
          return true;
        });

        if (!reassigned) continue;

        await companyRef.collection('leadReassignmentEvents').add({
          leadId: lead.id,
          leadName: lead.name || lead.phone || 'Lead',
          leadPhone: lead.phone ?? '',
          previousAdvisorId: lead.assignedTo,
          newAdvisorId,
          reason: 'first-contact-timeout',
          previousAdvisorAssignedAt: lead.advisorAssignedAt,
          reassignedAt: now,
          createdAt: now,
        });

        const transfer = await transferFutureAppointmentsToAdvisor(
          companyId,
          lead.id,
          newAdvisorId
        );

        const leadName = lead.name || lead.phone || 'Lead';
        const appointmentWarning = transfer.failed > 0
          ? ' Revisa la cita pendiente: no pudo trasladarse automaticamente.'
          : '';

        await sendAdvisorPush(companyId, newAdvisorId, {
          title: `Lead reasignado: ${leadName}`,
          body: `${leadName} fue asignado a ti por falta de primer contacto.${appointmentWarning}`,
          url: `/dashboard/inbox?lead=${lead.id}`,
          type: 'lead-auto-reassigned',
          leadId: lead.id,
        });

        logger.info('[FirstContactReassignment] Lead reasignado automaticamente', {
          companyId,
          leadId: lead.id,
          previousAdvisorId: lead.assignedTo,
          newAdvisorId,
          appointmentTransfer: transfer,
        });
      }
    }
  }
);
