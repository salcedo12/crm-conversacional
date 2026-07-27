import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../lib/admin';
import { leadsRepository } from '../modules/leads/leads.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

const MarkLeadReadSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
});

const MarkLeadsReadSchema = z.object({
  companyId: z.string().min(1),
  leadIds:   z.array(z.string().min(1)).min(1).max(400),
});

const RegisterPushTokenSchema = z.object({
  companyId: z.string().min(1),
  token:     z.string().min(20),
  platform:  z.string().max(40).default('web'),
});

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const markLeadRead = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = MarkLeadReadSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId, leadId } = parse.data;
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!ADMIN_ROLES.includes(ctx.role) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes marcar como leidos tus leads asignados.');
    }

    await db
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .update(new FieldPath('readBy', ctx.uid), Timestamp.now());

    return { ok: true as const };
  }
);

export const markLeadsRead = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = MarkLeadsReadSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId, leadIds } = parse.data;
    assertCompany(ctx, companyId);

    // Solo escribe la marca de lectura del propio usuario en cada lead (benigno).
    // set+merge no falla si algún doc no existe y preserva el readBy de otros usuarios.
    const now = Timestamp.now();
    const col = db.collection('companies').doc(companyId).collection('leads');
    const batch = db.batch();
    for (const leadId of leadIds) {
      batch.set(col.doc(leadId), { readBy: { [ctx.uid]: now } }, { merge: true });
    }
    await batch.commit();

    return { updated: leadIds.length };
  }
);

export const registerPushToken = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = RegisterPushTokenSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId, token, platform } = parse.data;
    assertCompany(ctx, companyId);

    await db
      .collection('companies').doc(companyId)
      .collection('users').doc(ctx.uid)
      .collection('pushTokens').doc(tokenId(token))
      .set({
        token,
        platform,
        userAgent: request.rawRequest.get('user-agent') ?? '',
        updatedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      }, { merge: true });

    return { ok: true as const };
  }
);
