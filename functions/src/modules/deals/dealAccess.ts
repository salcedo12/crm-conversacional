import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { z } from 'zod';
import { db } from '../../lib/admin';
import { ADMIN_ROLES, type AuthContext } from '../../lib/authContext';
import type { Deal } from './deals.types';

/** Acceso compartido por los callables del módulo Negocios. */

export const clientsCol = (companyId: string) => db.collection('companies').doc(companyId).collection('clients');
export const dealsCol = (companyId: string) => db.collection('companies').doc(companyId).collection('deals');

export { EDITABLE_STATUSES, canEditDealBuyers, canEditDealConditions } from './dealStatus';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    throw new HttpsError('invalid-argument', `Datos inválidos para ${what}${where}: ${issue?.message ?? ''}`.trim());
  }
  return parsed.data;
}

export function isAdmin(ctx: AuthContext): boolean {
  return ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role);
}

/** Carga el negocio y verifica que el usuario sea admin o el asesor del negocio. */
export async function loadDeal(ctx: AuthContext, companyId: string, dealId: string): Promise<{ ref: DocumentReference; deal: Deal }> {
  const ref = dealsCol(companyId).doc(dealId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Negocio no encontrado.');
  const deal = { id: snap.id, ...snap.data() } as Deal;
  if (!isAdmin(ctx) && deal.advisorId !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Solo puedes gestionar tus propios negocios.');
  }
  return { ref, deal };
}

export async function userDisplayName(companyId: string, uid: string): Promise<{ name: string; email: string }> {
  const snap = await db.collection('companies').doc(companyId).collection('users').doc(uid).get();
  const data = snap.data() ?? {};
  return {
    name: (data.displayName as string) || (data.email as string) || 'Asesor',
    email: (data.email as string) || '',
  };
}


/** Sincroniza el `advisorId` de los negocios abiertos (no anulados) cuando se reasigna el lead. */
export async function syncOpenDealsAdvisor(
  companyId: string,
  leadId: string,
  advisorId: string,
  now = Timestamp.now(),
): Promise<number> {
  const snap = await dealsCol(companyId).where('leadId', '==', leadId).get();
  const batch = db.batch();
  let synced = 0;
  for (const doc of snap.docs) {
    if (doc.get('status') !== 'anulado' && doc.get('advisorId') !== advisorId) {
      batch.update(doc.ref, { advisorId, updatedAt: now });
      synced += 1;
    }
  }
  if (synced > 0) await batch.commit();
  return synced;
}

export { draftStatusFor } from './dealStatus';
