import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { uploadMediaBuffer, mimeToExt } from '../utils/storageUpload';
import { normalizePhone, toNormalizedPhone } from '../utils/phone';
import { advisorWhatsappBridgeClient, type AdvisorWhatsappBridgeStatus } from '../integrations/advisorWhatsapp/advisorWhatsappBridge.client';
import { leadsRepository } from '../modules/leads/leads.repository';
import { ADVISOR_WHATSAPP_SOURCE } from '../modules/leads/leadClassification';
import { messagesRepository } from '../modules/messages/messages.repository';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
import { assertCompany, requireAuth, requireRole, ADMIN_ROLES, type AuthContext } from '../lib/authContext';
import { getAdvisorLineForAdvisor } from '../modules/companies/companyRouting';

const ConnectionSchema = z.object({
  companyId: z.string().min(1),
  advisorId: z.string().min(1).nullish(),
});

const MessageWebhookSchema = z.object({
  eventType: z.literal('message').optional(),
  companyId: z.string().min(1),
  advisorId: z.string().min(1),
  phone: z.string().min(5),
  advisorPhone: z.string().min(5).optional(),
  direction: z.enum(['inbound', 'outbound']),
  content: z.string().max(5000).default(''),
  externalMessageId: z.string().min(1),
  customerName: z.string().max(160).nullish(),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().max(120).optional(),
  mediaKind: z.enum(['image', 'video', 'audio', 'document', 'sticker', 'file']).optional(),
  mediaBase64: z.string().max(28_000_000).optional(), // ~20 MB binario en base64
  fileName: z.string().max(255).optional(),
  createdAt: z.number().optional(),
});

const StatusWebhookSchema = z.object({
  eventType: z.literal('status'),
  companyId: z.string().min(1),
  advisorId: z.string().min(1),
  status: z.enum(['disconnected', 'stale', 'error', 'connected', 'qr_pending', 'configuration_required']),
  advisorPhone: z.string().min(5).optional(),
  error: z.string().max(500).optional(),
  createdAt: z.number().optional(),
});

// Acuse de entrega de un mensaje SALIENTE reflejado desde el WhatsApp personal
// del asesor (Baileys emite `messages.update` con el estado de recibo).
const MessageStatusWebhookSchema = z.object({
  eventType: z.literal('message_status'),
  companyId: z.string().min(1),
  advisorId: z.string().min(1),
  externalMessageId: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  createdAt: z.number().optional(),
});

const WebhookSchema = z.union([
  MessageStatusWebhookSchema,
  StatusWebhookSchema,
  MessageWebhookSchema,
]);

const MAX_ADVISOR_MEDIA_BYTES = 20 * 1024 * 1024;

const connectionsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('advisorWhatsappConnections');

function canManageAdvisor(ctx: AuthContext, advisorId: string): boolean {
  return ctx.uid === advisorId || ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role);
}

function connectionDto(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    advisorId: id,
    status: (data.status ?? 'disconnected') as AdvisorWhatsappBridgeStatus,
    phone: data.phone ?? null,
    displayName: data.displayName ?? null,
    lastSeenAt: data.lastSeenAt?.toMillis?.() ?? null,
    qrExpiresAt: data.qrExpiresAt?.toMillis?.() ?? null,
    error: data.error ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
  };
}

function sessionMillis(value?: string): number | null {
  if (!value) return null;
  const millis = new Date(value).getTime();
  return Number.isNaN(millis) ? null : millis;
}

function safeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function refreshConnectionFromBridge(
  companyId: string,
  advisorId: string,
  current: ReturnType<typeof connectionDto>
): Promise<ReturnType<typeof connectionDto>> {
  if (!advisorWhatsappBridgeClient.configured()) return current;

  try {
    const session = await advisorWhatsappBridgeClient.status({ companyId, advisorId });
    const lastSeenMillis = sessionMillis(session.lastSeenAt);
    const expiresMillis = sessionMillis(session.expiresAt);
    const now = Timestamp.now();

    await connectionsCol(companyId).doc(advisorId).set({
      companyId,
      advisorId,
      status: session.status,
      phone: session.phone ?? current.phone ?? null,
      displayName: session.displayName ?? current.displayName ?? null,
      ...(lastSeenMillis ? { lastSeenAt: Timestamp.fromMillis(lastSeenMillis) } : {}),
      ...(expiresMillis ? { qrExpiresAt: Timestamp.fromMillis(expiresMillis) } : {}),
      error: session.error ?? null,
      updatedAt: now,
    }, { merge: true });

    return {
      ...current,
      status: session.status,
      phone: session.phone ?? current.phone,
      displayName: session.displayName ?? current.displayName,
      lastSeenAt: lastSeenMillis ?? current.lastSeenAt,
      qrExpiresAt: expiresMillis ?? current.qrExpiresAt,
      error: session.error ?? null,
      updatedAt: now.toMillis(),
    };
  } catch (err) {
    logger.warn('[AdvisorWhatsapp] No se pudo refrescar estado del puente', {
      companyId,
      advisorId,
      error: err instanceof Error ? err.message : err,
    });
    return current;
  }
}

async function assertAdvisorBelongsToCompany(companyId: string, advisorId: string): Promise<void> {
  const user = await db.collection('companies').doc(companyId).collection('users').doc(advisorId).get();
  if (!user.exists || user.data()?.active === false) {
    throw new HttpsError('not-found', 'Asesor no encontrado o inactivo.');
  }
}

async function advisorDisplayName(companyId: string, advisorId: string): Promise<string> {
  const doc = await db.collection('companies').doc(companyId).collection('users').doc(advisorId).get();
  const data = doc.data();
  return data?.displayName || data?.email || 'Asesor';
}

async function adminIds(companyId: string): Promise<string[]> {
  const snap = await db.collection('companies').doc(companyId).collection('users')
    .where('active', '==', true)
    .where('role', 'in', ADMIN_ROLES)
    .get();
  return snap.docs.map((doc) => doc.id);
}

async function notifyAdvisorWhatsappDisconnected(input: {
  companyId: string;
  advisorId: string;
  status: AdvisorWhatsappBridgeStatus;
  error?: string;
}) {
  const { companyId, advisorId, status, error } = input;
  if (status !== 'configuration_required' && status !== 'error') return;

  const name = await advisorDisplayName(companyId, advisorId);
  const body = `El WhatsApp de ${name} esta desconectado. Debe volver a escanear QR.`;
  const payload = {
    title: 'Meraki CRM - WhatsApp desconectado',
    body: error ? `${body} ${error}` : body,
    url: '/dashboard/config?tab=connections',
    type: 'advisor-whatsapp-disconnected',
  };

  const recipients = new Set<string>([advisorId, ...(await adminIds(companyId))]);
  await Promise.all([...recipients].map((uid) =>
    sendAdvisorPush(companyId, uid, payload).catch((err) => {
      logger.warn('[AdvisorWhatsapp] No se pudo enviar push de desconexion', {
        companyId,
        advisorId,
        recipient: uid,
        error: err instanceof Error ? err.message : err,
      });
    })
  ));
}

export const listAdvisorWhatsappConnections = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, advisorId } = ConnectionSchema.parse(request.data);
    assertCompany(ctx, companyId);

    if (advisorId && !canManageAdvisor(ctx, advisorId)) {
      throw new HttpsError('permission-denied', 'Solo puedes ver tu propia conexion.');
    }

    if (advisorId) {
      const doc = await connectionsCol(companyId).doc(advisorId).get();
      if (!doc.exists) return { connections: [] };
      const current = connectionDto(doc.id, doc.data() ?? {});
      return { connections: [await refreshConnectionFromBridge(companyId, doc.id, current)] };
    }

    requireRole(ctx, ADMIN_ROLES);
    const snap = await connectionsCol(companyId).orderBy('updatedAt', 'desc').get();
    const connections = await Promise.all(
      snap.docs.map((doc) => refreshConnectionFromBridge(companyId, doc.id, connectionDto(doc.id, doc.data())))
    );
    return { connections };
  }
);

export const requestAdvisorWhatsappQr = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, advisorId } = ConnectionSchema.parse(request.data);
    const resolvedAdvisorId = advisorId ?? ctx.uid;
    assertCompany(ctx, companyId);
    if (!canManageAdvisor(ctx, resolvedAdvisorId)) {
      throw new HttpsError('permission-denied', 'Solo puedes conectar tu propio WhatsApp.');
    }
    await assertAdvisorBelongsToCompany(companyId, resolvedAdvisorId);

    const now = Timestamp.now();
    const ref = connectionsCol(companyId).doc(resolvedAdvisorId);

    if (!advisorWhatsappBridgeClient.configured()) {
      await ref.set({
        companyId,
        advisorId: resolvedAdvisorId,
        status: 'configuration_required',
        updatedAt: now,
      }, { merge: true });
      return {
        status: 'configuration_required',
        configured: false,
        message: 'Falta configurar el puente de WhatsApp de asesor en el servidor.',
      };
    }

    try {
      const session = await advisorWhatsappBridgeClient.requestQr({ companyId, advisorId: resolvedAdvisorId });
      await ref.set({
        companyId,
        advisorId: resolvedAdvisorId,
        status: session.status,
        phone: session.phone ?? null,
        displayName: session.displayName ?? null,
        lastSeenAt: session.lastSeenAt ? Timestamp.fromDate(new Date(session.lastSeenAt)) : null,
        qrExpiresAt: session.expiresAt ? Timestamp.fromDate(new Date(session.expiresAt)) : null,
        error: session.error ?? null,
        updatedAt: now,
      }, { merge: true });
      return { ...session, configured: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo pedir el QR.';
      await ref.set({
        companyId,
        advisorId: resolvedAdvisorId,
        status: 'error',
        error: message,
        updatedAt: now,
      }, { merge: true });
      logger.error('[AdvisorWhatsapp] Error pidiendo QR', { companyId, advisorId: resolvedAdvisorId, error: message });
      throw new HttpsError('internal', message);
    }
  }
);

export const disconnectAdvisorWhatsapp = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, advisorId } = ConnectionSchema.parse(request.data);
    const resolvedAdvisorId = advisorId ?? ctx.uid;
    assertCompany(ctx, companyId);
    if (!canManageAdvisor(ctx, resolvedAdvisorId)) {
      throw new HttpsError('permission-denied', 'Solo puedes desconectar tu propio WhatsApp.');
    }

    if (advisorWhatsappBridgeClient.configured()) {
      await advisorWhatsappBridgeClient.disconnect({ companyId, advisorId: resolvedAdvisorId });
    }
    await connectionsCol(companyId).doc(resolvedAdvisorId).set({
      companyId,
      advisorId: resolvedAdvisorId,
      status: 'disconnected',
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { ok: true };
  }
);

/**
 * Devuelve la LÍNEA DE COEXISTENCIA (YCloud) del asesor, si tiene una registrada.
 * La usa el inbox para habilitar "Mi WhatsApp" (envío por su propio número por la
 * API oficial) sin depender del puente Baileys. Un asesor consulta la suya; un
 * admin puede consultar la de cualquiera.
 */
export const getMyMessagingLine = onCall(
  { region: 'us-central1', timeoutSeconds: 15 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, advisorId } = ConnectionSchema.parse(request.data);
    assertCompany(ctx, companyId);
    const resolvedAdvisorId = advisorId ?? ctx.uid;
    if (!canManageAdvisor(ctx, resolvedAdvisorId)) {
      throw new HttpsError('permission-denied', 'Solo puedes ver tu propia línea.');
    }
    const line = await getAdvisorLineForAdvisor(companyId, resolvedAdvisorId);
    return { line };  // { number, wabaId? } | null
  }
);

export const advisorWhatsappWebhook = onRequest(
  // 1GiB: reflejar media (imagenes/videos/documentos) del WhatsApp del asesor
  // decodifica el base64 a Buffer y lo re-sube a Storage. Con los 256MiB por
  // defecto el contenedor hacia OOM (~290MiB) y Cloud Run mataba la peticion a
  // mitad, perdiendo el mensaje. Mismo criterio que ycloudWebhook.
  { region: 'us-central1', timeoutSeconds: 60, memory: '1GiB' },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }

    const configuredSecret = env.advisorWhatsappWebhookSecret();
    const providedSecret = request.get('X-Advisor-Whatsapp-Secret') ?? String(request.query.secret ?? '');
    if (configuredSecret && providedSecret !== configuredSecret) {
      response.status(401).send('Unauthorized');
      return;
    }

    const parsed = WebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;

    // Acuse de entrega de un mensaje saliente (enviado → entregado → leído / falló).
    // Localiza el mensaje por su ID externo (no necesita el lead) y avanza el estado.
    if (data.eventType === 'message_status') {
      const found = await messagesRepository.updateStatusByExternalId(
        data.externalMessageId,
        data.status
      );
      if (!found) {
        logger.info('[AdvisorWhatsapp] Acuse recibido para mensaje aun no reflejado', {
          companyId: data.companyId,
          advisorId: data.advisorId,
          externalMessageId: data.externalMessageId,
          status: data.status,
        });
      }
      response.json({ ok: true });
      return;
    }

    if (data.eventType === 'status') {
      const ref = connectionsCol(data.companyId).doc(data.advisorId);
      const previous = await ref.get();
      const previousStatus = previous.data()?.status as AdvisorWhatsappBridgeStatus | undefined;
      const createdAt = data.createdAt ? Timestamp.fromMillis(data.createdAt) : Timestamp.now();

      await ref.set({
        companyId: data.companyId,
        advisorId: data.advisorId,
        status: data.status,
        ...(data.advisorPhone ? { phone: normalizePhone(data.advisorPhone) } : {}),
        error: data.error ?? null,
        lastSeenAt: createdAt,
        updatedAt: Timestamp.now(),
      }, { merge: true });

      if (previousStatus === 'connected' && data.status !== 'connected') {
        await notifyAdvisorWhatsappDisconnected({
          companyId: data.companyId,
          advisorId: data.advisorId,
          status: data.status,
          error: data.error,
        });
      }

      response.json({ ok: true });
      return;
    }

    const phone = normalizePhone(data.phone);
    const normalizedPhone = toNormalizedPhone(phone);
    const createdAt = data.createdAt ? Timestamp.fromMillis(data.createdAt) : Timestamp.now();

    await connectionsCol(data.companyId).doc(data.advisorId).set({
      companyId: data.companyId,
      advisorId: data.advisorId,
      status: 'connected',
      ...(data.advisorPhone ? { phone: normalizePhone(data.advisorPhone) } : {}),
      lastSeenAt: createdAt,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    let lead = await leadsRepository.findByNormalizedPhone(data.companyId, normalizedPhone);
    if (!lead) {
      lead = await leadsRepository.create(data.companyId, {
        companyId: data.companyId,
        phone,
        normalizedPhone,
        name: data.customerName || phone,
        status: 'active',
        // Fuente propia: entró DIRECTO al WhatsApp del asesor, no por el 317.
        // Se excluye de estadísticas y del reparto de datos (ver leadClassification).
        source: ADVISOR_WHATSAPP_SOURCE,
        channel: 'whatsapp',
        inboxProvider: 'ycloud',
        assignedTo: data.advisorId,
        aiEnabled: false,
        lastInboundAt: data.direction === 'inbound' ? createdAt : undefined,
        lastAdvisorMessageAt: data.direction === 'outbound' ? createdAt : undefined,
        lastMessageAt: createdAt,
        lastMessageText: data.content,
        createdAt,
        updatedAt: createdAt,
        tags: [],
        metadata: { advisorWhatsappMirror: 'true' },
      });
    }

    const exists = await messagesRepository.findByTwilioSid(data.companyId, lead.id, data.externalMessageId);
    if (!exists) {
      let mediaUrl = data.mediaUrl;
      let mediaStoragePath: string | undefined;
      if (!mediaUrl && data.mediaBase64 && data.mediaType) {
        try {
          const buffer = Buffer.from(data.mediaBase64, 'base64');
          if (buffer.length <= MAX_ADVISOR_MEDIA_BYTES) {
            const ext = mimeToExt(data.mediaType);
            const baseName = data.fileName
              ? safeStorageSegment(data.fileName)
              : `advisor-whatsapp-${safeStorageSegment(data.externalMessageId)}.${ext}`;
            const path = `companies/${data.companyId}/media/${lead.id}/advisor-whatsapp/${Date.now()}_${baseName}`;
            const uploaded = await uploadMediaBuffer(buffer, data.mediaType, path);
            mediaUrl = uploaded.downloadUrl;
            mediaStoragePath = uploaded.storagePath;
          } else {
            logger.warn('[AdvisorWhatsapp] Media omitida por limite de tamano', {
              companyId: data.companyId,
              advisorId: data.advisorId,
              externalMessageId: data.externalMessageId,
              bytes: buffer.length,
            });
          }
        } catch (err) {
          logger.warn('[AdvisorWhatsapp] No se pudo subir media reflejada', {
            companyId: data.companyId,
            advisorId: data.advisorId,
            externalMessageId: data.externalMessageId,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      await messagesRepository.create({
        companyId: data.companyId,
        leadId: lead.id,
        direction: data.direction,
        senderType: data.direction === 'outbound' ? 'advisor' : 'lead',
        content: data.content,
        channel: 'whatsapp',
        status: 'sent',
        twilioMessageSid: data.externalMessageId,
        ...(data.direction === 'outbound' ? { advisorId: data.advisorId } : {}),
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(data.mediaType ? { mediaType: data.mediaType } : {}),
        ...(data.mediaKind ? { mediaKind: data.mediaKind } : {}),
        ...(data.fileName ? { fileName: data.fileName } : {}),
        ...(mediaStoragePath ? { mediaStoragePath } : {}),
        createdAt,
        metadata: {
          origin: 'advisor_whatsapp_mirror',
          advisorId: data.advisorId,
          deliveryChannel: 'advisor_whatsapp',
          ...(data.advisorPhone ? { advisorPhone: normalizePhone(data.advisorPhone) } : {}),
        },
      });
    }

    const leadUpdate: Record<string, unknown> = {
      lastMessageAt: createdAt,
      lastMessageText: data.content || (data.mediaType ? 'Archivo' : ''),
      aiEnabled: false,
    };
    if (data.direction === 'inbound') leadUpdate.lastInboundAt = createdAt;
    if (data.direction === 'outbound') {
      leadUpdate.lastAdvisorMessageAt = createdAt;
      leadUpdate.assignedTo = data.advisorId;
      leadUpdate.pendingFirstContact = false;
    }
    await leadsRepository.update(data.companyId, lead.id, leadUpdate);

    response.json({ ok: true, leadId: lead.id });
  }
);
