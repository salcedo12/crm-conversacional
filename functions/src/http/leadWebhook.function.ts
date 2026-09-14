import { onRequest } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ingestWebLead } from '../modules/leads/webLeadIntake.service';

/**
 * Endpoint público que recibe los leads del formulario de la página web y los
 * mete al CRM (crea/asocia lead, asigna asesor, deja el formulario en el chat y
 * —si el lead es nuevo— manda una bienvenida por WhatsApp).
 *
 * Pensado para llamarse SERVIDOR-A-SERVIDOR desde el handler PHP del sitio (que
 * ya valida reCAPTCHA), enviando el secreto en el header `X-Lead-Key`. Así el
 * secreto nunca queda expuesto en el navegador y nadie puede disparar envíos de
 * WhatsApp (que cuestan dinero) desde fuera.
 *
 * Body JSON esperado: { nombre, telefono, email?, mensaje?, fuente? }
 */
export const leadWebhook = onRequest(
  { region: 'us-central1', cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    // ── CORS ──────────────────────────────────────────────────────────────────
    const origin  = req.get('origin') ?? '';
    const allowed = env.leadWebhookOrigins();
    if (allowed.length === 0 || allowed.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin || '*');
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Lead-Key');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

    // ── Autenticación por secreto compartido ───────────────────────────────────
    const secret = env.leadWebhookSecret();
    if (!secret) {
      logger.error('[leadWebhook] LEAD_WEBHOOK_SECRET no configurado — endpoint deshabilitado');
      res.status(503).json({ ok: false, error: 'not_configured' });
      return;
    }
    const provided = String(req.get('x-lead-key') ?? '');
    const ok = provided.length === secret.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    if (!ok) {
      logger.warn('[leadWebhook] Secreto inválido', { origin });
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    // ── Body ────────────────────────────────────────────────────────────────────
    const body = (typeof req.body === 'object' && req.body) ? req.body as Record<string, unknown> : {};
    const nombre   = String(body.nombre   ?? '').trim();
    const telefono = String(body.telefono ?? '').trim();
    const email    = String(body.email    ?? '').trim();
    const mensaje  = String(body.mensaje  ?? '').trim();
    const fuente   = String(body.fuente   ?? '').trim();

    if (!telefono && !nombre) {
      res.status(400).json({ ok: false, error: 'missing_fields' });
      return;
    }

    // Atribución del tráfico (UTMs + click-ids) que envía la página web.
    const pick = (k: string) => { const v = body[k]; return v == null ? undefined : String(v).slice(0, 255); };
    const attribution = {
      utm_source:   pick('utm_source'),
      utm_medium:   pick('utm_medium'),
      utm_campaign: pick('utm_campaign'),
      utm_content:  pick('utm_content'),
      utm_term:     pick('utm_term'),
      fbclid:       pick('fbclid'),
      gclid:        pick('gclid'),
      referrer:     pick('referrer'),
    };

    try {
      const result = await ingestWebLead({
        companyId:       env.leadWebhookCompanyId(),
        name:            nombre || undefined,
        phone:           telefono || undefined,
        email:           email || undefined,
        message:         mensaje || undefined,
        source:          fuente || 'Formulario web',
        welcomeTemplate: env.leadWebWelcomeTemplate(),
        attribution,
      });
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      logger.error('[leadWebhook] Error ingiriendo lead web', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ ok: false, error: 'internal' });
    }
  }
);
