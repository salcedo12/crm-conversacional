import { createHash } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, messaging } from '../../lib/admin';
import { logger } from '../../utils/logger';
import type { Lead } from '../leads/leads.types';
import type { Message } from './messages.types';

interface PushTokenDoc {
  token: string;
  platform?: string;
}

interface PushDeliveryResult {
  tokenCount: number;
  successCount: number;
  failureCount: number;
}

function leadName(lead: Lead): string {
  return lead.name?.trim() || lead.phone || 'Lead';
}

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function preview(message: Message): string {
  const content = message.content?.trim();
  if (content) return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  if (message.mediaKind) return 'Archivo adjunto';
  return 'Nuevo mensaje entrante';
}

function absoluteUrl(url: string): string | undefined {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.APP_BASE_URL;
  if (!base || !/^https:\/\//i.test(base)) return new URL(url, 'https://crm.grupoconstructormeraki.com.co').href;
  const parsed = new URL(base);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    return new URL(url, 'https://crm.grupoconstructormeraki.com.co').href;
  }
  return new URL(url, parsed).href;
}

function assetUrl(path: string): string {
  return absoluteUrl(path) ?? `https://crm.grupoconstructormeraki.com.co${path}`;
}

/**
 * Envía una notificación push a todos los dispositivos de un asesor.
 * Limpia tokens inválidos. Núcleo reutilizable (mensajes inbound, recordatorios…).
 */
export async function sendAdvisorPush(
  companyId: string,
  advisorId: string | undefined,
  payload: { title: string; body: string; url: string; type: string; leadId?: string }
): Promise<PushDeliveryResult> {
  if (!advisorId) return { tokenCount: 0, successCount: 0, failureCount: 0 };

  const snap = await db
    .collection('companies').doc(companyId)
    .collection('users').doc(advisorId)
    .collection('pushTokens')
    .get();

  const tokenDocs = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as PushTokenDoc) }))
    .filter((doc) => !!doc.token);
  const tokens = tokenDocs.map((doc) => doc.token);

  if (tokens.length === 0) return { tokenCount: 0, successCount: 0, failureCount: 0 };

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body:  payload.body,
    },
    data: {
      companyId,
      ...(payload.leadId ? { leadId: payload.leadId } : {}),
      type:  payload.type,
      title: payload.title,
      body:  payload.body,
      url:   payload.url,
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
      notification: {
        channelId: 'mensajes',
        sound: 'default',
        tag: payload.leadId ?? payload.type,
        priority: 'high',
        visibility: 'private',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          sound: 'default',
          threadId: payload.leadId ?? payload.type,
          contentAvailable: true,
        },
      },
    },
    webpush: {
      headers: { Urgency: 'high' },
      data: {
        companyId,
        ...(payload.leadId ? { leadId: payload.leadId } : {}),
        type:  payload.type,
        title: payload.title,
        body:  payload.body,
        url:   payload.url,
      },
      notification: {
        title: payload.title,
        body:  payload.body,
        icon:  assetUrl('/icon.svg'),
        badge: assetUrl('/icon.svg'),
        tag:   payload.leadId ?? payload.type,
        renotify: true,
      },
      ...(absoluteUrl(payload.url) ? { fcmOptions: { link: absoluteUrl(payload.url) } } : {}),
    },
  });

  const staleTokens = response.responses
    .map((result, index) => ({ result, token: tokens[index] }))
    .filter(({ result }) => {
      const code = result.error?.code;
      return code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token';
    })
    .map(({ token }) => token);

  const now = Timestamp.now();
  await Promise.all(response.responses.map((result, index) => {
    const tokenDoc = tokenDocs[index];
    const tokenRef = db
      .collection('companies').doc(companyId)
      .collection('users').doc(advisorId)
      .collection('pushTokens').doc(tokenDoc.id);

    if (result.success) {
      return tokenRef.set({
        lastPushAttemptAt: now,
        lastPushSuccessAt: now,
        lastPushType: payload.type,
        lastPushErrorCode: FieldValue.delete(),
        lastPushErrorMessage: FieldValue.delete(),
      }, { merge: true }).catch(() => {});
    }

    return tokenRef.set({
      lastPushAttemptAt: now,
      lastPushErrorAt: now,
      lastPushType: payload.type,
      lastPushErrorCode: result.error?.code ?? 'unknown',
      lastPushErrorMessage: result.error?.message ?? 'Unknown push error',
    }, { merge: true }).catch(() => {});
  }));

  await Promise.all(staleTokens.map((token) =>
    db
      .collection('companies').doc(companyId)
      .collection('users').doc(advisorId)
      .collection('pushTokens').doc(tokenId(token))
      .delete()
      .catch(() => {})
  ));

  logger.info('[Push] Notificacion enviada', {
    companyId, advisorId, type: payload.type,
    platforms: tokenDocs.reduce<Record<string, number>>((acc, doc) => {
      const platform = doc.platform ?? 'unknown';
      acc[platform] = (acc[platform] ?? 0) + 1;
      return acc;
    }, {}),
    successCount: response.successCount,
    failureCount: response.failureCount,
    failureCodes: response.responses
      .filter((result) => !result.success)
      .map((result, index) => ({
        tokenId: tokenDocs[index]?.id,
        platform: tokenDocs[index]?.platform,
        code: result.error?.code,
      })),
    staleCount: staleTokens.length,
  });

  return {
    tokenCount: tokens.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
  };
}

export async function sendLeadReassignedPush(companyId: string, lead: Lead, newAdvisorId: string, assignedBy: string): Promise<void> {
  if (newAdvisorId === assignedBy) return;

  const name = leadName(lead);
  const payload = {
    title:  `Nuevo Lead Asignado`,
    body:   `Se te ha asignado el cliente ${name}.`,
    url:    `/dashboard/inbox?lead=${lead.id}`,
    type:   'lead-reassigned',
    leadId: lead.id,
  };

  await sendAdvisorPush(companyId, newAdvisorId, payload);
}

export async function sendInboundLeadPush(companyId: string, lead: Lead, message: Message): Promise<void> {
  const name = leadName(lead);
  const payload = {
    title:  `Meraki CRM - ${name}`,
    body:   `${name}: ${preview(message)}`,
    url:    `/dashboard/inbox?lead=${lead.id}`,
    type:   'inbound-message',
    leadId: lead.id,
  };

  if (lead.assignedTo) {
    const assignedResult = await sendAdvisorPush(companyId, lead.assignedTo, payload);
    if (assignedResult.successCount === 0) {
      logger.warn('[Push] Mensaje inbound sin entrega al asesor asignado', {
        companyId,
        leadId: lead.id,
        assignedTo: lead.assignedTo,
        tokenCount: assignedResult.tokenCount,
        failureCount: assignedResult.failureCount,
      });
    }
    return;
  }

  logger.warn('[Push] Mensaje inbound sin asesor asignado; no se envio push masivo', {
    companyId,
    leadId: lead.id,
  });
}
