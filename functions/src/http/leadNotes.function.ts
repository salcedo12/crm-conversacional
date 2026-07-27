import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { leadsRepository } from '../modules/leads/leads.repository';

const notesCol = (companyId: string, leadId: string) =>
  db.collection('companies').doc(companyId)
    .collection('leads').doc(leadId)
    .collection('notes');

/** Verifica que el usuario puede operar sobre el lead (admin, o asesor asignado). */
async function assertCanEditLead(
  ctx: { uid: string; role: string; companyId: string },
  companyId: string,
  leadId: string
): Promise<void> {
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
  if (!ADMIN_ROLES.includes(ctx.role as never) && lead.assignedTo !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Solo puedes gestionar notas de tus leads asignados.');
  }
}

async function authorName(companyId: string, uid: string): Promise<string> {
  const snap = await db.collection('companies').doc(companyId).collection('users').doc(uid).get();
  const data = snap.data() ?? {};
  return (data.displayName as string) || (data.email as string) || 'Asesor';
}

export const addLeadNote = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      kind:      z.enum(['note', 'reminder']).default('note'),
      text:      z.string().trim().min(1).max(2000),
      dueAt:     z.number().int().positive().optional(), // millis (solo recordatorios)
    }).parse(request.data);
    assertCompany(ctx, data.companyId);
    await assertCanEditLead(ctx, data.companyId, data.leadId);

    if (data.kind === 'reminder' && !data.dueAt) {
      throw new HttpsError('invalid-argument', 'Un recordatorio necesita fecha y hora.');
    }

    const now = Timestamp.now();
    const ref = await notesCol(data.companyId, data.leadId).add({
      companyId:  data.companyId,
      leadId:     data.leadId,
      kind:       data.kind,
      text:       data.text,
      authorId:   ctx.uid,
      authorName: await authorName(data.companyId, ctx.uid),
      createdAt:  now,
      ...(data.kind === 'reminder'
        ? { dueAt: Timestamp.fromMillis(data.dueAt!), done: false, notified: false }
        : {}),
    });

    logger.info('[LeadNotes] Nota creada', { companyId: data.companyId, leadId: data.leadId, kind: data.kind, noteId: ref.id });
    return { noteId: ref.id };
  }
);

export const deleteLeadNote = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      noteId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);
    await assertCanEditLead(ctx, data.companyId, data.leadId);

    await notesCol(data.companyId, data.leadId).doc(data.noteId).delete();
    return { ok: true as const };
  }
);

export const setReminderDone = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      noteId:    z.string().min(1),
      done:      z.boolean(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);
    await assertCanEditLead(ctx, data.companyId, data.leadId);

    await notesCol(data.companyId, data.leadId).doc(data.noteId).update({
      done: data.done,
      // si se marca hecho, ya no debe notificar; si se reabre, permitir notificar de nuevo si sigue vencido
      ...(data.done ? { notified: true } : {}),
    });
    return { ok: true as const };
  }
);
