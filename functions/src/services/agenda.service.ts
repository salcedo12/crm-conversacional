import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { GoogleCalendarService } from './google-calendar.service';
import type { Appointment } from '../types';

const calendarService = new GoogleCalendarService();

export class AgendaService {
  async bookAppointment(
    leadId: string,
    adviserId: string,
    companyId: string,
    title: string,
    startTime: Date,
    durationMinutes = 30
  ): Promise<Appointment> {
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    const [leadSnap, adviserSnap] = await Promise.all([
      db.collection('leads').doc(leadId).get(),
      db.collection('users').doc(adviserId).get(),
    ]);

    if (!leadSnap.exists || !adviserSnap.exists) {
      throw new Error('Lead o Asesor no encontrados en Firestore.');
    }

    const lead = leadSnap.data()!;
    const adviser = adviserSnap.data()!;

    const meetLink = await calendarService.createMeetEvent(
      title,
      `Reunión agendada vía CRM. Lead: ${lead.phoneNumber}`,
      [adviser.email],
      startTime,
      endTime
    );

    const now = Timestamp.now();
    const appointmentRef = db.collection('appointments').doc();
    const appointment: Omit<Appointment, 'id'> = {
      leadId,
      adviserId,
      companyId,
      title,
      startTime: Timestamp.fromDate(startTime),
      endTime: Timestamp.fromDate(endTime),
      googleMeetLink: meetLink ?? undefined,
      status: 'SCHEDULED',
      createdAt: now,
      updatedAt: now,
    };

    await appointmentRef.set(appointment);

    // Actualizar estado del lead
    await db.collection('leads').doc(leadId).update({
      status: 'APPOINTMENT_SET',
      updatedAt: now,
    });

    console.log(`Cita agendada: ${appointmentRef.id} — Meet: ${meetLink}`);
    return { id: appointmentRef.id, ...appointment };
  }
}
