import { createHash } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { env } from '../../config/env';

/**
 * Cola de errores para alertar por WhatsApp (la consume processErrorAlerts).
 * La llama logger.error con el mensaje y contexto REALES del error, así la IA
 * puede explicar exactamente qué pasó (a diferencia del correo de Google, que
 * solo dice en qué función fue).
 *
 * Deduplica por firma del mensaje: si el mismo error ocurre muchas veces, se
 * agrupa en un solo documento (con contador), evitando inundar la bandeja. NUNCA
 * lanza ni usa logger (evita bucles de alertas).
 */
const COL = 'errorAlerts';

function enabled(): boolean {
  return !!env.errorAlertPhone() && env.useYcloud() && !!env.openaiApiKey();
}

export function enqueueErrorAlert(message: string, context?: Record<string, unknown>): void {
  if (!enabled()) return;
  // Anti-bucle: no alertar sobre el propio subsistema de alertas/monitoreo.
  if (message.startsWith('[ErrorAlert') || message.startsWith('[MonitorAlert')) return;

  try {
    const sig = createHash('sha1').update(message.slice(0, 200)).digest('hex').slice(0, 32);
    let contextSample = '';
    try { contextSample = context ? JSON.stringify(context).slice(0, 1500) : ''; } catch { /* ignore */ }

    void db.collection(COL).doc(sig).set({
      message:       message.slice(0, 500),
      contextSample,
      count:         FieldValue.increment(1),
      lastAt:        Timestamp.now(),
      pending:       true,
      // TTL opcional (activar política sobre errorAlerts.expireAt si se desea).
      expireAt:      Timestamp.fromMillis(Date.now() + 3 * 24 * 60 * 60 * 1000),
    }, { merge: true }).catch(() => { /* best-effort, sin logger */ });
  } catch {
    /* nunca propagar */
  }
}
