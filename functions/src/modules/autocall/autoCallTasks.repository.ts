import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';

export type AutoCallTaskKind   = 'initial' | 'retry' | 'followup';
export type AutoCallTaskStatus = 'pending' | 'fired' | 'canceled' | 'skipped';

export interface AutoCallTask {
  id:         string;
  companyId:  string;
  leadId:     string;
  leadPhone:  string;
  /** Número de intento que representa esta tarea (1 = inicial, 2 = 1er reintento, …). */
  attempt:    number;
  kind:       AutoCallTaskKind;
  scheduledAt: Timestamp;
  /** Instante del primer intento de la cadena (ancla para offsets de reintento). */
  anchorAt?:  Timestamp;
  status:     AutoCallTaskStatus;
  /** Id de la llamada creada al disparar (si status = 'fired'). */
  callId?:    string;
  firedAt?:   Timestamp;
  createdAt:  Timestamp;
  updatedAt?: Timestamp;
}

export type CreateAutoCallTaskInput = Omit<AutoCallTask, 'id' | 'createdAt' | 'updatedAt'>;

const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('autoCallTasks');

export const autoCallTasksRepository = {
  async create(input: CreateAutoCallTaskInput): Promise<AutoCallTask> {
    const ref = col(input.companyId).doc();
    const now = Timestamp.now();
    const doc: Omit<AutoCallTask, 'id'> = { ...input, createdAt: now, updatedAt: now };
    await ref.set(doc);
    return { id: ref.id, ...doc };
  },

  /** Tareas pendientes cuyo horario ya llegó (scheduledAt <= now). */
  async findDue(companyId: string, now: Timestamp, max = 50): Promise<AutoCallTask[]> {
    const snap = await col(companyId)
      .where('status', '==', 'pending')
      .where('scheduledAt', '<=', now)
      .orderBy('scheduledAt', 'asc')
      .limit(max)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AutoCallTask));
  },

  /** ¿El lead ya tiene alguna tarea de auto-llamada (para no encolar la inicial dos veces)? */
  async existsForLead(companyId: string, leadId: string): Promise<boolean> {
    const snap = await col(companyId).where('leadId', '==', leadId).limit(1).get();
    return !snap.empty;
  },

  /** ¿El lead tiene una tarea PENDIENTE (para no encolar reintentos/seguimientos duplicados)? */
  async existsPendingForLead(companyId: string, leadId: string): Promise<boolean> {
    const snap = await col(companyId)
      .where('leadId', '==', leadId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    return !snap.empty;
  },

  async update(companyId: string, id: string, patch: Partial<AutoCallTask>): Promise<void> {
    await col(companyId).doc(id).update({ ...patch, updatedAt: Timestamp.now() });
  },

  /** Cuenta tareas disparadas desde `since` (para el tope diario de costo). */
  async countFiredSince(companyId: string, since: Timestamp): Promise<number> {
    const snap = await col(companyId)
      .where('status', '==', 'fired')
      .where('firedAt', '>=', since)
      .get();
    return snap.size;
  },
};
