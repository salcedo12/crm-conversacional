import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Appointment, CreateAppointmentInput } from './appointments.types';

const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('appointments');

export const appointmentsRepository = {

  async create(input: CreateAppointmentInput): Promise<Appointment> {
    const ref = col(input.companyId).doc();
    const now = Timestamp.now();
    const doc: Omit<Appointment, 'id'> = { ...input, createdAt: now, updatedAt: now };
    await ref.set(doc);
    return { id: ref.id, ...doc };
  },

  async findById(companyId: string, id: string): Promise<Appointment | null> {
    const d = await col(companyId).doc(id).get();
    return d.exists ? ({ id: d.id, ...d.data() } as Appointment) : null;
  },

  async findByLead(companyId: string, leadId: string): Promise<Appointment[]> {
    const snap = await col(companyId).where('leadId', '==', leadId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
  },

  /** Lista citas en un rango [from, to] ordenadas por inicio. */
  async listInRange(companyId: string, from: Date, to: Date): Promise<Appointment[]> {
    const snap = await col(companyId)
      .where('startTime', '>=', Timestamp.fromDate(from))
      .where('startTime', '<=', Timestamp.fromDate(to))
      .orderBy('startTime', 'asc')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Appointment));
  },

  /** Lista citas activas que se solapan con [from, to). */
  async listOverlapping(
    companyId: string,
    from: Date,
    to: Date,
    advisorId?: string
  ): Promise<Appointment[]> {
    const snap = await col(companyId)
      .where('startTime', '<', Timestamp.fromDate(to))
      .orderBy('startTime', 'asc')
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Appointment))
      .filter((a) =>
        a.status === 'scheduled' &&
        (!advisorId || a.advisorId === advisorId) &&
        a.endTime.toMillis() > from.getTime()
      );
  },

  async updateStatus(companyId: string, id: string, status: Appointment['status']): Promise<void> {
    await col(companyId).doc(id).update({ status, updatedAt: Timestamp.now() });
  },
};
