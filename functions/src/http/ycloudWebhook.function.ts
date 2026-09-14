import { onRequest, type Request } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp }  from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { db }         from '../lib/admin';
import { env }        from '../config/env';
import { logger }     from '../utils/logger';
import { toNormalizedPhone, phoneTail } from '../utils/phone';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { normalizeBusinessNumber } from '../modules/whatsapp/inbox';
import { assignLead }         from '../modules/leads/leadAssignment.service';
import { parseWebRefTag, webAttributionToMetadata } from '../modules/leads/webAttribution';
import { messagesRepository } from '../modules/messages/messages.repository';
import { callsRepository }    from '../modules/calls/calls.repository';
import { updateBroadcastDeliveryStatus } from '../modules/broadcasts/broadcastStatus.service';
import { resolveCompanyIdForChannel, getAdvisorLine } from '../modules/companies/companyRouting';
import { ADVISOR_WHATSAPP_SOURCE } from '../modules/leads/leadClassification';
import { getYcloudConfigForCompany } from '../modules/companies/channelCredentials.repository';
// ycloud client disponible para envíos futuros desde este webhook
import { uploadMediaBuffer, mimeToExt } from '../utils/storageUpload';
import { webhookEventExpireAt } from '../utils/webhookTtl';
import type { MessageMediaKind, MessageStatus } from '../modules/messages/messages.types';
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
  // `from` está AUSENTE cuando el cliente escribe ocultando su número (privacidad
  // de nombre de usuario de WhatsApp). En ese caso la identidad viene en
  // `fromUserId` (BSUID). Ver https://www.ycloud.com/blog/whatsapp-usernames-and-business-scoped-user-ids
  from?: string;   // phone sin + (ausente si el cliente oculta su número)
  fromUserId?: string;  // BSUID: identidad del usuario sin número. Ej: "CO.2370523146805161"
  to:   string;
  type: string;   // text | image | video | audio | document | sticker | location | contacts
  text?:     { body: string };
  image?:    { id?: string; link?: string; mime_type: string; caption?: string };
  video?:    { id?: string; link?: string; mime_type: string; caption?: string };
  audio?:    { id?: string; link?: string; mime_type: string };
  document?: { id?: string; link?: string; mime_type: string; filename?: string; caption?: string };
  sticker?:  { id?: string; link?: string; mime_type: string };
  contacts?: YcloudContact[];
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  // Reacción con emoji a un mensaje previo. emoji vacío = el cliente quitó su reacción.
  reaction?: { message_id?: string; emoji?: string };
  sendTime:  string;
  customerProfile?: { name?: string; username?: string };
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
  // Motivo del fallo cuando status === 'failed' (p.ej. límite de marketing 131049).
  // YCloud lo expone como errorCode/errorMessage y/o un objeto error anidado.
  errorCode?:    string;
  errorMessage?: string;
  error?:   { code?: string | number; message?: string };
  text?:     { body: string };
  image?:    { id?: string; link?: string; mime_type: string; caption?: string };
  video?:    { id?: string; link?: string; mime_type: string; caption?: string };
  audio?:    { id?: string; link?: string; mime_type: string };
  document?: { id?: string; link?: string; mime_type: string; filename?: string; caption?: string };
  sticker?:  { id?: string; link?: string; mime_type: string };
  contacts?: YcloudContact[];
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
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

/**
 * Ubicación compartida → texto con enlace a Google Maps para que el asesor pueda
 * abrirla. Incluye nombre/dirección si WhatsApp los envía.
 */
function formatLocationMessage(
  loc?: { latitude?: number; longitude?: number; name?: string; address?: string }
): string {
  if (!loc || loc.latitude == null || loc.longitude == null) return '📍 Ubicación compartida';
  const label = [loc.name, loc.address].filter(Boolean).join(' — ');
  const maps  = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
  return `📍 Ubicación${label ? ': ' + label : ''}\n${maps}`;
}

/**
 * Reacción con emoji a un mensaje del chat → texto legible para el hilo.
 * WhatsApp envía emoji vacío cuando el cliente QUITA una reacción que había puesto.
 */
function formatReactionMessage(reaction?: { emoji?: string }): string {
  const emoji = reaction?.emoji?.trim();
  return emoji ? `Reaccionó con ${emoji}` : 'Quitó su reacción';
}

/** Etiqueta amigable por tipo de media (para previews y fallbacks sin URL). */
function mediaKindLabel(type: string): string {
  switch (type) {
    case 'image':    return '📷 Imagen';
    case 'video':    return '🎥 Video';
    case 'audio':    return '🎵 Audio';
    case 'document': return '📄 Documento';
    case 'sticker':  return '🖼️ Sticker';
    default:         return '📎 Archivo';
  }
}

/**
 * Texto legible para tipos de mensaje que no son de chat normal (o que WhatsApp
 * marca como no soportados). Evita placeholders crudos tipo "[unsupported]".
 */
function nonChatTypeLabel(type: string): string {
  if (type === 'location') return '📍 Ubicación compartida';
  if (type === 'unsupported') {
    return '⚠️ El cliente envió un mensaje no compatible. Pídele que lo reenvíe como texto o archivo.';
  }
  return 'Mensaje no compatible por este canal.';
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
    // 60s / 1GiB: re-alojar media pesada (videos/documentos) del inbound y de los
    // ecos requiere descargar a memoria y re-subir; con 30s/512MiB fallaba y dejaba
    // el mensaje sin URL (burbuja vacía).
    timeoutSeconds: 60,
    memory:         '1GiB',
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
  const companyId   = await resolveCompanyIdForChannel('ycloud', msg.to);
  // Identidad del cliente. Normalmente el número llega en `from`. Pero si el cliente
  // escribe ocultando su teléfono (privacidad de nombre de usuario de WhatsApp),
  // `from` viene vacío y la identidad es el BSUID en `fromUserId`. Sin esta rama, el
  // acceso a msg.from.startsWith lanzaba y el lead (pagado, de un anuncio) se perdía.
  const userId    = (msg.fromUserId ?? '').trim();      // BSUID (vacío si comparte número)
  const hasPhone  = typeof msg.from === 'string' && msg.from.trim().length > 0;
  let   phone     = '';
  let   normPhone = '';
  if (hasPhone) {
    // from puede venir con o sin +
    const rawFrom = msg.from!.startsWith('+') ? msg.from!.slice(1) : msg.from!;
    phone     = `+${rawFrom}`;
    normPhone = toNormalizedPhone(phone);
  }
  // ID del mensaje — ycloud puede usar id, wamid, o el ID del evento
  const msgId = (msg as unknown as Record<string, string>).id
             || (msg as unknown as Record<string, string>).wamid
             || `ycloud_${Date.now()}`;
  const profileName = msg.customerProfile?.name;
  const username    = msg.customerProfile?.username?.trim();
  const inboxId     = normalizeBusinessNumber(msg.to); // número de negocio que recibió

  // ¿El mensaje entró DIRECTO a la línea personal de un asesor (coexistencia),
  // en vez de al 317? Si es así, los leads NUEVOS de esta línea se marcan como
  // `advisor_whatsapp`, se asignan solo a ese asesor y quedan fuera de stats y
  // reparto. Los leads que YA existían (entraron antes por el 317) conservan su
  // fuente/etiquetas: solo se les agrega el mensaje. Ver [[leadClassification]].
  const advisorLine = await getAdvisorLine('ycloud', msg.to);

  // Sin ninguna identidad utilizable no hay forma de crear el lead.
  if (!hasPhone && !userId) {
    logger.warn('[ycloud] Mensaje sin teléfono ni BSUID — no se puede identificar el lead', { msgId });
    return;
  }

  // Idempotencia
  const idempotencyRef = db
    .collection('companies').doc(companyId)
    .collection('webhookEvents').doc(msgId);

  try {
    await idempotencyRef.create({
      messageId:   msgId,
      from:        hasPhone ? phone : userId,
      processedAt: Timestamp.now(),
      expireAt:    webhookEventExpireAt(),
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
  let mediaSourceUrl:   string | undefined;
  let mediaPending      = false;
  // Una reacción (emoji) es una señal de baja intención: se muestra en el hilo pero
  // la IA NO debe responderla (respondería a un "🙏🏼" como si fuera un mensaje).
  let isReaction        = false;

  if (msg.type === 'text' && msg.text) {
    content = msg.text.body;
  } else if (['image','video','audio','document','sticker'].includes(msg.type)) {
    const mediaData = (msg as unknown as Record<string, unknown>)[msg.type] as {
      id?: string; link?: string; mime_type: string; caption?: string; filename?: string
    } | undefined;

    if (mediaData) {
      mediaType = mediaData.mime_type;
      content   = mediaData.caption ?? '';

      // Las URLs firmadas de ycloud son temporales (caducan). Re-hospedamos TODA
      // la media en Firebase Storage (permanente). La IA necesita la URL de las
      // imágenes/audio ya (visión/whisper), así que esas se re-alojan aquí inline;
      // si falla, se difiere y lo reintenta el trigger/barrido (nunca guardamos la
      // URL temporal de ycloud como definitiva).
      const mediaSource = getYcloudMediaSource(mediaData);

      if (mediaSource) {
        try {
          const { apiKey } = await getYcloudConfigForCompany(companyId);
          const buffer = await downloadUrl(mediaSource, apiKey);
          const ext    = mimeToExt(mediaType);
          const path   = `companies/${companyId}/media/${msgId}.${ext}`;
          const result = await uploadMediaBuffer(buffer, mediaType, path);
          mediaUrl         = result.downloadUrl;
          mediaStoragePath = result.storagePath;
          logger.info('[ycloud] Media guardada en Storage', { type: msg.type, msgId });
        } catch (err) {
          // Diferir: guardar como pendiente para que el trigger/barrido lo re-aloje
          // en Storage. Así no dependemos de la URL temporal de ycloud (que caduca).
          mediaSourceUrl = mediaSource;
          mediaPending   = true;
          // warn (no error): está manejado — el trigger/barrido lo re-aloja. No debe alertar.
          logger.warn('[ycloud] Descarga de media falló, se difiere el re-alojo', { error: String(err), msgId, type: msg.type });
        }
      } else {
        logger.warn('[ycloud] Media sin link ni id', { type: msg.type, msgId });
      }
    }
    // Si no se pudo obtener URL ni está pendiente de re-alojo, y no hay caption,
    // mostrar una etiqueta clara en vez de una burbuja vacía.
    if (!mediaUrl && !mediaPending && !content.trim()) content = `${mediaKindLabel(msg.type)} (no se pudo cargar)`;
  } else if (msg.type === 'location') {
    content = formatLocationMessage(msg.location);
  } else if (msg.type === 'contacts') {
    content = formatContactsMessage(msg.contacts);
  } else if (msg.type === 'reaction') {
    content    = formatReactionMessage(msg.reaction);
    isReaction = true;
  } else {
    content = nonChatTypeLabel(msg.type);
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

  // Atribución "botón de WhatsApp de la página web": un wa.me normal NO trae
  // señal de origen; la única pista es el texto precargado del botón. Si el
  // PRIMER mensaje (lead nuevo, sin referral de Meta) coincide con esa frase,
  // el lead se atribuye a la página web en vez de "WhatsApp directo".
  const webButton = !msg.referral ? detectWebWhatsAppButton(msg.text?.body) : null;
  const leadSource: LeadSource = webButton ? 'web' : refSource;
  // El botón de WhatsApp de la web añade un tag `[meraki-ref:…]` con la atribución
  // (UTM/fbclid) cuando el visitante llegó de una pauta. Lo parseamos para NO perder
  // el origen y lo quitamos del texto para no ensuciar el chat.
  const webRef = webButton ? parseWebRefTag(msg.text?.body ?? '') : { attribution: {}, cleanText: '' };
  if (webButton && Object.keys(webRef.attribution).length) content = webRef.cleanText;
  const leadMeta: Record<string, string> = webButton
    ? {
        webOrigin: 'whatsapp_button',
        ...(webButton.area ? { webArea: webButton.area } : {}),
        ...webAttributionToMetadata(webRef.attribution),
      }
    : {};

  // El mensaje "completé el formulario … Phone number: +X" que manda Meta al dar
  // "enviar por WhatsApp" TRAE el número en el texto, aunque WhatsApp oculte el
  // remitente (usuario oculto). Lo leemos para poder unir con el lead del formulario.
  const textPhone = extractPhoneFromText(msg.text?.body);
  const textNorm  = textPhone ? toNormalizedPhone(textPhone) : '';

  // Número/tail para buscar: el del remitente si viene, si no el del texto.
  const tail = phoneTail(normPhone) || (textNorm ? phoneTail(textNorm) : '');

  // 1) Búsqueda directa: por teléfono del remitente, o por BSUID.
  let lead = hasPhone
    ? await leadsRepository.findByNormalizedPhone(companyId, normPhone)
    : await leadsRepository.findByExternalId(companyId, 'whatsapp', userId);
  // 2) Si es usuario oculto pero el texto trae el número, buscar por ese número.
  if (!lead && !hasPhone && textNorm) {
    lead = await leadsRepository.findByNormalizedPhone(companyId, textNorm);
  }
  // 3) Fallback por número nacional (últimos 9 dígitos), desde remitente o texto.
  if (!lead && tail) {
    lead = await leadsRepository.findByPhoneTail(companyId, tail);
  }

  // Si hubo match, unificar identidad (evita duplicado, mismo asesor).
  if (lead) {
    // Si el mensaje trae número real de WhatsApp y difiere, actualizar al real (el
    // que sí recibe respuestas). Si el que escribe es usuario oculto, NO se pisa el
    // número; solo se guarda su identidad de WhatsApp para poder responderle.
    if (hasPhone && lead.normalizedPhone !== normPhone) {
      await leadsRepository.updatePhoneIdentity(companyId, lead.id, phone, normPhone, phoneTail(normPhone));
      lead = { ...lead, phone, normalizedPhone: normPhone, phoneTail: phoneTail(normPhone) };
    }
    const patch: Record<string, unknown> = {};
    if (userId && !lead.whatsappUserId) {
      patch.whatsappUserId = userId;
      patch.channelExternalId = `whatsapp:${userId}`;
    }
    if (!lead.phoneTail && tail) patch.phoneTail = tail;
    if (Object.keys(patch).length) await leadsRepository.update(companyId, lead.id, patch);
    logger.info('[ycloud] Mensaje unido a lead existente (anti-duplicado)', {
      leadId: lead.id, via: hasPhone ? 'from' : (textNorm ? 'texto' : 'bsuid'), tail,
    });
  }

  // Caso raro: usuario oculto y SIN número ni en remitente ni en texto. Si existe
  // otro lead con número del mismo nombre, se marca "posible-duplicado".
  let dupTags: string[] = [];
  let dupMeta: Record<string, string> = {};
  if (!lead && !hasPhone && !textPhone && (profileName || username)) {
    const twin = await leadsRepository.findNameTwinWithPhone(companyId, profileName ?? username ?? '');
    if (twin) {
      dupTags = ['posible-duplicado'];
      dupMeta = { possibleDuplicateOf: twin.id, possibleDuplicateName: twin.name ?? '' };
      logger.info('[ycloud] Posible duplicado por nombre (WhatsApp sin número)', {
        newName: profileName ?? username, twinId: twin.id, twinName: twin.name,
      });
    }
  }

  if (!lead) {
    // Si es usuario oculto pero el texto trae el número, se guarda ESE número para
    // que el lead del formulario (que llega segundos después) lo pueda unir.
    const storePhone = hasPhone ? phone     : (textPhone || '');
    const storeNorm  = hasPhone ? normPhone : (textNorm  || '');
    // Clave de reclamo atómico anti-duplicado: teléfono normalizado si lo hay, si
    // no el BSUID. Cierra la carrera de dos mensajes simultáneos de un cliente nuevo
    // (p. ej. un mensaje "no soportado" + el texto real llegando en el mismo segundo),
    // que antes creaban DOS leads porque el "buscar-o-crear" no era atómico.
    const claimKey = storeNorm ? `phone_${storeNorm}` : (userId ? `wa_${userId}` : '');
    const { lead: claimedLead, created } = await leadsRepository.createWithIdentityClaim(
      companyId,
      claimKey,
      {
        companyId,
        phone:           storePhone,
        normalizedPhone: storeNorm,
        ...(tail ? { phoneTail: tail } : {}),
        // Identidad sin número: BSUID de WhatsApp. Permite buscar y RESPONDER al lead.
        ...(userId ? { whatsappUserId: userId, channelExternalId: `whatsapp:${userId}` } : {}),
        ...(username ? { username } : {}),
        name:            profileName ?? username ?? (storePhone ? `Lead ${storePhone}` : `Lead ${userId}`),
        status:          'new',
        // Línea de asesor → fuente propia (fuera de stats/reparto). Si no, la
        // atribución normal (pauta / web / whatsapp directo al 317).
        source:          advisorLine ? ADVISOR_WHATSAPP_SOURCE : leadSource,
        ...(!advisorLine && refMeta ? { sourceMeta: refMeta } : {}),
        inboxProvider:   'ycloud',
        ...(inboxId ? { inboxId } : {}),
        // Línea de asesor → se asigna SOLO a ese asesor (sin reparto) y la IA no
        // responde (él chatea desde su celular).
        ...(advisorLine ? { assignedTo: advisorLine.advisorId } : {}),
        aiEnabled:       advisorLine ? false : true,
        tags:            dupTags,
        metadata: {
          ...leadMeta,
          ...dupMeta,
          // Marca redundante con la fuente para que las exclusiones también
          // reconozcan a estos leads (ver isDirectAdvisorLead).
          ...(advisorLine ? { advisorWhatsappMirror: 'true' } : {}),
        },
        createdAt:       now,
        updatedAt:       now,
      },
    );
    lead = claimedLead;
    if (created) {
      logger.info('[ycloud] Nuevo lead creado', {
        leadId: lead.id, phone: phone || userId,
        source: advisorLine ? ADVISOR_WHATSAPP_SOURCE : leadSource,
        advisorLine: advisorLine?.advisorId,
      });
      if (advisorLine) {
        // Línea de asesor: ya quedó asignado a su dueño arriba. NO entra al reparto.
        lead.assignedTo = advisorLine.advisorId;
      } else {
        lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
        // Todos los leads que entran por WhatsApp (pauta click-to-WhatsApp, orgánico o
        // botón web) entran a la reasignación automática por falta de primer contacto:
        // assignLead ya los deja con pendingFirstContact=true. Solo los de FORMULARIO
        // (leadgen) quedan excluidos, y eso se maneja aparte en metaLeads.service.ts.
      }
    } else {
      // Otro mensaje casi simultáneo del mismo cliente ya creó el lead: se REUSA
      // (no se reasigna ni se duplica). El mensaje actual se guarda en ese lead.
      logger.info('[ycloud] Lead reusado por mensaje simultáneo (anti-duplicado)', {
        leadId: lead.id, claimKey,
      });
    }
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
    // Reacción → aiProcessed:true para que el trigger de IA no la responda.
    aiProcessed:      isReaction,
    ...(mediaUrl         && { mediaUrl }),
    ...(mediaType        && { mediaType }),
    ...(mediaType        && { mediaKind: toMediaKind(msg.type) }),
    ...(mediaStoragePath && { mediaStoragePath }),
    ...(mediaPending     && { mediaPending: true }),
    ...(mediaSourceUrl   && { mediaSourceUrl }),
    createdAt:        now,
    metadata: {
      deliveryChannel: 'company_whatsapp',
      origin: 'company_whatsapp',
      ...(inboxId ? { businessPhone: inboxId } : {}),
    },
  });

  // Actualizar lead
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: content || (mediaType ? '📎 Archivo adjunto' : ''),
    lastMessageAt:   now,
    lastInboundAt:   now,
    inboxProvider:   'ycloud',
    // Solo fijar `inboxId` si el lead aún no tiene línea. NUNCA se reescribe: un
    // lead del 317 se queda en el 317 aunque llegue un mensaje por otra línea. Así
    // la 317 sigue siendo la principal y no se "mueven" leads entre líneas solos.
    ...(inboxId && !lead.inboxId ? { inboxId } : {}),
    ...(profileName && lead.name?.startsWith('Lead ') ? { name: profileName } : {}),
    // Rellenar identidad/username en leads que aún no los tuvieran (p. ej. creados antes de esta rama).
    ...(userId && !lead.whatsappUserId ? { whatsappUserId: userId, channelExternalId: `whatsapp:${userId}` } : {}),
    ...(username && !lead.username ? { username } : {}),
    // Re-atribución: si un lead existente reescribe desde un anuncio, registrar
    // el toque de anuncio más reciente (no perder la atribución).
    ...(refMeta ? { source: 'meta_ads', sourceMeta: refMeta } : {}),
  });

  logger.info('[ycloud] Mensaje procesado', { leadId: lead.id, msgId, type: msg.type });
}

// ─── Echo: mensajes enviados desde la app nativa de WhatsApp ─────────────────

async function processYcloudEchoMessage(echo: YcloudSmbMessageEcho): Promise<void> {
  const companyId = await resolveCompanyIdForChannel('ycloud', echo.from);

  // Algunos ecos (solo-estado / sin destinatario) llegan SIN `to`. Sin el número
  // del cliente no hay a quién asociar el mensaje: se ignora en vez de reventar
  // con "Cannot read properties of undefined (reading 'startsWith')".
  if (!echo.to || typeof echo.to !== 'string') {
    logger.info('[ycloud Echo] Eco sin destinatario (to) — ignorado', {
      msgId: echo.wamid || echo.id, from: echo.from,
    });
    return;
  }

  // El destinatario (to) es el cliente — con él buscamos el lead
  // ycloud envía "to" con + ya incluido (e.g. "+573022911626")
  const rawTo = echo.to.startsWith('+') ? echo.to.slice(1) : echo.to;
  const phone     = `+${rawTo}`;
  const normPhone = toNormalizedPhone(phone);

  // Usar wamid para idempotencia (es el ID único de WhatsApp)
  const msgId = echo.wamid || echo.id || `echo_${Date.now()}`;

  // El eco viene de la app nativa: `from` es la línea de negocio que envió. Si es
  // la línea personal de un asesor (coexistencia), sus leads nuevos son
  // `advisor_whatsapp` (solo suyos, fuera de stats/reparto) y la conversación
  // queda anclada a SU número (inboxId) para que las respuestas del CRM también
  // salgan por ahí.
  const inboxId     = normalizeBusinessNumber(echo.from);
  const advisorLine = await getAdvisorLine('ycloud', echo.from);

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
      expireAt:    webhookEventExpireAt(),
      channel:     'ycloud_echo',
    });
  } catch {
    logger.warn('[ycloud Echo] Duplicado ignorado', { msgId });
    return;
  }

  // Extraer contenido
  let content  = '';
  let mediaType:        string | undefined;
  let mediaSourceUrl:   string | undefined;
  let mediaPending      = false;

  if (echo.type === 'text' && echo.text) {
    content = echo.text.body;
  } else if (['image','video','audio','document','sticker'].includes(echo.type)) {
    const mediaData = (echo as unknown as Record<string, unknown>)[echo.type] as {
      id?: string; link?: string; mime_type: string; caption?: string; filename?: string
    } | undefined;

    if (mediaData) {
      mediaType = mediaData.mime_type;
      content   = mediaData.caption ?? '';

      // NO descargar aquí: el asesor puede mandar videos/PDF pesados y bloquear
      // la respuesta al webhook (ycloud da timeout y reintenta). Guardamos la
      // media como "pendiente" y la re-aloja el trigger onMediaRehost en segundo
      // plano. Ver [mediaRehost.trigger].
      const mediaSource = getYcloudMediaSource(mediaData);
      if (mediaSource) {
        mediaSourceUrl = mediaSource;
        mediaPending   = true;
      } else if (!content.trim()) {
        content = `${mediaKindLabel(echo.type)} (no se pudo cargar)`;
      }
    }
  } else if (echo.type === 'location') {
    content = formatLocationMessage(echo.location);
  } else if (echo.type === 'contacts') {
    content = formatContactsMessage(echo.contacts);
  } else {
    content = nonChatTypeLabel(echo.type);
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
      source:          advisorLine ? ADVISOR_WHATSAPP_SOURCE : 'whatsapp',
      inboxProvider:   'ycloud',
      ...(inboxId ? { inboxId } : {}),
      ...(advisorLine ? { assignedTo: advisorLine.advisorId } : {}),
      aiEnabled:       advisorLine ? false : true,
      tags:            [],
      metadata:        advisorLine ? { advisorWhatsappMirror: 'true' } : {},
      createdAt:       now,
      updatedAt:       now,
    });
    logger.info('[ycloud Echo] Nuevo lead creado desde echo', {
      leadId: lead.id, phone, advisorLine: advisorLine?.advisorId,
    });
    if (advisorLine) lead.assignedTo = advisorLine.advisorId;   // sin reparto
    else lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
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
    ...(mediaType       && { mediaType }),
    ...(mediaType       && { mediaKind: toMediaKind(echo.type) }),
    ...(mediaPending    && { mediaPending: true }),
    ...(mediaSourceUrl  && { mediaSourceUrl }),
    createdAt:        now,
    metadata: {
      deliveryChannel: 'company_whatsapp',
      origin: 'company_whatsapp_echo',
      businessPhone: echo.from,
    },
  });

  // Actualizar lastMessage del lead. Si el eco viene de la línea de un asesor y el
  // lead atiende por SU línea (está atendiendo a mano), apaga la IA. NO se reescribe
  // el `inboxId` de un lead existente: la 317 sigue siendo la principal y los leads
  // no se "mueven" de línea solos. Solo se fija si el lead aún no tenía línea.
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText:        content || (mediaType ? '📎 Archivo adjunto' : ''),
    lastMessageAt:          now,
    lastAdvisorMessageAt:   now,
    ...(advisorLine ? {
      inboxProvider:       'ycloud',
      ...(inboxId && !lead.inboxId ? { inboxId } : {}),
      aiEnabled:           false,
      pendingFirstContact: false,
    } : {}),
  });

  logger.info('[ycloud Echo] Mensaje de app guardado', {
    leadId: lead.id, msgId, type: echo.type, advisorLine: advisorLine?.advisorId,
  });
}

// ─── Descarga con autenticación ───────────────────────────────────────────────

/** Traduce el estado que reporta YCloud/WhatsApp al estado interno del mensaje. */
function mapYcloudStatusToMessage(status: string): MessageStatus | null {
  const value = status.toLowerCase();
  if (value === 'read') return 'read';
  if (value === 'delivered') return 'delivered';
  if (['failed', 'undelivered', 'error', 'rejected'].includes(value)) return 'failed';
  if (['sent', 'queued', 'accepted'].includes(value)) return 'sent';
  return null;
}

async function processYcloudMessageUpdate(update: YcloudSmbMessageEcho): Promise<void> {
  const companyId = await resolveCompanyIdForChannel('ycloud', update.from);
  const msgId     = update.wamid || update.id;

  // Estado de entrega (sent/delivered/read/failed). No requiere teléfono, así
  // que va PRIMERO: los eventos de solo-estado a veces no traen `to` y antes se
  // reventaba en `.startsWith` antes de llegar hasta aquí.
  if (msgId && update.status) {
    // 1) Difusiones: actualiza los contadores del broadcast (si aplica).
    await updateBroadcastDeliveryStatus(companyId, msgId, update.status);
    // 2) Conversación: actualiza el estado del propio mensaje del chat, para
    //    CUALQUIER mensaje saliente (plano, audio, manual…), no solo difusiones.
    //    Así la app muestra si se entregó/leyó o falló.
    const chatStatus = mapYcloudStatusToMessage(update.status);
    if (chatStatus) {
      // Buscar por AMBOS ids: los envíos por API guardan el id interno de ycloud
      // y los ecos de la app nativa guardan el wamid. Pasando los dos, el acuse
      // siempre encuentra su mensaje (antes se priorizaba wamid y no coincidía).
      const candidateIds = [update.id, update.wamid].filter((v): v is string => !!v);
      const extra = chatStatus === 'failed' ? {
        failureReason: update.errorMessage || update.error?.message,
        failureCode:   update.errorCode    || (update.error?.code != null ? String(update.error.code) : undefined),
      } : undefined;
      await messagesRepository.updateStatusByExternalId(candidateIds, chatStatus, extra);
    }
  }

  // El re-alojo de media sí necesita el teléfono del cliente y un tipo de media.
  // Si la actualización no trae `to` (evento de solo-estado), termina aquí en vez
  // de fallar con "Cannot read properties of undefined (reading 'startsWith')".
  if (!update.to || !['image','video','audio','document','sticker'].includes(update.type)) return;

  const rawTo     = update.to.startsWith('+') ? update.to.slice(1) : update.to;
  const phone     = `+${rawTo}`;
  const normPhone = toNormalizedPhone(phone);

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
    const { apiKey } = await getYcloudConfigForCompany(companyId);
    const buffer = await downloadUrl(mediaSource, apiKey);
    const ext    = mimeToExt(mediaType);
    const path   = `companies/${companyId}/media/${msgId}.${ext}`;
    const result = await uploadMediaBuffer(buffer, mediaType, path);
    mediaUrl         = result.downloadUrl;
    mediaStoragePath = result.storagePath;
  } catch (err) {
    logger.warn('[ycloud Update] Descarga de media falló (best-effort)', { error: String(err), msgId });
    return;
  }

  const updated = await messagesRepository.updateByTwilioSid(companyId, lead.id, msgId, {
    content: mediaData.caption ?? '',
    mediaUrl,
    mediaType,
    mediaKind: toMediaKind(update.type),
    ...(mediaStoragePath && { mediaStoragePath }),
    mediaPending: FieldValue.delete() as never,
    mediaSourceUrl: FieldValue.delete() as never,
    mediaRehostAttempts: FieldValue.delete() as never,
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
    await ref.create({ eventId, processedAt: Timestamp.now(), expireAt: webhookEventExpireAt(), channel: 'ycloud_calling' });
    return true;
  } catch {
    logger.warn('[ycloud Calling] Evento duplicado ignorado', { eventId });
    return false;
  }
}

async function processYcloudCallConnect(eventId: string, payload: YcloudCallingConnect): Promise<void> {
  const businessIdentifier = payload.direction === 'USER_INITIATED' ? payload.to : payload.from;
  const companyId = await resolveCompanyIdForChannel('ycloud', payload.phoneId ?? businessIdentifier);
  if (!(await callingIdempotencyGuard(companyId, eventId))) return;

  const wacid = payload.wacid ?? payload.id;
  const phoneId = payload.phoneId ?? (await getYcloudConfigForCompany(companyId)).callingPhoneId;

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
  const companyId = await resolveCompanyIdForChannel('ycloud', payload.wabaId);
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
  const businessIdentifier = payload.direction === 'USER_INITIATED' ? payload.to : payload.from;
  const companyId = await resolveCompanyIdForChannel('ycloud', payload.phoneId ?? businessIdentifier);
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

/**
 * Detecta si el primer mensaje corresponde al BOTÓN de WhatsApp de la página web
 * (texto precargado "Hola, me gustaría hablar con el área de <Área>"). Un enlace
 * wa.me normal no trae atribución de origen; esa frase es la única señal. Es una
 * heurística: si el visitante borra/edita el texto, no se detecta (queda como
 * WhatsApp directo). Devuelve el área si coincide, o null.
 */
function detectWebWhatsAppButton(text?: string): { area?: string } | null {
  if (!text) return null;
  // Normalizar: quitar acentos + minúsculas para tolerar variaciones.
  const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = norm.match(/me gustaria hablar con el area de\s+(.+)/);
  if (!m) return null;
  const area = m[1]?.trim().replace(/[.!?\s]+$/, '');
  return { area: area || undefined };
}

/**
 * Extrae un teléfono E.164 del TEXTO de un mensaje. Sirve para el flujo de Meta
 * "completé el formulario … Phone number: +X", donde el número viene en el cuerpo
 * aunque WhatsApp oculte el remitente. Prioriza el que sigue a "phone/teléfono".
 */
function extractPhoneFromText(text?: string): string {
  if (!text) return '';
  const toE164 = (s: string): string => {
    const d = s.replace(/\D/g, '');
    return d.length >= 8 && d.length <= 15 ? `+${d}` : '';
  };
  const kw = text.match(/(?:phone number|n[uú]mero de tel[eé]fono|tel[eé]fono|celular)\s*[:\-]?\s*(\+?\d[\d\s().-]{6,16}\d)/i);
  if (kw) { const p = toE164(kw[1]); if (p) return p; }
  const plus = text.match(/\+\s?\d[\d\s().-]{6,16}\d/);
  if (plus) { const p = toE164(plus[0]); if (p) return p; }
  return '';
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
