import { Timestamp } from 'firebase-admin/firestore';
import { db }        from '../../lib/admin';
import type { FollowUpTask, CreateFollowUpTaskInput } from './followups.types';

const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('followUpTasks');

export const followUpsRepository = {

  async create(input: CreateFollowUpTaskInput): Promise<FollowUpTask> {
    const ref = col(input.companyId).doc();
    await ref.set(input);
    return { id: ref.id, ...input };
  },

  /** Crea múltiples tareas en batch */
  async createBatch(tasks: CreateFollowUpTaskInput[]): Promise<void> {
    if (tasks.length === 0) return;
    const batch = db.batch();
    for (const task of tasks) {
      const ref = col(task.companyId).doc();
      batch.set(ref, task);
    }
    await batch.commit();
  },

  /** Cancela todas las tareas pendientes de un lead (cuando el lead responde) */
  async cancelPendingForLead(companyId: string, leadId: string): Promise<void> {
    const snap = await col(companyId)
      .where('leadId',  '==', leadId)
      .where('status',  '==', 'pending')
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { status: 'cancelled' });
    }
    await batch.commit();
  },

  /** Tareas vencidas y pendientes para todas las empresas (usado por scheduler) */
  async getDueTasks(companyId: string, now: Timestamp): Promise<FollowUpTask[]> {
    const snap = await col(companyId)
      .where('status',      '==', 'pending')
      .where('scheduledAt', '<=', now)
      .orderBy('scheduledAt', 'asc')
      .limit(50) // procesar hasta 50 por ciclo
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FollowUpTask));
  },

  async markSent(companyId: string, taskId: string): Promise<void> {
    await col(companyId).doc(taskId).update({ status: 'sent' });
  },

  async markCancelled(companyId: string, taskId: string): Promise<void> {
    await col(companyId).doc(taskId).update({ status: 'cancelled' });
  },
};
