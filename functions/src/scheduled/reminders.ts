import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { sendTextToLeadChannel } from '../modules/messages/outboundText.service';
import { messagesRepository } from '../modules/messages/messages.repository';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { getAiConfig }        from '../modules/ai/aiConfig.repository';
import {
  buildReminder24h, buildReminder2h, buildReminder30m,
} from '../modules/appointments/appointmentMessages';
import type { Appointment } from '../modules/appointments/appointments.types';
import type { Lead } from '../modules/leads/leads.types';

type ReminderKey = 'h24' | 'h2' | 'm30';

/**
 * Recordatorios escalonados de citas (se ejecuta cada 5 min):
 *   - 24h antes → saludo + recordatorio (sin enlace)
 *   - 2h antes  → saludo + recordatorio (sin enlace)
 *   - 30min antes → enlace de Google Meet para conectarse
 *
 * Cada recordatorio se envía una sola vez (flag remindersSent en la cita) y por
 * YCloud.
 */
export const processReminders = onSchedule(
  { schedule: 'every 5 minutes', region: 'us-central1', timeZone: 'America/Bogota' },
  async () => {
    const now = Date.now();
    let sent = 0;

    // listDocuments() incluye documentos "fantasma" (sin campos propios pero con
    // subcolecciones), como companies/empresa_demo. Con .get() se omitían y los
    // recordatorios nunca se enviaban. Mismo patrón que processFollowUps.
    const companies = await db.collection('companies').listDocuments();
    for (const companyRef of companies) {
      const companyId = companyRef.id;
      const snap = await companyRef
        .collection('appointments')
        .where('status', '==', 'scheduled')
        .get();

      if (snap.empty) continue;
      const businessName = (await getAiConfig(companyId)).businessName;

      for (const doc of snap.docs) {
        const appt = { id: doc.id, ...doc.data() } as Appointment;
        const minutesUntil = (appt.startTime.toMillis() - now) / 60_000;
        if (minutesUntil <= 0) continue; // ya pasó

        const done = appt.remindersSent ?? {};
        let due: ReminderKey | null = null;
        if      (minutesUntil <= 30  && !done.m30) due = 'm30';
        else if (minutesUntil <= 120 && minutesUntil > 30  && !done.h2)  due = 'h2';
        else if (minutesUntil <= 1440 && minutesUntil > 120 && !done.h24) due = 'h24';
        if (!due) continue;

        try {
          await sendReminder(companyId, appt, due, businessName);
          await doc.ref.update({
            [`remindersSent.${due}`]: true,
            updatedAt: Timestamp.now(),
          });
          sent++;
        } catch (err) {
          logger.error('[Reminders] Error enviando recordatorio', {
            companyId, appointmentId: appt.id, due,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (sent > 0) logger.info(`[Reminders] ${sent} recordatorio(s) enviado(s).`);
  }
);

async function sendReminder(companyId: string, appt: Appointment, key: ReminderKey, businessName: string): Promise<void> {
  const lead = await leadsRepository.findById(companyId, appt.leadId);
  if (!lead) {
    logger.warn('[Reminders] Lead no encontrado para la cita', { leadId: appt.leadId });
    return;
  }
  const start = appt.startTime.toDate();
  const name  = appt.leadName ?? lead.name;

  const content =
    key === 'h24' ? buildReminder24h(businessName, name, start) :
    key === 'h2'  ? buildReminder2h(businessName, name, start)  :
                    buildReminder30m(name, appt.googleMeetLink);

  await sendTextToLead(companyId, lead, content);
}

/** Envía un texto al lead por YCloud y lo registra en el CRM. */
async function sendTextToLead(companyId: string, lead: Lead, content: string): Promise<void> {
  const { externalMsgId } = await sendTextToLeadChannel(lead, content);

  const now = Timestamp.now();
  await messagesRepository.create({
    companyId,
    leadId:           lead.id,
    direction:        'outbound',
    senderType:       'system',
    content,
    channel:          'whatsapp',
    status:           'sent',
    twilioMessageSid: externalMsgId,
    aiProcessed:      true,
    createdAt:        now,
  });
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: content.slice(0, 80),
    lastMessageAt:   now,
  });
}
