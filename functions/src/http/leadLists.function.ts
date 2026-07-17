import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

const FilterSchema = z.object({
  status: z.enum(['all', 'new', 'active', 'qualified', 'scheduled', 'lost', 'closed']).default('all'),
  aiEnabled: z.enum(['all', 'active', 'manual']).default('all'),
  assignedTo: z.string().max(128).default('all'),
  tags: z.array(z.string().max(40)).max(20).default([]),
  inboxId: z.string().max(40).default('all'),
});

const ImportRowSchema = z.object({
  name: z.string().max(120).optional().default(''),
  phone: z.string().min(7).max(40),
  email: z.string().max(160).optional().default(''),
  company: z.string().max(160).optional().default(''),
  metadata: z.record(z.string(), z.string().max(500)).optional().default({}),
});

const listCollection = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leadLists');
const leadCollection = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

function normalizeImportedPhone(raw: string): { phone: string; normalizedPhone: string } | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (digits.length < 7 || digits.length > 15) return null;
  const phone = `+${digits}`;
  return { phone, normalizedPhone: phone.toLowerCase() };
}

export const listLeadLists = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await listCollection(companyId).orderBy('createdAt', 'asc').get();
    return {
      lists: snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          kind: data.kind,
          filters: data.filters ?? null,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
          createdBy: data.createdBy ?? '',
          sourceFileName: data.sourceFileName ?? '',
          sourceRowCount: data.sourceRowCount ?? 0,
          importedCount: data.importedCount ?? 0,
          importedCreated: data.importedCreated ?? 0,
          importedUpdated: data.importedUpdated ?? 0,
          importedInvalid: data.importedInvalid ?? 0,
          lastImportAt: data.lastImportAt?.toMillis?.() ?? null,
        };
      }),
    };
  }
);

export const createLeadList = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      name: z.string().trim().min(1).max(60),
      kind: z.enum(['smart', 'import']).default('smart'),
      filters: FilterSchema.optional(),
      sourceFileName: z.string().max(160).optional(),
      sourceRowCount: z.number().int().min(0).max(100000).optional(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const duplicate = await listCollection(data.companyId).where('name', '==', data.name).limit(1).get();
    if (!duplicate.empty) throw new HttpsError('already-exists', 'Ya existe una lista con ese nombre.');

    const ref = listCollection(data.companyId).doc();
    await ref.set({
      companyId: data.companyId,
      name: data.name,
      kind: data.kind,
      filters: data.kind === 'smart' ? data.filters ?? FilterSchema.parse({}) : null,
      sourceFileName: data.sourceFileName ?? '',
      sourceRowCount: data.sourceRowCount ?? 0,
      importedCount: 0,
      importedCreated: 0,
      importedUpdated: 0,
      importedInvalid: 0,
      createdBy: ctx.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return { listId: ref.id };
  }
);

export const deleteLeadList = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, listId } = z.object({
      companyId: z.string().min(1), listId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);
    await listCollection(companyId).doc(listId).delete();
    return { ok: true };
  }
);

export const importLeadsChunk = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      listId: z.string().min(1),
      rows: z.array(ImportRowSchema).min(1).max(300),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const listRef = listCollection(data.companyId).doc(data.listId);
    const listSnap = await listRef.get();
    if (!listSnap.exists || listSnap.data()?.kind !== 'import') {
      throw new HttpsError('failed-precondition', 'La lista de importacion no existe.');
    }

    const unique = new Map<string, z.infer<typeof ImportRowSchema> & { formattedPhone: string }>();
    let invalid = 0;
    for (const row of data.rows) {
      const normalized = normalizeImportedPhone(row.phone);
      if (!normalized) {
        invalid++;
        continue;
      }
      unique.set(normalized.normalizedPhone, { ...row, formattedPhone: normalized.phone });
    }

    const phones = [...unique.keys()];
    const existing = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let index = 0; index < phones.length; index += 30) {
      const phoneChunk = phones.slice(index, index + 30);
      if (!phoneChunk.length) continue;
      const snap = await leadCollection(data.companyId).where('normalizedPhone', 'in', phoneChunk).get();
      for (const doc of snap.docs) existing.set(doc.data().normalizedPhone, doc);
    }

    const now = Timestamp.now();
    const batch = db.batch();
    let created = 0;
    let updated = 0;

    for (const [normalizedPhone, row] of unique) {
      const existingDoc = existing.get(normalizedPhone);
      const metadata = {
        ...(existingDoc?.data().metadata ?? {}),
        ...(row.email ? { email: row.email } : {}),
        ...(row.company ? { company: row.company } : {}),
        ...row.metadata,
      };

      if (existingDoc) {
        batch.update(existingDoc.ref, {
          ...(row.name ? { name: row.name } : {}),
          listIds: FieldValue.arrayUnion(data.listId),
          ...(data.tags.length ? { tags: FieldValue.arrayUnion(...data.tags) } : {}),
          metadata,
          updatedAt: now,
        });
        updated++;
      } else {
        const ref = leadCollection(data.companyId).doc();
        batch.set(ref, {
          companyId: data.companyId,
          name: row.name || `Lead ${row.formattedPhone}`,
          phone: row.formattedPhone,
          normalizedPhone,
          status: 'new',
          source: 'manual',
          aiEnabled: false,
          lastMessageText: 'Contacto importado',
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
          tags: data.tags,
          listIds: [data.listId],
          metadata,
        });
        created++;
      }
    }

    batch.update(listRef, {
      updatedAt: now,
      lastImportAt: now,
      importedCount: FieldValue.increment(created + updated),
      importedCreated: FieldValue.increment(created),
      importedUpdated: FieldValue.increment(updated),
      importedInvalid: FieldValue.increment(invalid),
    });
    await batch.commit();

    logger.info('[LeadImport] Lote importado', {
      companyId: data.companyId, listId: data.listId, created, updated, invalid,
    });
    return { created, updated, invalid };
  }
);
