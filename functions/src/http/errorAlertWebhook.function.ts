import { onRequest } from 'firebase-functions/v2/https';
import { createHash } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { db } from '../lib/admin';
import { getOpenAIClient } from '../integrations/openai/openai.client';
import { getYcloudClient } from '../integrations/ycloud/ycloud.client';
import { phoneTail, toNormalizedPhone } from '../utils/phone';

/**
 * Recibe las alertas de error de Google Cloud Monitoring (canal de notificación
 * tipo Webhook), pide a OpenAI que las traduzca a lenguaje claro y las manda por
 * WhatsApp al número configurado. Así el equipo recibe "qué falló y qué revisar"
 * en vez de un stack técnico.
 *
 * IMPORTANTE (anti-bucle): este webhook NO debe usar logger.error para sus
 * propios fallos — eso volvería a disparar la alerta de errores y se generaría un
 * bucle. Usa logger.warn. Además deduplica por firma del error (30 min) para no
 * spamear ni gastar OpenAI de más con el mismo error repetido.
 *
 * Config (functions/.env): ERROR_ALERT_WEBHOOK_SECRET (obligatorio),
 * ERROR_ALERT_PHONE (E.164), ERROR_ALERT_TEMPLATE (opcional, para enviar fuera de
 * la ventana de 24h de WhatsApp).
 */

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

export const errorAlertWebhook = onRequest(
  { region: 'us-central1', cors: false, timeoutSeconds: 30, memory: '256MiB', invoker: 'public' },
  async (req, res) => {
    // ── Autenticación ────────────────────────────────────────────────────────
    const secret = env.errorAlertWebhookSecret();
    const provided = (req.query.secret as string | undefined) ?? req.header('x-alert-secret') ?? undefined;
    if (!secret || provided !== secret) { res.sendStatus(401); return; }
    if (req.method !== 'POST') { res.sendStatus(405); return; }

    const phone = env.errorAlertPhone();
    if (!phone || !env.useYcloud() || !env.openaiApiKey()) {
      logger.warn('[ErrorAlert] Falta config (teléfono/YCloud/OpenAI) — no se procesa');
      res.sendStatus(200);
      return;
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { summary, payload } = extractError(body);
      if (!payload) { res.sendStatus(200); return; }

      // Anti-spam / anti-bucle: no repetir el mismo error dentro de la ventana.
      const sig = createHash('sha1').update(summary || payload.slice(0, 200)).digest('hex').slice(0, 32);
      if (await recentlyAlerted(sig)) { res.sendStatus(200); return; }

      const explanation = await interpretError(payload);
      if (await alertPhoneBelongsToLead(phone)) {
        logger.warn('[ErrorAlert] ERROR_ALERT_PHONE coincide con un lead; se bloquea alerta para no escribirle a un cliente', {
          phoneTail: phoneTail(phone),
        });
        res.sendStatus(200);
        return;
      }
      await sendWhatsAppAlert(phone, explanation);
      logger.info('[ErrorAlert] Alerta interpretada enviada por WhatsApp', { to: phone });
    } catch (err) {
      // logger.warn (NO error) para no re-disparar la alerta y crear un bucle.
      logger.warn('[ErrorAlert] No se pudo procesar la alerta', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.sendStatus(200);
  }
);

/** Extrae un resumen corto y el payload legible del cuerpo de la alerta de GCP. */
function extractError(body: Record<string, unknown>): { summary: string; payload: string } {
  const incident = (body.incident ?? {}) as Record<string, unknown>;
  const summary =
    (typeof incident.summary === 'string' && incident.summary) ||
    (typeof body.summary === 'string' && body.summary) ||
    '';
  // Se pasa el JSON recortado para que la IA lo interprete sin depender del esquema exacto.
  const payload = JSON.stringify(body).slice(0, 4000);
  return { summary: String(summary), payload };
}

/** Deduplica por firma: true si ya se avisó de este error en los últimos 30 min. */
async function recentlyAlerted(sig: string): Promise<boolean> {
  const ref = db.collection('systemAlerts').doc(sig);
  const now = Date.now();
  const snap = await ref.get();
  if (snap.exists) {
    const at = (snap.data()?.at as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (now - at < DEDUP_WINDOW_MS) return true;
  }
  await ref.set({
    at:       Timestamp.now(),
    // TTL: limpieza automática (activar política TTL sobre systemAlerts.expireAt si se desea).
    expireAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
  });
  return false;
}

/** Pide a OpenAI una explicación breve y clara del error. */
async function interpretError(payload: string): Promise<string> {
  const completion = await getOpenAIClient().chat.completions.create({
    model:       'gpt-4o-mini',
    temperature: 0.2,
    max_tokens:  220,
    messages: [
      {
        role: 'system',
        content:
          'Eres ingeniero de software senior de un CRM (Firebase Cloud Functions + Firestore + OpenAI + WhatsApp/YCloud). ' +
          'Te paso el payload de una alerta de error de Google Cloud. Explica al equipo (NO técnico) en español, claro y breve ' +
          '(máximo 5 líneas cortas), con este formato:\n' +
          '• Qué falló (función/parte)\n• Causa probable\n• Impacto (si es leve, dilo)\n• Qué revisar\n' +
          'Sé concreto, no inventes. Si el payload no trae suficiente detalle, dilo y sugiere revisar los logs.',
      },
      { role: 'user', content: payload },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  return text || 'Ocurrió un error en el CRM pero no se pudo interpretar el detalle. Revisa los logs en Google Cloud.';
}

/** Envía la alerta por WhatsApp (plantilla si está configurada; si no, texto libre). */
async function sendWhatsAppAlert(phone: string, explanation: string): Promise<void> {
  const message = `🚨 *Alerta del CRM*\n\n${explanation}`;
  const template = env.errorAlertTemplate();
  if (template) {
    await getYcloudClient().sendTemplate(phone, template, 'es', [
      { type: 'body', parameters: [{ type: 'text', text: explanation.slice(0, 1000) }] },
    ]);
    return;
  }
  await getYcloudClient().sendText(phone, message);
}

async function alertPhoneBelongsToLead(phone: string): Promise<boolean> {
  const normalizedPhone = toNormalizedPhone(phone);
  const tail = phoneTail(phone);

  const exact = await db
    .collectionGroup('leads')
    .where('normalizedPhone', '==', normalizedPhone)
    .limit(1)
    .get();
  if (!exact.empty) return true;

  if (!tail) return false;
  const byTail = await db
    .collectionGroup('leads')
    .where('phoneTail', '==', tail)
    .limit(1)
    .get();
  return !byTail.empty;
}
