import { Timestamp } from 'firebase-admin/firestore';
import { env } from '../../config/env';
import { getYcloudClientForCompany } from '../../integrations/ycloud/ycloud.client';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { phoneTail, toNormalizedPhone } from '../../utils/phone';
import { TEST_LEAD_TAG } from './aiRollout';

/** Plantilla aprobada "🚨 Alerta del CRM: {{1}} …" (se puede cambiar con ERROR_ALERT_TEMPLATE). */
const DEFAULT_ALERT_TEMPLATE = 'alerta_sistema';
/** Si OpenAI se cae, fallan todos los chats a la vez: un aviso cada 30 min, con el conteo. */
export const AI_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/** Explica en palabras simples por qué falló OpenAI (sin llamar a OpenAI, que es lo que falla). */
export function aiFailureReason(error: string): string {
  const e = error.toLowerCase();
  if (/insufficient_quota|quota|billing|exceeded your current/.test(e)) return 'la cuenta de OpenAI se quedó sin saldo o llegó a su límite de gasto';
  if (/\b401\b|invalid api key|incorrect api key|unauthorized/.test(e)) return 'la llave de OpenAI no es válida';
  if (/\b429\b|rate limit/.test(e)) return 'OpenAI está limitando la cantidad de mensajes por minuto';
  if (/timeout|timed out|etimedout|econnreset|aborted/.test(e)) return 'OpenAI tardó demasiado en responder';
  if (/\b5\d\d\b|server error|overloaded|unavailable/.test(e)) return 'OpenAI está caído o con fallas';
  return 'error técnico al llamar a OpenAI';
}

/** Meta rechaza variables de plantilla con saltos de línea o muchos espacios seguidos. */
export function oneLine(text: string, max = 900): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildAiFailureAlert(input: {
  leadName: string; phoneTail: string; reason: string; otherFailures: number;
}): string {
  const others = input.otherFailures > 0
    ? ` Desde el aviso anterior fallaron ${input.otherFailures} chat(s) más.`
    : '';
  return oneLine(
    `La IA Victoria no pudo responder a ${input.leadName}${input.phoneTail ? ` (…${input.phoneTail})` : ''}: ${input.reason}. ` +
    `El cliente recibió el mensaje de respaldo, la IA quedó pausada en ese chat y se avisó al asesor asignado.${others} ` +
    'Si el problema sigue, los chats nuevos también pasarán a los asesores.'
  );
}

/** El número de alertas no debe ser de un cliente real (sí puede ser un número de prueba de la IA). */
async function phoneIsRealClient(phone: string): Promise<boolean> {
  const snaps = await Promise.all([
    db.collectionGroup('leads').where('normalizedPhone', '==', toNormalizedPhone(phone)).limit(5).get(),
    phoneTail(phone)
      ? db.collectionGroup('leads').where('phoneTail', '==', phoneTail(phone)).limit(5).get()
      : Promise.resolve(null),
  ]);
  return snaps.some((snap) => snap?.docs.some((doc) => {
    const tags = doc.data().tags;
    return !(Array.isArray(tags) && tags.includes(TEST_LEAD_TAG));
  }));
}

/**
 * Avisa por WhatsApp (ERROR_ALERT_PHONE) que la IA no pudo responder. Agrupa: si ya se
 * avisó hace menos de 30 min, solo suma al conteo y lo informa en el siguiente aviso.
 * Nunca lanza error: es un aviso de mejor esfuerzo.
 */
export async function sendAiFailureAlert(
  companyId: string,
  lead: { name?: string | null; phone?: string | null },
  error: string,
): Promise<void> {
  try {
    const phone = env.errorAlertPhone();
    if (!phone) return;

    const ref = db.doc(`companies/${companyId}/aiAlerts/openaiFailure`);
    const otherFailures = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() ?? {};
      const lastMs = (data.lastSentAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (Date.now() - lastMs < AI_ALERT_COOLDOWN_MS) {
        tx.set(ref, { pendingCount: (data.pendingCount ?? 0) + 1, lastError: error.slice(0, 300) }, { merge: true });
        return null;
      }
      tx.set(ref, { lastSentAt: Timestamp.now(), pendingCount: 0, lastError: error.slice(0, 300) }, { merge: true });
      return (data.pendingCount as number | undefined) ?? 0;
    });
    if (otherFailures === null) return;

    if (await phoneIsRealClient(phone)) {
      logger.warn('[AI] Aviso de falla no enviado: ERROR_ALERT_PHONE es de un cliente', { phoneTail: phoneTail(phone) });
      return;
    }

    const text = buildAiFailureAlert({
      leadName:      lead.name?.trim() || 'un lead',
      phoneTail:     String(lead.phone ?? '').replace(/\D/g, '').slice(-4),
      reason:        aiFailureReason(error),
      otherFailures,
    });
    const client = await getYcloudClientForCompany(companyId);
    await client.sendTemplate(phone, env.errorAlertTemplate() || DEFAULT_ALERT_TEMPLATE, 'es', [
      { type: 'body', parameters: [{ type: 'text', text }] },
    ]);
    logger.info('[AI] Aviso de falla de la IA enviado por WhatsApp', { companyId, otherFailures });
  } catch (err) {
    // warn (no error): un logger.error encolaría otra alerta y podría hacer bucle.
    logger.warn('[AI] No se pudo enviar el aviso de falla por WhatsApp', {
      companyId, error: err instanceof Error ? err.message : String(err),
    });
  }
}
