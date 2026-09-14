import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { z } from 'zod';
import { db, messaging } from '../lib/admin';
import { leadsRepository } from '../modules/leads/leads.repository';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
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

const PushStatusSchema = z.object({
  companyId: z.string().min(1),
});

const TestDevicePushSchema = z.object({
  companyId: z.string().min(1),
  tokenId:   z.string().min(20),
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
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
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

    const id = tokenId(token);

    await db
      .collection('companies').doc(companyId)
      .collection('users').doc(ctx.uid)
      .collection('pushTokens').doc(id)
      .set({
        token,
        platform,
        userAgent: request.rawRequest.get('user-agent') ?? '',
        updatedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
      }, { merge: true });

    return { ok: true as const, tokenId: id };
  }
);

export const getPushNotificationStatus = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = PushStatusSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId } = parse.data;
    assertCompany(ctx, companyId);

    const snap = await db
      .collection('companies').doc(companyId)
      .collection('users').doc(ctx.uid)
      .collection('pushTokens')
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get();

    return {
      tokenCount: snap.size,
      devices: snap.docs.map((doc) => {
        const data = doc.data() as {
          platform?: string;
          updatedAt?: Timestamp;
          userAgent?: string;
          lastPushAttemptAt?: Timestamp;
          lastPushSuccessAt?: Timestamp;
          lastPushErrorAt?: Timestamp;
          lastPushErrorCode?: string;
          lastPushErrorMessage?: string;
        };
        return {
          id: doc.id,
          platform: data.platform ?? 'web',
          updatedAt: data.updatedAt?.toMillis?.() ?? null,
          userAgent: data.userAgent ?? '',
          lastPushAttemptAt: data.lastPushAttemptAt?.toMillis?.() ?? null,
          lastPushSuccessAt: data.lastPushSuccessAt?.toMillis?.() ?? null,
          lastPushErrorAt: data.lastPushErrorAt?.toMillis?.() ?? null,
          lastPushErrorCode: data.lastPushErrorCode ?? null,
          lastPushErrorMessage: data.lastPushErrorMessage ?? null,
        };
      }),
    };
  }
);

export const sendTestPushNotification = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = PushStatusSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId } = parse.data;
    assertCompany(ctx, companyId);

    await sendAdvisorPush(companyId, ctx.uid, {
      title: 'Meraki CRM - prueba',
      body: 'Si ves esto, este dispositivo ya recibe notificaciones.',
      url: '/dashboard/inbox',
      type: 'test-push',
    });

    return { ok: true as const };
  }
);

export const sendTestPushToDevice = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    cors: true,
  },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = TestDevicePushSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos invalidos.');

    const { companyId, tokenId: pushTokenId } = parse.data;
    assertCompany(ctx, companyId);

    const tokenSnap = await db
      .collection('companies').doc(companyId)
      .collection('users').doc(ctx.uid)
      .collection('pushTokens').doc(pushTokenId)
      .get();

    if (!tokenSnap.exists) {
      throw new HttpsError('not-found', 'Este dispositivo no tiene token registrado.');
    }

    const token = tokenSnap.data()?.token;
    if (typeof token !== 'string' || !token) {
      throw new HttpsError('failed-precondition', 'El token de este dispositivo no es valido.');
    }

    const pushData = {
        companyId,
        type: 'test-device-push',
        title: 'Meraki CRM - prueba Android',
        body: 'Esta prueba fue enviada solo a este dispositivo.',
        url: '/dashboard/inbox',
    };
    const tokenRef = tokenSnap.ref;
    const now = Timestamp.now();

    try {
      const messageId = await messaging.send({
      token,
      notification: {
        title: pushData.title,
        body: pushData.body,
      },
      data: pushData,
      webpush: {
        headers: { Urgency: 'high' },
        data: pushData,
        notification: {
          title: pushData.title,
          body: pushData.body,
          icon: 'https://crm.grupoconstructormeraki.com.co/icon.svg',
          badge: 'https://crm.grupoconstructormeraki.com.co/icon.svg',
          tag: 'android-test-push',
        },
      },
    });

      await tokenRef.set({
        lastPushAttemptAt: now,
        lastPushSuccessAt: Timestamp.now(),
        lastPushType: 'test-device-push',
        lastPushErrorCode: FieldValue.delete(),
        lastPushErrorMessage: FieldValue.delete(),
      }, { merge: true });

      return { ok: true as const, messageId };
    } catch (err) {
      const error = err as { code?: string; message?: string };
      await tokenRef.set({
        lastPushAttemptAt: now,
        lastPushErrorAt: Timestamp.now(),
        lastPushType: 'test-device-push',
        lastPushErrorCode: error.code ?? 'unknown',
        lastPushErrorMessage: error.message ?? 'Unknown push error',
      }, { merge: true });

      throw new HttpsError('internal', `Firebase rechazo el push: ${error.code ?? 'unknown'} ${error.message ?? ''}`.trim());
    }
  }
);
