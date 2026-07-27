import { onRequest, type Request } from 'firebase-functions/v2/https';
import { Timestamp }  from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { db }         from '../lib/admin';
import { env }        from '../config/env';
import { logger }     from '../utils/logger';
import { toNormalizedPhone } from '../utils/phone';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { normalizeBusinessNumber } from '../modules/whatsapp/inbox';
import { assignLead }         from '../modules/leads/leadAssignment.service';
import { messagesRepository } from '../modules/messages/messages.repository';
import { callsRepository }    from '../modules/calls/calls.repository';
import { updateBroadcastDeliveryStatus } from '../modules/broadcasts/broadcastStatus.service';
// ycloud client disponible para envíos futuros desde este webhook
import { uploadMediaBuffer, mimeToExt } from '../utils/storageUpload';
import type { MessageMediaKind } from '../modules/messages/messages.types';
import type { LeadSource, LeadSourceMeta } from '../modules/leads/leads.types';
import * as https from 'https';

// ─── Tipos del payload de ycloud ─────────────────────────────────────────────

// Presente cuando el mensaje llega desde un anuncio "Click to WhatsApp" de Meta
// (Facebook/Instagram). Ver https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples
interface YcloudReferral {
  source_url?:  string;
  source_type?: string;
  source_id?:   string;   // id del anuncio/creativo
  headline?:    string;
  body?:        string;
  media_type?:  string;
  image_url?:   string;
  video_url?:   string;
  ctwa_clid?:   string;   // click id, usado para atribución de conversiones
}

// Tarjeta(s) de contacto compartida por WhatsApp (type: 'contacts')
interface YcloudContact {
  name?:   { formatted_name?: string };
  phones?: { phone?: string }[];
}

interface YcloudInboundMessage {
  id:   string;   // wamid
  from: string;   // phone sin +
  to:   string;
  type: string;   // text | image | video | audio | document | sticker | location | contacts
  text?:     { body: string };
  image?:    { id?: string; link?: string; mime_type: string; caption?: string };
  video?:    { id?: string; link?: string; mime_type: string; caption?: string };
  audio?:    { id?: string; link?: string; mime_type: string };
  document?: { id?: string; link?: string; mime_type: string; filename?: string; caption?: string };
  sticker?:  { id?: string; link?: string; mime_type: string };
  contacts?: YcloudContact[];
  sendTime:  string;
  customerProfile?: { name?: string };
  referral?: YcloudReferral;
  // Respuesta del usuario a una solicitud de permiso de llamada de voz (call_permission_request).
  interactive?: {
    type: string;
    call_permission_reply?: {
      response?:             'accept' | 'reject';
      is_permanent?:         boolean;
      expiration_timestamp?: number;
    };
  };
}

// Payload del echo: mensaje enviado desde la app nativa (coexistencia)
// ycloud usa el campo "whatsappMessage" para este evento
interface YcloudSmbMessageEcho {
  id:       string;   // ID interno ycloud
  wamid:    string;   // WhatsApp message ID (para idempotencia)
  from:     string;   // número de negocio con +
  to:       string;   // número del cliente con +
  type:     string;   // text | image | video | audio | document | sticker
  status?:  string;
  text?:     { body: string };
  image?:    { id?: string; link?: string; mime_type: string; caption?: string };
  video?:    { id?: string; link?: string; mime_type: string; caption?: string };
  audio?:    { id?: string; link?: string; mime_type: string };
  document?: { id?: string; link?: string; mime_type: string; filename?: string; caption?: string };
  sticker?:  { id?: string; link?: string; mime_type: string };
  contacts?: YcloudContact[];
  sendTime?: string;
  createTime?: string;
}

// Llamadas de voz WhatsApp (Calling API). Ver
// https://docs.ycloud.com/reference/whatsapp-calling-connect-webhook-examples
interface YcloudCallingConnect {
  id:        string;
  wacid?:    string;
  phoneId?:  string;
  from:      string;
  to:        string;
  direction: 'USER_INITIATED' | 'BUSINESS_INITIATED';
  sdpType:   string;
  sdp:       string;
}

interface YcloudCallingStatusUpdated {
  wabaId?:         string;
  wacid:           string;
  status:          string;  // RINGING | ACCEPTED | REJECTED
  recipientPhone?: string;  // teléfono del cliente, sin importar la dirección
}

interface YcloudCallingTerminate {
  id:         string;
  wacid:      string;
  phoneId?:   string;
  from?:      string;
  to?:        string;
  direction?: 'USER_INITIATED' | 'BUSINESS_INITIATED';
  startTime?: number;
  endTime?:   number;
  duration?:  number;
  status:     string;  // COMPLETED | FAILED
  errorCode?: string;
}

interface YcloudWebhookEvent {
  id:          string;
  type:        string;  // whatsapp.inbound_message.received | whatsapp.smb.message.echoes | etc.
  createTime:  string;
  whatsappInboundMessage?: YcloudInboundMessage;
  whatsappMessage?: YcloudSmbMessageEcho;  // usado en smb.message.echoes
  callingConnect?:       YcloudCallingConnect;
  callingStatusUpdated?: YcloudCallingStatusUpdated;
  callingTerminate?:     YcloudCallingTerminate;
}

// Tarjeta(s) de contacto de WhatsApp → texto legible para el hilo del chat.
function formatContactsMessage(contacts?: YcloudContact[]): string {
  if (!contacts || contacts.length === 0) return '📇 Contacto compartido';
  const names = contacts.map((c) => {
    const name  = c.name?.formatted_name?.trim();
    const phone = c.phones?.[0]?.phone?.trim();
    if (name && phone) return `${name} (${phone})`;
    return name || phone || 'Contacto';
  });
  return `📇 ${names.join(', ')}`;
}

function toMediaKind(type: string): MessageMediaKind {
  return ['image', 'video', 'audio', 'document', 'sticker'].includes(type)
    ? type as MessageMediaKind
    : 'file';
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/** Compara dos strings en tiempo constante (evita fugas por timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Autentica el webhook con el secreto compartido (YCLOUD_WEBHOOK_SECRET).
 * Acepta ?secret=... o header X-Webhook-Secret. Si no hay secreto configurado,
 * no se exige (compatibilidad) pero se registra una advertencia para que se active.
 */
function verifyYcloudRequest(req: Request): boolean {
  const secret = env.ycloudWebhookSecret();
  if (!secret) {
    logger.warn('[ycloud Webhook] Sin YCLOUD_WEBHOOK_SECRET — endpoint sin autenticar. Configúralo para protegerlo.');
    return true;
  }
  const fromQuery  = typeof req.query.secret === 'string' ? req.query.secret : '';
  const provided   = fromQuery || req.get('x-webhook-secret') || '';
  return safeEqual(provided, secret);
}

export const ycloudWebhook = onRequest(
  {
    region:         'us-central1',
    cors:           false,
    timeoutSeconds: 30,
    memory:         '512MiB',
    invoker:        'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.sendStatus(405); return; }

    // Autenticación: bloquea payloads no firmados si hay secreto configurado.
    if (!verifyYcloudRequest(req)) {
      logger.warn('[ycloud Webhook] Secreto inválido — rechazado');
      res.sendStatus(401);
      return;
    }

    const body = req.body as YcloudWebhookEvent & YcloudInboundMessage;

    // Procesar ANTES de responder: en gen2 el CPU se limita tras enviar la
    // respuesta, así que el trabajo async posterior puede no completarse. La
    // idempotencia por id de mensaje evita duplicados si ycloud reintenta.
    try {
      await handleYcloudEvent(body);
    } catch (err) {
      logger.error('[ycloud Webhook] Error no controlado', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.sendStatus(200);
  }
);

/** Enruta un evento de ycloud (echo, llamada, actualización o mensaje inbound). */
async function handleYcloudEvent(body: YcloudWebhookEvent & YcloudInboundMessage): Promise<void> {
    logger.info('[ycloud Webhook] Payload recibido', {
      topType:    body.type,
      hasWrapper: !!body.whatsappInboundMessage,
      hasEcho:    !!body.whatsappMessage,
      hasFrom:    !!body.from,
    });

    // ── Mensajes enviados desde la app nativa (coexistencia) ─────────────────
    if (body.type === 'whatsapp.smb.message.echoes' && body.whatsappMessage) {
      try {
        await processYcloudEchoMessage(body.whatsappMessage);
      } catch (err) {
        logger.error('[ycloud Echo] Error procesando echo', {
          msgId: body.whatsappMessage?.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ── Llamadas de voz WhatsApp (Calling API) ────────────────────────────────
    if (body.type === 'whatsapp.call.connect' && body.callingConnect) {
      try {
        await processYcloudCallConnect(body.id, body.callingConnect);
      } catch (err) {
        logger.error('[ycloud Calling] Error procesando connect', {
          eventId: body.id, error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (body.type === 'whatsapp.call.status.updated' && body.callingStatusUpdated) {
      try {
        await processYcloudCallStatus(body.id, body.callingStatusUpdated);
      } catch (err) {
        logger.error('[ycloud Calling] Error procesando status update', {
          eventId: body.id, error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (body.type === 'whatsapp.call.terminate' && body.callingTerminate) {
      try {
        await processYcloudCallTerminate(body.id, body.callingTerminate);
      } catch (err) {
        logger.error('[ycloud Calling] Error procesando terminate', {
          eventId: body.id, error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ── Mensajes inbound del cliente ─────────────────────────────────────────
    // A) Envuelto: { type: "whatsapp.inbound_message.received", whatsappInboundMessage: {...} }
    // B) Directo:  { type: "text", from: "+57...", text: {...}, ... }
    if (body.type === 'whatsapp.message.updated' && body.whatsappMessage) {
      try {
        await processYcloudMessageUpdate(body.whatsappMessage);
      } catch (err) {
        logger.error('[ycloud Update] Error procesando actualizacion', {
          msgId: body.whatsappMessage?.wamid ?? body.whatsappMessage?.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    let msg: YcloudInboundMessage | null = null;

    if (body.type === 'whatsapp.inbound_message.received' && body.whatsappInboundMessage) {
      msg = body.whatsappInboundMessage;
    } else if (body.from && body.to && (body.type === 'text' || body.type === 'image' || body.type === 'audio' || body.type === 'video' || body.type === 'document' || body.type === 'sticker')) {
      msg = body as unknown as YcloudInboundMessage;
    } else if (body.whatsappInboundMessage) {
      msg = body.whatsappInboundMessage;
    }

    if (!msg) {
      logger.info('[ycloud Webhook] Evento no procesable', { type: body.type });
      return;
    }

    try {
      await processYcloudMessage(msg);
    } catch (err) {
      logger.error('[ycloud Webhook] Error procesando mensaje', {
        msgId: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
}

// ─── Procesamiento ────────────────────────────────────────────────────────────

async function processYcloudMessage(msg: YcloudInboundMessage): Promise<void> {
  const companyId   = env.defaultCompanyId();
  // from puede venir con o sin +
  const rawFrom   = msg.from.startsWith('+') ? msg.from.slice(1) : msg.from;
  const phone     = `+${rawFrom}`;
  const normPhone = toNormalizedPhone(phone);
  // ID del mensaje — ycloud puede usar id, wamid, o el ID del evento
  const msgId = (msg as unknown as Record<string, string>).id
             || (msg as unknown as Record<string, string>).wamid
             || `ycloud_${Date.now()}`;
  const profileName = msg.customerProfile?.name;
  const inboxId     = normalizeBusinessNumber(msg.to); // número de negocio que recibió

  // Idempotencia
  const idempotencyRef = db
    .collection('companies').doc(companyId)
    .collection('webhookEvents').doc(msgId);

  try {
    await idempotencyRef.create({
      messageId:   msgId,
      from:        phone,
      processedAt: Timestamp.now(),
      channel:     'ycloud',
    });
  } catch {
    logger.warn('[ycloud] Mensaje duplicado ignorado', { msgId: msg.id });
    return;
  }

  // Respuesta a una solicitud de permiso de llamada de voz — no es un mensaje
  // de chat normal, actualiza el lead y termina acá.
  if (msg.type === 'interactive' && msg.interactive?.type === 'call_permission_reply') {
    await handleCallPermissionReply(companyId, normPhone, msg.interactive.call_permission_reply);
    return;
  }

  // Extraer contenido
  let content = '';
  let mediaUrl:         string | undefined;
  let mediaType:        string | undefined;
  let mediaStoragePath: string | undefined;

  if (msg.type === 'text' && msg.text) {
    content = msg.text.body;
  } else if (['image','video','audio','document','sticker'].includes(msg.type)) {
    const mediaData = (msg as unknown as Record<string, unknown>)[msg.type] as {
      id?: string; link?: string; mime_type: string; caption?: string; filename?: string
    } | undefined;

    if (mediaData) {
      mediaType = mediaData.mime_type;
      content   = mediaData.caption ?? '';

      // Las URLs firmadas de ycloud son temporales (se firman en cada webhook y
      // caducan). Para que el historial sea viable a futuro, descargamos TODA la
      // media entrante y la re-hospedamos en Firebase Storage (permanente).
      // Si no viene link, construir desde id.
      const mediaSource = getYcloudMediaSource(mediaData);

      if (mediaSource) {
        try {
          const buffer = await downloadUrl(mediaSource, env.ycloudApiKey());
          const ext    = mimeToExt(mediaType);
          const path   = `companies/${companyId}/media/${msgId}.${ext}`;
          const result = await uploadMediaBuffer(buffer, mediaType, path);
          mediaUrl         = result.downloadUrl;
          mediaStoragePath = result.storagePath;
          logger.info('[ycloud] Media guardada en Storage', { type: msg.type, msgId });
        } catch (err) {
          // Fallback: si falla la descarga, conservar la URL temporal de ycloud
          // para no perder el mensaje (aunque pueda caducar).
          mediaUrl = mediaSource;
          logger.error('[ycloud] Error descargando media, se usa URL temporal de ycloud', { error: String(err), msgId, type: msg.type });
        }
      } else {
        logger.warn('[ycloud] Media sin link ni id', { type: msg.type, msgId });
      }
    }
  } else if (msg.type === 'location') {
    content = '📍 Ubicación compartida';
  } else if (msg.type === 'contacts') {
    content = formatContactsMessage(msg.contacts);
  } else {
    content = `[${msg.type}]`;
  }

  const now = Timestamp.now();

  // Atribución del anuncio de origen (solo si el mensaje llega desde un
  // "Click to WhatsApp" de Meta; msg.referral trae el id del anuncio).
  const { source: refSource, sourceMeta: refMeta } = resolveLeadSource(msg.referral);
  if (msg.referral) {
    logger.info('[ycloud] Lead desde anuncio de Meta (referral)', {
      adId:     msg.referral.source_id,
      headline: msg.referral.headline,
      ctwaClid: msg.referral.ctwa_clid,
    });
  }

  // Buscar o crear lead
  let lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
  if (!lead) {
    lead = await leadsRepository.create(companyId, {
      companyId,
      phone,
      normalizedPhone: normPhone,
      name:            profileName ?? `Lead ${phone}`,
      status:          'new',
      source:          refSource,
      ...(refMeta ? { sourceMeta: refMeta } : {}),
      inboxProvider:   'ycloud',
      ...(inboxId ? { inboxId } : {}),
      aiEnabled:       true,
      tags:            [],
      metadata:        {},
      createdAt:       now,
      updatedAt:       now,
    });
    logger.info('[ycloud] Nuevo lead creado', { leadId: lead.id, phone, source: refSource });
    lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
  }

  // Guardar mensaje
  await messagesRepository.create({
    companyId,
    leadId:           lead.id,
    direction:        'inbound',
    senderType:       'lead',
    content:          content || '',
    channel:          'whatsapp',
    status:           'delivered',
    twilioMessageSid: msgId,
    aiProcessed:      false,
    ...(mediaUrl         && { mediaUrl }),
    ...(mediaType        && { mediaType }),
    ...(mediaType        && { mediaKind: toMediaKind(msg.type) }),
    ...(mediaStoragePath && { mediaStoragePath }),
    createdAt:        now,
  });

  // Actualizar lead
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: content || (mediaType ? '📎 Archivo adjunto' : ''),
    lastMessageAt:   now,
    lastInboundAt:   now,
    inboxProvider:   'ycloud',
    ...(inboxId ? { inboxId } : {}),
    ...(profileName && lead.name?.startsWith('Lead ') ? { name: profileName } : {}),
    // Re-atribución: si un lead existente reescribe desde un anuncio, registrar
    // el toque de anuncio más reciente (no perder la atribución).
    ...(refMeta ? { source: 'meta_ads', sourceMeta: refMeta } : {}),
  });

  logger.info('[ycloud] Mensaje procesado', { leadId: lead.id, msgId, type: msg.type });
}

// ─── Echo: mensajes enviados desde la app nativa de WhatsApp ─────────────────

async function processYcloudEchoMessage(echo: YcloudSmbMessageEcho): Promise<void> {
  const companyId = env.defaultCompanyId();

  // El destinatario (to) es el cliente — con él buscamos el lead
  // ycloud envía "to" con + ya incluido (e.g. "+573022911626")
  const rawTo = echo.to.startsWith('+') ? echo.to.slice(1) : echo.to;
  const phone     = `+${rawTo}`;
  const normPhone = toNormalizedPhone(phone);

  // Usar wamid para idempotencia (es el ID único de WhatsApp)
  const msgId = echo.wamid || echo.id || `echo_${Date.now()}`;

  // Idempotencia
  const idempotencyRef = db
    .collection('companies').doc(companyId)
    .collection('webhookEvents').doc(msgId);

  try {
    await idempotencyRef.create({
      messageId:   msgId,
      from:        echo.from,
      to:          phone,
      processedAt: Timestamp.now(),
      channel:     'ycloud_echo',
    });
  } catch {
    logger.warn('[ycloud Echo] Duplicado ignorado', { msgId });
    return;
  }

  // Extraer contenido
  let content  = '';
  let mediaUrl:         string | undefined;
  let mediaType:        string | undefined;
  let mediaStoragePath: string | undefined;

  if (echo.type === 'text' && echo.text) {
    content = echo.text.body;
  } else if (['image','video','audio','document','sticker'].includes(echo.type)) {
    const mediaData = (echo as unknown as Record<string, unknown>)[echo.type] as {
      id?: string; link?: string; mime_type: string; caption?: string; filename?: string
    } | undefined;

    if (mediaData) {
      mediaType = mediaData.mime_type;
      content   = mediaData.caption ?? '';

      const mediaSource = getYcloudMediaSource(mediaData);
      if (mediaSource) {
        try {
          const buffer = await downloadUrl(mediaSource, env.ycloudApiKey());
          const ext    = mimeToExt(mediaType);
          const path   = `companies/${companyId}/media/${msgId}.${ext}`;
          const result = await uploadMediaBuffer(buffer, mediaType, path);
          mediaUrl         = result.downloadUrl;
          mediaStoragePath = result.storagePath;
        } catch (err) {
          logger.error('[ycloud Echo] Error descargando media', { error: String(err) });
        }
      }
    }
  } else if (echo.type === 'contacts') {
    content = formatContactsMessage(echo.contacts);
  } else {
    content = `[${echo.type}]`;
  }

  const now = Timestamp.now();

  // Buscar o crear lead por el teléfono del cliente (to)
  let lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
  if (!lead) {
    lead = await leadsRepository.create(companyId, {
      companyId,
      phone,
      normalizedPhone: normPhone,
      name:            `Lead ${phone}`,
      status:          'new',
      source:          'whatsapp',
      aiEnabled:       true,
      tags:            [],
      metadata:        {},
      createdAt:       now,
      updatedAt:       now,
    });
    logger.info('[ycloud Echo] Nuevo lead creado desde echo', { leadId: lead.id, phone });
    lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
  }

  // Guardar como mensaje outbound del asesor
  // aiProcessed: true para que el trigger no intente responder
  await messagesRepository.create({
    companyId,
    leadId:           lead.id,
    direction:        'outbound',
    senderType:       'advisor',
    content:          content || '',
    channel:          'whatsapp',
    status:           'sent',
    twilioMessageSid: msgId,
    aiProcessed:      true,
    ...(mediaUrl         && { mediaUrl }),
    ...(mediaType        && { mediaType }),
    ...(mediaType        && { mediaKind: toMediaKind(echo.type) }),
    ...(mediaStoragePath && { mediaStoragePath }),
    createdAt:        now,
  });

  // Actualizar lastMessage del lead
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: content || (mediaType ? '📎 Archivo adjunto' : ''),
    lastMessageAt:   now,
  });

  logger.info('[ycloud Echo] Mensaje de app guardado', {
    leadId: lead.id, msgId, type: echo.type,
  });
}

// ─── Descarga con autenticación ───────────────────────────────────────────────

async function processYcloudMessageUpdate(update: YcloudSmbMessageEcho): Promise<void> {
  const companyId = env.defaultCompanyId();
  const rawTo     = update.to.startsWith('+') ? update.to.slice(1) : update.to;
  const phone     = `+${rawTo}`;
  const normPhone = toNormalizedPhone(phone);
  const msgId     = update.wamid || update.id;

  if (msgId && update.status) {
    await updateBroadcastDeliveryStatus(companyId, msgId, update.status);
  }

  if (!['image','video','audio','document','sticker'].includes(update.type)) return;

  const mediaData = (update as unknown as Record<string, unknown>)[update.type] as {
    id?: string; link?: string; mime_type: string; caption?: string; filename?: string
  } | undefined;

  if (!mediaData || !msgId) return;

  const lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
  if (!lead) {
    logger.warn('[ycloud Update] Lead no encontrado para actualizar media', { msgId, phone });
    return;
  }

  const mediaType   = mediaData.mime_type;
  const mediaSource = getYcloudMediaSource(mediaData);
  if (!mediaSource) {
    logger.warn('[ycloud Update] Media sin link ni id', { msgId, type: update.type });
    return;
  }

  let mediaUrl: string;
  let mediaStoragePath: string | undefined;

  try {
    const buffer = await downloadUrl(mediaSource, env.ycloudApiKey());
    const ext    = mimeToExt(mediaType);
    const path   = `companies/${companyId}/media/${msgId}.${ext}`;
    const result = await uploadMediaBuffer(buffer, mediaType, path);
    mediaUrl         = result.downloadUrl;
    mediaStoragePath = result.storagePath;
  } catch (err) {
    logger.error('[ycloud Update] Error descargando media', { error: String(err), msgId });
    return;
  }

  const updated = await messagesRepository.updateByTwilioSid(companyId, lead.id, msgId, {
    content: mediaData.caption ?? '',
    mediaUrl,
    mediaType,
    mediaKind: toMediaKind(update.type),
    ...(mediaStoragePath && { mediaStoragePath }),
  });

  if (!updated) {
    logger.warn('[ycloud Update] Mensaje original no encontrado para actualizar', { msgId, leadId: lead.id });
    return;
  }

  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: mediaData.caption ?? '📎 Archivo adjunto',
    lastMessageAt:   Timestamp.now(),
  });

  logger.info('[ycloud Update] Media actualizada en mensaje existente', {
    leadId: lead.id,
    msgId,
    type: update.type,
  });
}

// ─── Llamadas de voz WhatsApp (Calling API) ───────────────────────────────────

async function handleCallPermissionReply(
  companyId: string,
  normPhone: string,
  reply?: { response?: 'accept' | 'reject'; is_permanent?: boolean; expiration_timestamp?: number }
): Promise<void> {
  if (!reply) return;
  const lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
  if (!lead) {
    logger.warn('[ycloud Calling] Lead no encontrado para respuesta de permiso', { normPhone });
    return;
  }

  const granted = reply.response === 'accept';
  const now = Timestamp.now();
  await leadsRepository.update(companyId, lead.id, {
    callPermission: {
      granted,
      ...(reply.is_permanent !== undefined && { isPermanent: reply.is_permanent }),
      ...(granted ? { grantedAt: now } : {}),
      expiresAt: reply.expiration_timestamp ? Timestamp.fromMillis(reply.expiration_timestamp * 1000) : null,
      ...(lead.callPermission?.lastRequestedAt && { lastRequestedAt: lead.callPermission.lastRequestedAt }),
    },
  });
  logger.info('[ycloud Calling] Permiso de llamada actualizado', { leadId: lead.id, granted });
}

async function callingIdempotencyGuard(companyId: string, eventId: string): Promise<boolean> {
  const ref = db.collection('companies').doc(companyId).collection('webhookEvents').doc(eventId);
  try {
    await ref.create({ eventId, processedAt: Timestamp.now(), channel: 'ycloud_calling' });
    return true;
  } catch {
    logger.warn('[ycloud Calling] Evento duplicado ignorado', { eventId });
    return false;
  }
}

async function processYcloudCallConnect(eventId: string, payload: YcloudCallingConnect): Promise<void> {
  const companyId = env.defaultCompanyId();
  if (!(await callingIdempotencyGuard(companyId, eventId))) return;

  const wacid = payload.wacid ?? payload.id;
  const phoneId = payload.phoneId ?? env.ycloudCallingPhoneId();

  if (payload.direction === 'USER_INITIATED') {
    // Llamada entrante: el cliente (from) llama al negocio (to).
    const customerPhone = payload.from.startsWith('+') ? payload.from : `+${payload.from}`;
    const normPhone = toNormalizedPhone(customerPhone);
    const inboxId = normalizeBusinessNumber(payload.to);

    let lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
    const now = Timestamp.now();
    if (!lead) {
      lead = await leadsRepository.create(companyId, {
        companyId,
        phone: customerPhone,
        normalizedPhone: normPhone,
        name: `Lead ${customerPhone}`,
        status: 'new',
        source: 'whatsapp',
        inboxProvider: 'ycloud',
        ...(inboxId ? { inboxId } : {}),
        aiEnabled: true,
        tags: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
      logger.info('[ycloud Calling] Nuevo lead creado por llamada entrante', { leadId: lead.id, phone: customerPhone });
    }

    await callsRepository.create({
      companyId,
      leadId: lead.id,
      direction: 'inbound',
      provider: 'ycloud_whatsapp',
      status: 'ringing',
      externalId: wacid,
      phoneId,
      sdpOffer: payload.sdp,
      ...(lead.assignedTo ? { assignedTo: lead.assignedTo } : {}),
      leadName: lead.name ?? customerPhone,
      leadPhone: customerPhone,
      createdAt: now,
    });
    logger.info('[ycloud Calling] Llamada entrante registrada', { leadId: lead.id, wacid });
    return;
  }

  // BUSINESS_INITIATED: es la respuesta (SDP answer) a una llamada saliente que
  // nosotros iniciamos con connectCall(). El cliente es "to".
  const customerPhone = payload.to.startsWith('+') ? payload.to : `+${payload.to}`;
  const lead = await leadsRepository.findByNormalizedPhone(companyId, toNormalizedPhone(customerPhone));
  if (!lead) {
    logger.warn('[ycloud Calling] Lead no encontrado para respuesta de llamada saliente', { wacid, customerPhone });
    return;
  }
  const call = await callsRepository.findByExternalId(companyId, lead.id, wacid);
  if (!call) {
    logger.warn('[ycloud Calling] Llamada saliente no encontrada para wacid', { wacid, leadId: lead.id });
    return;
  }
  await callsRepository.update(companyId, lead.id, call.id, { sdpAnswer: payload.sdp, status: 'connecting' });
  logger.info('[ycloud Calling] SDP answer de llamada saliente recibido', { leadId: lead.id, callId: call.id, wacid });
}

async function findLeadCallByExternalId(
  companyId: string,
  customerPhone: string,
  wacid: string
): Promise<{ leadId: string; callId: string } | null> {
  const phone = customerPhone.startsWith('+') ? customerPhone : `+${customerPhone}`;
  const lead = await leadsRepository.findByNormalizedPhone(companyId, toNormalizedPhone(phone));
  if (!lead) return null;
  const call = await callsRepository.findByExternalId(companyId, lead.id, wacid);
  if (!call) return null;
  return { leadId: lead.id, callId: call.id };
}

async function processYcloudCallStatus(eventId: string, payload: YcloudCallingStatusUpdated): Promise<void> {
  const companyId = env.defaultCompanyId();
  if (!(await callingIdempotencyGuard(companyId, eventId))) return;
  if (!payload.recipientPhone) return;

  const found = await findLeadCallByExternalId(companyId, payload.recipientPhone, payload.wacid);
  if (!found) {
    logger.warn('[ycloud Calling] Llamada no encontrada para status update', { wacid: payload.wacid });
    return;
  }

  const statusMap: Record<string, 'ringing' | 'in-progress' | 'rejected'> = {
    RINGING: 'ringing',
    ACCEPTED: 'in-progress',
    REJECTED: 'rejected',
  };
  const status = statusMap[payload.status];
  if (!status) return;

  await callsRepository.update(companyId, found.leadId, found.callId, { status });
}

async function processYcloudCallTerminate(eventId: string, payload: YcloudCallingTerminate): Promise<void> {
  const companyId = env.defaultCompanyId();
  if (!(await callingIdempotencyGuard(companyId, eventId))) return;

  const isInbound = payload.direction === 'USER_INITIATED';
  const customerPhone = isInbound ? payload.from : payload.to;
  if (!customerPhone) {
    logger.warn('[ycloud Calling] Terminate sin teléfono de cliente', { wacid: payload.wacid });
    return;
  }

  const found = await findLeadCallByExternalId(companyId, customerPhone, payload.wacid);
  if (!found) {
    logger.warn('[ycloud Calling] Llamada no encontrada para terminate', { wacid: payload.wacid });
    return;
  }

  const status = payload.status === 'COMPLETED' ? 'completed' : 'failed';
  await callsRepository.update(companyId, found.leadId, found.callId, {
    status,
    ...(payload.duration !== undefined && { durationSec: payload.duration }),
    raw: payload as unknown as Record<string, unknown>,
  });

  await leadsRepository.update(companyId, found.leadId, {
    lastMessageText: status === 'completed' ? '📞 Llamada de WhatsApp' : '📞 Llamada fallida',
    lastMessageAt: Timestamp.now(),
  });
}

// Deriva el origen del lead a partir del `referral` de ycloud (presente solo
// cuando el mensaje llega desde un anuncio "Click to WhatsApp" de Meta).
function resolveLeadSource(referral?: YcloudReferral): { source: LeadSource; sourceMeta?: LeadSourceMeta } {
  if (!referral) return { source: 'whatsapp' };
  return {
    source: 'meta_ads',
    sourceMeta: {
      ...(referral.source_id  && { adId: referral.source_id }),
      ...(referral.headline   && { headline: referral.headline }),
      ...(referral.source_url && { sourceUrl: referral.source_url }),
      ...(referral.media_type && { mediaType: referral.media_type }),
      ...(referral.ctwa_clid  && { ctwaClid: referral.ctwa_clid }),
    },
  };
}

function getYcloudMediaSource(mediaData: { id?: string; link?: string }): string | undefined {
  return mediaData.link
    ?? (mediaData.id ? `https://api.ycloud.com/v2/whatsapp/media/${mediaData.id}/content` : undefined);
}

function downloadUrl(url: string, apiKey: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'X-API-Key': apiKey },
    };
    https.request(opts, (res) => {
      // Seguir redirects (301/302/307/308)
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
          && res.headers.location && redirects > 0) {
        res.resume(); // descartar cuerpo del redirect
        resolve(downloadUrl(res.headers.location, apiKey, redirects - 1));
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`ycloud media HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).end();
  });
}
