import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { errorAlertsEnabled, interpretError, sendErrorWhatsApp } from '../modules/monitoring/errorAlertSender';

/**
 * Cada 5 min: envía por WhatsApp (explicadas por IA, en español) las alertas de
 * error encoladas por logger.error. Diseñado para NO inundar:
 *  - Deduplicado por tipo de error (la cola ya agrupa por firma).
 *  - Cooldown de 1h por tipo: el mismo error no se reenvía antes de 1 hora.
 *  - Tope de 8 alertas por corrida: si hay muchos errores distintos, se reparten.
 *
 * NO usa logger.error (usa console) para no re-encolar y crear un bucle.
 */
const COOLDOWN_MS = 60 * 60 * 1000;
const MAX_PER_RUN = 8;

export const processErrorAlerts = onSchedule(
  {
    schedule:       'every 5 minutes',
    region:         'us-central1',
    timeoutSeconds: 120,
    memory:         '256MiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    if (!errorAlertsEnabled()) return;

    const snap = await db.collection('errorAlerts').where('pending', '==', true).limit(30).get();
    if (snap.empty) return;

    let sent = 0;
    for (const doc of snap.docs) {
      if (sent >= MAX_PER_RUN) break;
      const d = doc.data();
      const sentAt = (d.sentAt as Timestamp | undefined)?.toMillis?.() ?? 0;

      // Dentro del cooldown → no reenviar; se limpia el flag y sigue contando.
      if (Date.now() - sentAt < COOLDOWN_MS) {
        await doc.ref.update({ pending: false }).catch(() => { /* noop */ });
        continue;
      }

      const count = (d.count as number) ?? 1;
      const info =
        `Mensaje del error: ${d.message ?? ''}\n` +
        `Contexto: ${d.contextSample ?? ''}\n` +
        `Ocurrió ${count} vez(veces) desde el último aviso.`;

      try {
        const explanation = await interpretError(info);
        await sendErrorWhatsApp(explanation);
        await doc.ref.update({ pending: false, sentAt: Timestamp.now(), count: 0 });
        sent++;
      } catch (err) {
        // console (NO logger.error) para no crear un bucle de alertas.
        console.warn('[MonitorAlert] No se pudo enviar la alerta de error', err instanceof Error ? err.message : String(err));
        await doc.ref.update({ pending: false }).catch(() => { /* noop */ });
      }
    }

    if (sent > 0) console.log(`[MonitorAlert] ${sent} alerta(s) de error enviada(s) por WhatsApp.`);
  }
);
