import * as crypto from 'crypto';
import * as https  from 'https';
import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp }  from 'firebase-admin/firestore';
import type { Request } from 'firebase-functions/v2/https';
import { db }          from '../lib/admin';
import { env }         from '../config/env';
import { logger }      from '../utils/logger';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { assignLead }         from '../modules/leads/leadAssignment.service';
import { messagesRepository } from '../modules/messages/messages.repository';
import { uploadMediaBuffer, mimeToExt } from '../utils/storageUpload';
import type { LeadChannel, LeadSourceMeta } from '../modules/leads/leads.types';
import type { MessageMediaKind } from '../modules/messages/messages.types';

// ─── Tipos del payload de Meta (Messenger Platform / Instagram Messaging) ─────
// Docs: https://developers.facebook.com/docs/messenger-platform/webhooks

interface MetaAttachment {
  type:    string; // image | video | audio | file
  payload: { url?: string };
}

// Presente cuando el mensaje llega desde un anuncio "Click to Messenger/Instagram".
// Docs: https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_referrals
interface MetaReferral {
  ref?:    string;
  ad_id?:  string;   // id del anuncio (para atribución)
  source?: string;   // 'ADS' | 'SHORTLINK' | ...
  type?:   string;   // 'OPEN_THREAD'
  ads_context_data?: { ad_title?: string; photo_url?: string; video_url?: string };
}

interface MetaMessage {
  mid:          string;
  text?:        string;
  attachments?: MetaAttachment[];
  is_echo?:     boolean; // eco de un mensaje enviado por la Página (solo si se suscribe message_echoes)
  referral?:    MetaReferral; // anuncio de origen cuando el 1er mensaje viene de un ad
}

interface MetaMessagingEvent {
  sender:     { id: string }; // PSID (Messenger) o IGSID (Instagram)
  recipient:  { id: string };
  timestamp:  number;
  message?:   MetaMessage;
  referral?:  MetaReferral; // evento de referral (m.me/ad) sin mensaje asociado
}

interface MetaWebhookEntry {
  id:         string;
  time?:      number;
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookBody {
  object: 'page' | 'instagram' | string;
  entry:  MetaWebhookEntry[];
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export const metaMessagingWebhook = onRequest(
  {
    region:         'us-central1',
    cors:           false,
    timeoutSeconds: 30,
    memory:         '512MiB',
    invoker:        'public',
  },
  async (req, res) => {
    // ── Verificación del webhook (Meta la hace una vez, al guardar la URL) ───
    if (req.method === 'GET') {
      const mode      = req.query['hub.mode'];
      const token     = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      const expected  = env.metaVerifyToken();
      if (mode === 'subscribe' && !!expected && token === expected) {
        logger.info('[Meta Webhook] Verificación OK', { mode });
        res.status(200).send(String(challenge ?? ''));
        return;
      }
      logger.warn('[Meta Webhook] Verificación fallida', {
        modeReceived:    mode ?? null,
        hasTokenParam:   typeof token !== 'undefined',
        receivedLength:  typeof token === 'string' ? token.length : null,
        expectedLength:  expected.length,
        exactMatch:      token === expected,
      });
      res.sendStatus(403);
      return;
    }

    if (req.method !== 'POST') { res.sendStatus(405); return; }

    if (!verifySignature(req)) {
      logger.warn('[Meta Webhook] Firma inválida — request rechazado');
      res.sendStatus(401);
      return;
    }

    // Meta espera 200 rápido
    res.sendStatus(200);

    const body = req.body as MetaWebhookBody;
    if (body.object !== 'page' && body.object !== 'instagram') {
      logger.info('[Meta Webhook] Objeto no procesable', { object: body.object });
      return;
    }
    const channel: LeadChannel = body.object === 'page' ? 'messenger' : 'instagram';

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message || event.message.is_echo) continue; // sin mensaje, o eco de un envío propio
        try {
          await processInboundMessage(channel, event);
        } catch (err) {
          logger.error('[Meta Webhook] Error procesando mensaje', {
            channel,
            msgId: event.message?.mid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
);

// ─── Firma ─────────────────────────────────────────────────────────────────────

function verifySignature(req: Request): boolean {
  const secret = env.metaAppSecret();
  if (!secret) {
    logger.warn('[Meta Webhook] META_APP_SECRET no configurado — se omite verificación de firma');
    return true;
  }
  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody ?? Buffer.from(''))
    .digest('hex');
  const provided = header.slice('sha256='.length);

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

// ─── Procesamiento ────────────────────────────────────────────────────────────

async function processInboundMessage(channel: LeadChannel, event: MetaMessagingEvent): Promise<void> {
  const companyId = env.defaultCompanyId();
  const senderId   = event.sender.id;
  const msg        = event.message as MetaMessage;
  const msgId      = msg.mid;

  // Idempotencia
  const idempotencyRef = db
    .collection('companies').doc(companyId)
    .collection('webhookEvents').doc(msgId);
  try {
    await idempotencyRef.create({
      messageId:   msgId,
      from:        senderId,
      processedAt: Timestamp.now(),
      channel,
    });
  } catch {
    logger.warn('[Meta Webhook] Mensaje duplicado ignorado', { msgId, channel });
    return;
  }

  let content = msg.text ?? '';
  let mediaUrl:         string | undefined;
  let mediaType:        string | undefined;
  let mediaKind:        MessageMediaKind | undefined;
  let mediaStoragePath: string | undefined;

  const attachment = msg.attachments?.[0];
  if (attachment?.payload?.url) {
    mediaKind = attachmentTypeToMediaKind(attachment.type);
    mediaType = defaultMimeForAttachmentType(attachment.type);
    try {
      const buffer = await downloadUrl(attachment.payload.url);
      const ext    = mimeToExt(mediaType);
      const path   = `companies/${companyId}/media/${msgId}.${ext}`;
      const result = await uploadMediaBuffer(buffer, mediaType, path);
      mediaUrl         = result.downloadUrl;
      mediaStoragePath = result.storagePath;
      logger.info('[Meta Webhook] Adjunto guardado en Storage', { type: attachment.type, msgId });
    } catch (err) {
      logger.error('[Meta Webhook] Error descargando adjunto', { error: String(err), msgId });
      mediaType = undefined;
      mediaKind = undefined;
    }
  }

  if (!content && !mediaUrl) content = `[${attachment?.type ?? 'mensaje no soportado'}]`;

  const now = Timestamp.now();

  const defaultName = channel === 'messenger' ? 'Lead Messenger' : 'Lead Instagram';

  // Atribución del anuncio de origen (Click to Messenger/Instagram).
  const refMeta = resolveMetaAdReferral(event.referral ?? msg.referral);
  const organicSource = channel === 'messenger' ? 'facebook' : 'instagram';
  if (refMeta) {
    logger.info(`[Meta Webhook] Lead desde anuncio (${channel})`, { adId: refMeta.adId, headline: refMeta.headline });
  }

  // Buscar o crear lead por PSID/IGSID
  let lead = await leadsRepository.findByExternalId(companyId, channel, senderId);
  if (!lead) {
    const profileName = await fetchProfileName(channel, senderId);
    lead = await leadsRepository.create(companyId, {
      companyId,
      phone:            '',
      normalizedPhone:  '',
      name:             profileName ?? defaultName,
      status:           'new',
      source:           refMeta ? 'meta_ads' : organicSource,
      ...(refMeta ? { sourceMeta: refMeta } : {}),
      channel,
      externalId:       senderId,
      channelExternalId: `${channel}:${senderId}`,
      aiEnabled:        true,
      tags:             [],
      metadata:         {},
      createdAt:        now,
      updatedAt:        now,
    });
    logger.info(`[Meta Webhook] Nuevo lead creado (${channel})`, { leadId: lead.id, senderId, source: refMeta ? 'meta_ads' : organicSource });
    lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
  }

  // Si el lead quedó con el nombre genérico (no se pudo enriquecer al crearlo,
  // p.ej. por permisos aún no propagados), reintentar en cada mensaje siguiente.
  const nameUpdate = lead.name === defaultName ? await fetchProfileName(channel, senderId) : undefined;

  // Guardar mensaje
  await messagesRepository.create({
    companyId,
    leadId:           lead.id,
    direction:        'inbound',
    senderType:       'lead',
    content:          content || '',
    channel,
    status:           'delivered',
    twilioMessageSid: msgId,
    aiProcessed:      false,
    ...(mediaUrl         && { mediaUrl }),
    ...(mediaType        && { mediaType }),
    ...(mediaKind        && { mediaKind }),
    ...(mediaStoragePath && { mediaStoragePath }),
    createdAt:        now,
  });

  // Actualizar lead
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: content || (mediaType ? '📎 Archivo adjunto' : ''),
    lastMessageAt:   now,
    lastInboundAt:   now,
    ...(nameUpdate ? { name: nameUpdate } : {}),
    // Re-atribución si un lead existente reescribe desde un anuncio.
    ...(refMeta ? { source: 'meta_ads', sourceMeta: refMeta } : {}),
  });

  logger.info(`[Meta Webhook] Mensaje procesado (${channel})`, { leadId: lead.id, msgId });
}

// ─── Enriquecimiento de perfil (best-effort) ───────────────────────────────────
// Meta restringe los campos de perfil de Messenger desde 2018 fuera del contexto
// de admins/developers/testers de la App (modo desarrollo) — por eso es best-effort
// y con fallback silencioso al nombre genérico si el request falla por permisos.

async function fetchProfileName(channel: LeadChannel, externalId: string): Promise<string | undefined> {
  if (channel === 'messenger') return fetchMessengerProfileName(externalId);
  if (channel === 'instagram') return fetchInstagramProfileName(externalId);
  return undefined;
}

async function fetchMessengerProfileName(psid: string): Promise<string | undefined> {
  const token = env.metaPageAccessToken();
  if (!token) return undefined;
  try {
    const raw = await httpsGetJson(
      `https://graph.facebook.com/v21.0/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(token)}`
    );
    const parsed = JSON.parse(raw) as { first_name?: string; last_name?: string };
    const fullName = [parsed.first_name, parsed.last_name].filter(Boolean).join(' ').trim();
    return fullName || undefined;
  } catch (err) {
    logger.warn('[Meta Webhook] No se pudo obtener perfil de Messenger', { psid, error: String(err) });
    return undefined;
  }
}

async function fetchInstagramProfileName(igsid: string): Promise<string | undefined> {
  const token = env.metaPageAccessToken();
  if (!token) return undefined;
  try {
    const raw = await httpsGetJson(
      `https://graph.facebook.com/v21.0/${igsid}?fields=name,username&access_token=${encodeURIComponent(token)}`
    );
    const parsed = JSON.parse(raw) as { name?: string; username?: string };
    return parsed.name ?? parsed.username;
  } catch (err) {
    logger.warn('[Meta Webhook] No se pudo obtener perfil de Instagram', { igsid, error: String(err) });
    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Deriva la atribución de anuncio a partir del referral de Meta. Solo cuenta si
// trae ad_id (es lo que se cruza con el gasto en el módulo de Marketing).
function resolveMetaAdReferral(referral?: MetaReferral): LeadSourceMeta | undefined {
  if (!referral?.ad_id) return undefined;
  const title = referral.ads_context_data?.ad_title;
  return {
    adId: referral.ad_id,
    ...(title ? { headline: title } : {}),
    ...(referral.ref ? { sourceUrl: referral.ref } : {}),
  };
}

function attachmentTypeToMediaKind(type: string): MessageMediaKind {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return 'file';
}

function defaultMimeForAttachmentType(type: string): string {
  if (type === 'image') return 'image/jpeg';
  if (type === 'video') return 'video/mp4';
  if (type === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function httpsGetJson(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`meta HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        } else {
          resolve(d);
        }
      });
    }).on('error', reject);
  });
}

// Las URLs de adjuntos de Messenger/Instagram son CDN públicas pre-firmadas
// (no requieren headers de autenticación, a diferencia de ycloud).
function downloadUrl(url: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
          && res.headers.location && redirects > 0) {
        res.resume();
        resolve(downloadUrl(res.headers.location, redirects - 1));
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`meta media HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}
