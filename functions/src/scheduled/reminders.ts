import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import type { Appointment } from '../types';

// Equivalente al node-cron '*/5 * * * *' del backend original
// En Blaze plan, Firebase Scheduled Functions usan sintaxis cron de App Engine
export const processReminders = onSchedule(
  { schedule: 'every 5 minutes', region: 'us-central1', timeZone: 'America/Mexico_City' },
  async () => {
    console.log('[Reminders] Evaluando recordatorios de citas...');

    const now = new Date();
    const nowTimestamp = Timestamp.fromDate(now);

    const snapshot = await db
      .collection('appointments')
      .where('status', '==', 'SCHEDULED')
      .where('startTime', '>', nowTimestamp)
      .get();

    if (snapshot.empty) {
      console.log('[Reminders] Sin citas pendientes.');
      return;
    }

    const tasks: Promise<void>[] = [];

    for (const doc of snapshot.docs) {
      const appointment = { id: doc.id, ...doc.data() } as Appointment;
      const startMs = appointment.startTime.toMillis();
      const hoursDiff = (startMs - now.getTime()) / (1000 * 60 * 60);

      if (hoursDiff <= 24.1 && hoursDiff >= 23.9) {
        tasks.push(sendReminder(appointment.leadId, appointment.googleMeetLink, 24));
      }

      if (hoursDiff <= 1.1 && hoursDiff >= 0.9) {
        tasks.push(sendReminder(appointment.leadId, appointment.googleMeetLink, 1));
      }
    }

    await Promise.all(tasks);
    console.log(`[Reminders] ${tasks.length} recordatorio(s) enviado(s).`);
  }
);

async function sendReminder(
  leadId: string,
  meetLink: string | undefined,
  hoursRemaining: number
): Promise<void> {
  const leadSnap = await db.collection('leads').doc(leadId).get();
  if (!leadSnap.exists) return;

  const phone: string = leadSnap.data()!.phoneNumber;
  const link = meetLink ?? 'Sin Link';

  // En producción: llamar a la Meta API con un template de WhatsApp
  console.log(
    `[WhatsApp Template] → ${phone}: "Tu cita es en ${hoursRemaining} ${
      hoursRemaining === 1 ? 'hora' : 'horas'
    }. Link: ${link}"`
  );
}
