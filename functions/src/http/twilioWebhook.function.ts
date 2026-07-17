import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { normalizePhone, toNormalizedPhone } from '../utils/phone';
import { validateTwilioSignature, getWebhookUrl } from '../integrations/twilio/twilio.validate';
import { getTwilioClient } from '../integrations/twilio/twilio.client';
import { leadsRepository } from '../modules/leads/leads.repository';
import { assignLead } from '../modules/leads/leadAssignment.service';
import { messagesRepository } from '../modules/messages/messages.repository';
import { updateBroadcastDeliveryStatus } from '../modules/broadcasts/broadcastStatus.service';
import { uploadMediaBuffer, mimeToExt } from '../utils/storageUpload';

// ── Validación del payload con Zod ──────────────────────────────────────────
const TwilioPayloadSchema = z.object({
  MessageSid:          z.string().min(1),
  From:                z.string().min(1),
  To:                  z.string().min(1),
  Body:                z.string().default(''),
  ProfileName:         z.string().optional(),
  NumMedia:            z.string().optional(),
  MediaUrl0:           z.string().optional(),
  MediaContentType0:   z.string().optional(),
  MediaUrl1:           z.string().optional(),
  MediaContentType1:   z.string().optional(),
  AccountSid:          z.string().optional(),
  MessageStatus:       z.string().optional(), // presente en status callbacks (sent/delivered/read)
});

// ── Webhook ──────────────────────────────────────────────────────────────────
/**
 * Recibe mensajes inbound de WhatsApp via Twilio.
 *
 * Responsabilidades (rápidas, < 5 seg):
 * 1. Validar firma de Twilio (si VALIDATE_TWILIO_SIGNATURE=true).
 * 2. Validar payload con Zod.
 * 3. Idempotencia por MessageSid (evita duplicados si Twilio reintenta).
 * 4. Normalizar teléfono.
 * 5. Buscar o crear lead en companies/{companyId}/leads/{leadId}.
 * 6. Guardar mensaje inbound en companies/{companyId}/leads/{leadId}/messages/{id}.
 * 7. Actualizar lastMessage del lead.
 * 8. Responder 200 TwiML vacío a Twilio.
 *
 * La generación de respuesta IA ocurre en el trigger messageCreated (función separada).
 * Esto garantiza que Twilio siempre reciba respuesta en < 3 segundos.
 */
export const webhookWhatsapp = onRequest(
  {
    region:         'us-central1',
    cors:           false,
    timeoutSeconds: 30,       // Solo operaciones Firestore, no necesita más
    memory:         '256MiB',
    invoker:        'public',
  },
  async (req, res) => {
    // Solo POST
    if (req.method !== 'POST') {
      res.sendStatus(405);
      return;
    }

    // ── 1. Validar firma de Twilio ────────────────────────────────────────
    if (env.validateSignature()) {
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      const url       = getWebhookUrl(req as Parameters<typeof getWebhookUrl>[0]);
      const isValid   = validateTwilioSignature(
        env.twilioAuthToken(),
        signature ?? '',
        url,
        req.body as Record<string, string>
      );

      if (!isValid) {
        logger.warn('[Webhook] Firma de Twilio inválida', { url, hasSignature: !!signature });
        res.sendStatus(403);
        return;
      }
    }

    // ── 2. Validar payload ────────────────────────────────────────────────
    const parseResult = TwilioPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn('[Webhook] Payload inválido', { errors: parseResult.error.flatten() });
      // Responder 200 a Twilio para evitar reintentos con datos inválidos
      res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
      return;
    }

    const {
      MessageSid, From, To, Body, ProfileName, MessageStatus,
      NumMedia, MediaUrl0, MediaContentType0,
    } = parseResult.data;
    const companyId   = env.defaultCompanyId();
    const phone       = normalizePhone(From);      // +573213443603
    const normPhone   = toNormalizedPhone(From);   // para búsquedas

    // ── Ignorar status callbacks (sent / delivered / read / failed) ───────
    // Twilio envía callbacks al mismo webhook cuando cambia el estado de un msg outbound.
    // En esos callbacks From = nuestro número, To = cliente. No son mensajes entrantes.
    if (MessageStatus) {
      await updateBroadcastDeliveryStatus(companyId, MessageSid, MessageStatus);
      logger.info('[Webhook] Status callback procesado', { messageSid: MessageSid, MessageStatus });
      res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
      return;
    }

    // ── Ignorar mensajes cuyo From sea nuestro propio número Twilio ───────
    // Evita crear un "lead" con el número del sandbox/producción de Twilio.
    const ownNumber = normalizePhone(env.twilioFromNumber());
    if (phone === ownNumber) {
      logger.info('[Webhook] Mensaje propio ignorado (From = nuestro número)', { phone });
      res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
      return;
    }

    logger.info('[Webhook] Mensaje recibido', {
      messageSid: MessageSid,
      from:       phone,
      to:         To,
      bodyLength: Body.length,
    });

    // ── 3. Idempotencia: verificar si el MessageSid ya fue procesado ──────
    const idempotencyRef = db
      .collection('companies').doc(companyId)
      .collection('webhookEvents').doc(MessageSid);

    try {
      // create() falla si el documento ya existe → duplicado detectado
      await idempotencyRef.create({
        messageSid:  MessageSid,
        from:        phone,
        processedAt: Timestamp.now(),
      });
    } catch {
      // El documento ya existía → mensaje duplicado (Twilio reintento)
      logger.warn('[Webhook] Mensaje duplicado ignorado', { messageSid: MessageSid });
      res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
      return;
    }

    try {
      const now = Timestamp.now();

      // ── 4. Buscar o crear lead ────────────────────────────────────────
      let lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);

      if (!lead) {
        lead = await leadsRepository.create(companyId, {
          companyId,
          phone,
          normalizedPhone: normPhone,
          name:            ProfileName || `Lead ${phone}`,
          status:          'new',
          source:          'whatsapp',
          aiEnabled:       true,   // IA activa por defecto para leads nuevos
          tags:            [],
          metadata:        {},
          createdAt:       now,
          updatedAt:       now,
        });
        logger.info('[Webhook] Nuevo lead creado', { leadId: lead.id, phone });
        lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
      }

      // ── 5. Procesar media adjunta (si existe) ────────────────────────
      let mediaUrl:         string | undefined;
      let mediaType:        string | undefined;
      let mediaStoragePath: string | undefined;

      const hasMedia = parseInt(NumMedia ?? '0', 10) > 0 && MediaUrl0;
      if (hasMedia && MediaUrl0) {
        mediaType = MediaContentType0 ?? 'application/octet-stream';
        try {
          const buffer  = await getTwilioClient().downloadMedia(MediaUrl0);
          const ext     = mimeToExt(mediaType);
          const path    = `companies/${companyId}/media/${lead.id}/${MessageSid}.${ext}`;
          const result  = await uploadMediaBuffer(buffer, mediaType, path);
          mediaUrl         = result.downloadUrl;
          mediaStoragePath = result.storagePath;
          logger.info('[Webhook] Media guardada en Storage', { path, mediaType });
        } catch (err) {
          logger.error('[Webhook] Error guardando media', {
            error: err instanceof Error ? err.message : String(err),
          });
          // Continuar sin media — el mensaje de texto igual se guarda
        }
      }

      // ── 6. Guardar mensaje inbound ───────────────────────────────────
      await messagesRepository.create({
        companyId,
        leadId:          lead.id,
        direction:       'inbound',
        senderType:      'lead',
        content:         Body,
        channel:         'whatsapp',
        status:          'delivered',
        twilioMessageSid: MessageSid,
        aiProcessed:     false,
        ...(mediaUrl         && { mediaUrl }),
        ...(mediaType        && { mediaType }),
        ...(mediaStoragePath && { mediaStoragePath }),
        createdAt:       now,
      });

      // ── 7. Actualizar lastMessage del lead ───────────────────────────
      await leadsRepository.update(companyId, lead.id, {
        lastMessageText: Body || (mediaUrl ? '📎 Archivo adjunto' : ''),
        lastMessageAt:   now,
        lastInboundAt:   now,   // para calcular ventana de 24h de WhatsApp
        ...(ProfileName && lead.name?.startsWith('Lead ') ? { name: ProfileName } : {}),
      });

      logger.info('[Webhook] Mensaje guardado, trigger de IA se activará', {
        leadId:     lead.id,
        messageSid: MessageSid,
      });

    } catch (err) {
      logger.error('[Webhook] Error procesando mensaje', {
        error:      err instanceof Error ? err.message : String(err),
        messageSid: MessageSid,
      });
      // No devolver 5xx a Twilio para evitar reintentos que ya fueron deduplicados
    }

    // Responder siempre 200 TwiML vacío
    res.set('Content-Type', 'text/xml').status(200).send('<Response></Response>');
  }
);
