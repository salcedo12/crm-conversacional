import { onRequest } from 'firebase-functions/v2/https';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { DOCUBLOCK_ORGANIZATION_ID } from '../integrations/docublock/docublock.logic';
import {
  parseDocuBlockWebhookEvent,
  verifyDocuBlockWebhookSignature,
} from '../integrations/docublock/docublockWebhook.logic';
import { applyDocuBlockWebhookEvent } from '../modules/deals/dealSignature.service';

/**
 * Webhook receptor de DocuBlock Webhooks v2 (`signer.signed`, `signer.rejected`,
 * `document.completed`, `document.cancelled`, `document.expired`, `document.anchored`).
 * Independiente del webhook clásico v1 usado por SmartHome.
 */
export const docublockWebhook = onRequest(
  {
    region: 'us-central1',
    cors: false,
    timeoutSeconds: 60,
    memory: '512MiB',
    invoker: 'public',
    secrets: ['DOCUBLOCK_API_KEY'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.sendStatus(405);
      return;
    }

    const secret = env.docublockWebhookSecret();
    if (!secret) {
      logger.error('[DocuBlock Webhook] DOCUBLOCK_WEBHOOK_SECRET no configurado — petición rechazada');
      res.status(503).json({ ok: false, error: 'webhook not configured' });
      return;
    }

    if (!req.rawBody) {
      res.status(400).json({ ok: false, error: 'missing raw body' });
      return;
    }

    const check = verifyDocuBlockWebhookSignature({
      rawBody: req.rawBody,
      timestampHeader: req.get('x-docublock-timestamp'),
      signatureHeader: req.get('x-docublock-signature'),
      secret,
    });
    if (!check.valid) {
      logger.warn('[DocuBlock Webhook] Firma HMAC inválida — rechazado');
      res.status(401).json({ ok: false, error: 'invalid signature' });
      return;
    }
    logger.info('[DocuBlock Webhook] Firma HMAC verificada', { matchedFormat: check.matchedFormat });

    const event = parseDocuBlockWebhookEvent(req.body);
    if (!event) {
      res.status(400).json({ ok: false, error: 'invalid payload' });
      return;
    }

    if (event.organizationId && event.organizationId !== DOCUBLOCK_ORGANIZATION_ID) {
      logger.warn('[DocuBlock Webhook] Organización desconocida ignorada', { organizationId: event.organizationId });
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      const result = await applyDocuBlockWebhookEvent(event);
      logger.info('[DocuBlock Webhook] Procesado', {
        type: event.type,
        documentId: event.documentId,
        ...result,
      });
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      logger.error('[DocuBlock Webhook] Error procesando evento', {
        type: event.type,
        documentId: event.documentId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ ok: false });
    }
  },
);
