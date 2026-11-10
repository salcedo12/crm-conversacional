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

const AddLeadNoteSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  kind:      z.enum(['note', 'reminder']).default('note'),
  text:      z.string().trim().min(1).max(2000),
  dueAt:     z.number().int().positive().nullish(), // millis (solo recordatorios)
});

const DeleteLeadNoteSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  noteId:    z.string().min(1),
});

const SetReminderDoneSchema = DeleteLeadNoteSchema.extend({
  done: z.boolean(),
});

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Datos invalidos para guardar la nota.');
  }
  return parsed.data;
}

/** Verifica que el usuario puede operar sobre el lead (admin, o asesor asignado). */
async function assertCanEditLead(
  ctx: { uid: string; role: string; companyId: string; platformAdmin?: boolean },
  companyId: string,
  leadId: string
): Promise<void> {
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
  if (!ctx.platformAdmin && !ADMIN_ROLES.includes(ctx.role as never) && lead.assignedTo !== ctx.uid) {
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
    const data = parseInput(AddLeadNoteSchema, request.data);
    assertCompany(ctx, data.companyId);
    await assertCanEditLead(ctx, data.companyId, data.leadId);

    if (data.kind === 'reminder' && !data.dueAt) {
      throw new HttpsError('invalid-argument', 'Un recordatorio necesita fecha y hora.');
    }

    const now = Timestamp.now();
    const author = await authorName(data.companyId, ctx.uid);
    const ref = await notesCol(data.companyId, data.leadId).add({
      companyId:  data.companyId,
      leadId:     data.leadId,
      kind:       data.kind,
      text:       data.text,
      authorId:   ctx.uid,
      authorName: author,
      createdAt:  now,
      ...(data.kind === 'reminder' && data.dueAt
        ? { dueAt: Timestamp.fromMillis(data.dueAt), done: false, notified: false }
        : {}),
    });

    const leadRef = db.collection('companies').doc(data.companyId).collection('leads').doc(data.leadId);
    const leadSnap = await leadRef.get().catch(() => null);
    const leadData = leadSnap?.exists ? leadSnap.data() : null;

    const nowFormatted = new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const newBitEntry = {
      id_registro: `crm_note_${Date.now()}`,
      origen: 'CRM',
      fecha: nowFormatted,
      action: data.kind === 'reminder' ? 'Recordatorio Programado' : 'Nota de Seguimiento Comercial',
      description: data.text.slice(0, 200),
      asesor: author,
      lastDate: nowFormatted,
    };
    const rawExisting = [
      ...(Array.isArray(leadData?.bitacoras) ? leadData.bitacoras : []),
      ...(Array.isArray(leadData?.metadata?.smarthomeBitacoras) ? leadData.metadata.smarthomeBitacoras : []),
      ...(Array.isArray(leadData?.smarthomeBitacoras) ? leadData.smarthomeBitacoras : []),
    ];
    const seenBitKeys = new Set<string>();
    const existingBitacoras: any[] = [];
    for (const b of rawExisting) {
      if (!b || typeof b !== 'object') continue;
      const bKey = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
      if (!seenBitKeys.has(bKey)) {
        seenBitKeys.add(bKey);
        existingBitacoras.push(b);
      }
    }
    const updatedBitacoras = [newBitEntry, ...existingBitacoras].slice(0, 60);

    const leadUpdate: Record<string, any> = {
      lastFollowUpAt: now,
      lastFollowUpAction: data.kind === 'reminder' ? 'recordatorio' : 'nota_comercial',
      lastFollowUpSummary: data.text.slice(0, 180),
      lastFollowUpAuthor: author,
      bitacoras: updatedBitacoras,
      'metadata.smarthomeBitacoras': updatedBitacoras,
      updatedAt: now,
    };
    if (Array.isArray(leadData?.smarthomeBitacoras)) {
      leadUpdate.smarthomeBitacoras = updatedBitacoras;
    }

    if (data.kind === 'reminder' && data.dueAt) {
      const d = new Date(data.dueAt);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const dateFormatted = `${year}-${month}-${day} ${hours}:${mins}`;

      leadUpdate.nextFollowUpDate = dateFormatted;
      leadUpdate.nextFollowUpAction = data.text.slice(0, 80);
    }

    await leadRef.update(leadUpdate).catch(() => {});

    logger.info('[LeadNotes] Nota creada', { companyId: data.companyId, leadId: data.leadId, kind: data.kind, noteId: ref.id });
    return { noteId: ref.id };
  }
);

export const deleteLeadNote = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = parseInput(DeleteLeadNoteSchema, request.data);
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
    const data = parseInput(SetReminderDoneSchema, request.data);
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
