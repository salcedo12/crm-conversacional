import { getOpenAIClient } from '../../integrations/openai/openai.client';
import { getYcloudClient } from '../../integrations/ycloud/ycloud.client';
import { env } from '../../config/env';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { phoneTail, toNormalizedPhone } from '../../utils/phone';

/** ¿Está lista la alerta por WhatsApp? (número + YCloud + OpenAI configurados). */
export function errorAlertsEnabled(): boolean {
  return !!env.errorAlertPhone() && env.useYcloud() && !!env.openaiApiKey();
}

/**
 * Pide a OpenAI una explicación breve y clara (en español) de un error del CRM,
 * para que el equipo entienda qué pasó sin leer un stack técnico.
 */
export async function interpretError(errorInfo: string): Promise<string> {
  const completion = await getOpenAIClient().chat.completions.create({
    model:       'gpt-4o-mini',
    temperature: 0.2,
    max_tokens:  240,
    messages: [
      {
        role: 'system',
        content:
          'Eres ingeniero de software senior de un CRM (Firebase Cloud Functions + Firestore + OpenAI + WhatsApp/YCloud + Meta). ' +
          'Te paso la información de un error que ocurrió. Explica al equipo (NO técnico) en español, claro y breve ' +
          '(máximo 5 líneas cortas), con este formato exacto:\n' +
          '• Qué falló (función/parte)\n• Causa probable\n• Impacto (si es leve, dilo)\n• Qué revisar\n' +
          'Sé concreto y honesto. No inventes. Si el error parece inofensivo o ya se maneja solo, dilo.',
      },
      { role: 'user', content: errorInfo.slice(0, 4000) },
    ],
  });
  return completion.choices[0]?.message?.content?.trim()
    || 'Ocurrió un error en el CRM pero no se pudo interpretar el detalle. Revisa los logs en Google Cloud.';
}

/** Envía la explicación por WhatsApp (plantilla si está configurada; si no, texto libre). */
export async function sendErrorWhatsApp(explanation: string): Promise<void> {
  const phone = env.errorAlertPhone();
  if (!phone) return;
  if (await alertPhoneBelongsToLead(phone)) {
    logger.warn('[ErrorAlert] ERROR_ALERT_PHONE coincide con un lead; se bloquea alerta para no escribirle a un cliente', {
      phoneTail: phoneTail(phone),
    });
    return;
  }
  const template = env.errorAlertTemplate();
  if (template) {
    await getYcloudClient().sendTemplate(phone, template, 'es', [
      { type: 'body', parameters: [{ type: 'text', text: explanation.slice(0, 1000) }] },
    ]);
    return;
  }
  await getYcloudClient().sendText(phone, `🚨 *Alerta del CRM*\n\n${explanation}`);
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
