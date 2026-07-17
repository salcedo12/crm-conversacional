import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

const FieldSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'number', 'date', 'select']).default('text'),
  options: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
});

const configRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('configs').doc('contactFields');

export const listContactFields = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    const snap = await configRef(companyId).get();
    return { fields: snap.data()?.fields ?? [] };
  }
);

export const saveContactFields = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, fields } = z.object({
      companyId: z.string().min(1),
      fields: z.array(FieldSchema).max(40),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const seen = new Set<string>();
    const normalized = fields.map((field) => {
      const id = field.id.trim();
      if (seen.has(id)) throw new Error(`Campo duplicado: ${id}`);
      seen.add(id);
      return { ...field, id, label: field.label.trim() };
    });

    await configRef(companyId).set({
      companyId,
      fields: normalized,
      updatedBy: ctx.uid,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { fields: normalized };
  }
);
