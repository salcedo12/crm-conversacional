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
import type { Lead } from '../modules/leads/leads.types';
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

const FORBIDDEN_PLACEHOLDER_NAMES = [
  'ai luis carlos',
  'luis carlos machado',
  'luisa zuluaga',
  'juana avila',
  'alexander zuluaga',
  'claudia bolaños',
  'claudia bolanos',
  'angelica acevedo',
  'adriana montaña',
  'adriana montana',
  'adriana garzon',
  'adriana garzón',
  'laura torres',
  'oscar narvaez',
  'stiven aviles',
  'edwin ramirez',
  'encuentra tu refugio',
  'grupo constructor meraki',
  'constructor meraki',
  'sala de ventas',
  'asesor',
];

function sanitizeCustomerName(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const clean = name.trim();
  const lower = clean.toLowerCase();
  if (
    FORBIDDEN_PLACEHOLDER_NAMES.some((f) => lower.includes(f)) ||
    lower.startsWith('ai ') ||
    clean === '.' ||
    clean === '-' ||
    lower === 'no dio nombre'
  ) {
    return fallback;
  }
  return clean;
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

import { isCompanyTeamPhone } from '../modules/companies/teamPhones';
export { isCompanyTeamPhone };

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

/**
 * Busca de forma exhaustiva si el contacto ya existe como lead en la empresa,
 * para asegurar que BAJO NINGUNA CIRCUNSTANCIA se cree un lead duplicado.
 * Busca por:
 * 1. Teléfono exacto (+14846305709, etc.)
 * 2. Teléfono normalizado (+14846305709, +57...)
 * 3. Dígitos limpios sin signos
 * 4. Cola universal de 10 dígitos (nacional o móvil internacional, sin importar país)
 * 5. Fallback histórico con prefijo +57 si fue guardado erróneamente en el pasado
 * 6. Cola de 9 dígitos
 */
async function findExistingLeadForAdvisorWebhook(
  companyId: string,
  rawPhone: string
): Promise<Lead | null> {
  const phone = normalizePhone(rawPhone);
  const normalizedPhone = toNormalizedPhone(phone);
  const digits = phone.replace(/\D/g, '');

  // 1. Coincidencia exacta por phone
  let lead = await leadsRepository.findByPhone(companyId, phone);
  if (lead) return lead;

  // 2. Coincidencia exacta por normalizedPhone
  lead = await leadsRepository.findByNormalizedPhone(companyId, normalizedPhone);
  if (lead) return lead;

  // 3. Coincidencia por phone con dígitos limpios o con prefijo '+'
  if (digits && digits !== phone) {
    lead = await leadsRepository.findByPhone(companyId, digits);
    if (lead) return lead;
  }
  if (digits && !phone.startsWith('+')) {
    lead = await leadsRepository.findByPhone(companyId, `+${digits}`);
    if (lead) return lead;
  }

  // 4. Coincidencia por cola de 10 dígitos (universal)
  if (digits.length >= 10) {
    const tail10 = digits.slice(-10);
    lead = await leadsRepository.findByPhoneTail(companyId, tail10);
    if (lead) return lead;

    // Fallback: leads heredados donde se antepuso +57 por error
    lead = await leadsRepository.findByNormalizedPhone(companyId, `+57${tail10}`);
    if (lead) return lead;
    lead = await leadsRepository.findByPhone(companyId, `+57${tail10}`);
    if (lead) return lead;
  }

  // 5. Coincidencia por cola de 9 dígitos
  if (digits.length >= 9) {
    const tail9 = digits.slice(-9);
    lead = await leadsRepository.findByPhoneTail(companyId, tail9);
    if (lead) return lead;
  }

  return null;
}

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

    // ── FILTRO B: NÚMEROS INTERNOS DEL EQUIPO (ASESORES / EMPRESA) ──────────
    // Evita que conversaciones entre compañeros (o llamadas/mensajes entre asesores)
    // se creen como leads o contaminen el CRM.
    if (await isCompanyTeamPhone(data.companyId, phone)) {
      logger.info('[AdvisorWhatsapp] Mensaje interno entre miembros del equipo omitido', {
        companyId: data.companyId,
        advisorId: data.advisorId,
        phone,
        direction: data.direction,
      });
      response.json({ ok: true, ignored: true, reason: 'internal_team_phone' });
      return;
    }

    // En mensajes salientes (outbound), el customerName enviado por el puente Baileys
    // corresponde al pushName del PROPIO ASESOR (remitente), NO al cliente.
    // Solo usamos el customerName si el mensaje proviene del cliente (inbound).
    const cleanCustomerName = data.direction === 'inbound'
      ? sanitizeCustomerName(data.customerName, '')
      : '';

    let lead = await findExistingLeadForAdvisorWebhook(data.companyId, phone);

    // Auto-sanación: si el lead ya existía con un normalizedPhone distorsionado
    // (ej. '+57' antepuesto por error histórico en un número internacional), corregirlo al formato correcto.
    if (lead && lead.normalizedPhone !== normalizedPhone && phone.startsWith('+1')) {
      await leadsRepository.update(data.companyId, lead.id, { normalizedPhone });
      lead.normalizedPhone = normalizedPhone;
    }

    const digitsOnly = phone.replace(/\D/g, '');
    let isNewLead = false;
    if (!lead) {
      isNewLead = true;
      lead = await leadsRepository.create(data.companyId, {
        companyId: data.companyId,
        phone,
        normalizedPhone,
        phoneTail: digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly,
        name: cleanCustomerName || phone,
        status: 'active',
        // Fuente propia: entró DIRECTO al WhatsApp del asesor, no por el 317.
        // Se excluye de estadísticas, SmartHome y reparto/reasignación (ver leadClassification).
        source: ADVISOR_WHATSAPP_SOURCE,
        inbox: 'advisor_direct',
        channel: 'whatsapp',
        inboxProvider: 'ycloud',
        assignedTo: data.advisorId,
        advisorAssignedAt: createdAt,
        assignmentLocked: true,
        pendingFirstContact: false,
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
    } else {
      const existingUpdates: Record<string, unknown> = {};
      const neverEnteredCentral317 = !lead.inboxId && (
        lead.id.startsWith('sm_') ||
        lead.tags?.includes('smarthome_migracion') ||
        Boolean(lead.metadata?.migratedFrom) ||
        lead.source === 'manual'
      );
      if (neverEnteredCentral317) {
        existingUpdates.inbox = 'advisor_direct';
        existingUpdates.source = ADVISOR_WHATSAPP_SOURCE;
        existingUpdates['metadata.advisorWhatsappMirror'] = 'true';
        existingUpdates.pendingFirstContact = false;
        existingUpdates.assignmentLocked = true;
      } else {
        if (!lead.inbox && (lead.source === ADVISOR_WHATSAPP_SOURCE || lead.metadata?.advisorWhatsappMirror)) {
          existingUpdates.inbox = 'advisor_direct';
        }
        if (lead.source === ADVISOR_WHATSAPP_SOURCE || lead.metadata?.advisorWhatsappMirror) {
          existingUpdates.pendingFirstContact = false;
          existingUpdates.assignmentLocked = true;
        }
      }
      // Si el lead ya existía con nombre de asesor/empresa y ahora llega un nombre válido de cliente
      const currentNameLower = (lead.name || '').toLowerCase();
      const hasPlaceholder = FORBIDDEN_PLACEHOLDER_NAMES.some((f) => currentNameLower.includes(f));
      if (hasPlaceholder && cleanCustomerName) {
        existingUpdates.name = cleanCustomerName;
      }
      if (Object.keys(existingUpdates).length > 0) {
        await leadsRepository.update(data.companyId, lead.id, existingUpdates);
      }
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

      const effectiveContent = data.content?.trim() || (!mediaUrl && !data.mediaType ? '[Reacción o mensaje no compatible]' : '');

      await messagesRepository.create({
        companyId: data.companyId,
        leadId: lead.id,
        direction: data.direction,
        senderType: data.direction === 'outbound' ? 'advisor' : 'lead',
        content: effectiveContent,
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

    const hasDifferentAdvisor = Boolean(lead.assignedTo && lead.assignedTo !== data.advisorId);

    const leadUpdate: Record<string, unknown> = {
      lastMessageAt: createdAt,
      lastMessageText: data.content?.trim() || (data.mediaType ? 'Archivo' : '[Reacción o mensaje no compatible]'),
      aiEnabled: false,
    };
    if (data.direction === 'inbound') {
      leadUpdate.lastInboundAt = createdAt;
    }
    if (data.direction === 'outbound') {
      leadUpdate.lastAdvisorMessageAt = createdAt;

      if (!isNewLead && hasDifferentAdvisor) {
        // ── FILTRO A: PROTECCIÓN DE EXCLUSIVIDAD Y PRIVACIDAD COMERCIAL ──────
        // El lead YA PERTENECE a otro asesor. NO se reasigna a quien le escribió.
        // Se mantiene el assignedTo original. Se alerta por push al asesor.
        logger.warn('[AdvisorWhatsapp] Intento de contacto a lead asignado a otro asesor', {
          companyId: data.companyId,
          leadId: lead.id,
          phone,
          currentOwner: lead.assignedTo,
          contactingAdvisor: data.advisorId,
        });

        // Notificar por push al asesor que intentó escribirle
        advisorDisplayName(data.companyId, lead.assignedTo!)
          .then((ownerName) =>
            sendAdvisorPush(data.companyId, data.advisorId, {
              title: '⚠️ Prospecto asignado a otro asesor',
              body: `El prospecto ${lead.name || phone} pertenece a ${ownerName}. Por exclusividad comercial, no ha sido transferido a tu cuenta. Para gestionarlo debes solicitar el traslado desde el CRM.`,
              url: `/dashboard/inbox?search=${encodeURIComponent(phone)}`,
              type: 'unauthorized_transfer_attempt',
              leadId: lead.id,
            })
          )
          .catch((err) => {
            logger.warn('[AdvisorWhatsapp] Error enviando push de exclusividad', { err });
          });
      } else {
        // Lead libre (sin asesor) o lead que ya era propio:
        if (!lead.assignedTo) {
          leadUpdate.assignedTo = data.advisorId;
          leadUpdate.advisorAssignedAt = createdAt;
        }
        leadUpdate.pendingFirstContact = false;
        leadUpdate.assignmentLocked = true;
      }
    }
    await leadsRepository.update(data.companyId, lead.id, leadUpdate);

    response.json({ ok: true, leadId: lead.id });
  }
);
