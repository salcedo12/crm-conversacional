import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';

/**
 * Notifica los recordatorios manuales vencidos: cada 15 min busca notas de tipo
 * 'reminder' con dueAt <= ahora y notified == false, y le manda un push al asesor
 * asignado del lead. Marca notified = true para no repetir.
 */
export const processLeadReminders = onSchedule(
  {
    schedule:       'every 15 minutes',
    region:         'us-central1',
    timeoutSeconds: 120,
    memory:         '256MiB',
  },
  async () => {
    const now = Timestamp.now();
    const snap = await db.collectionGroup('notes')
      .where('kind', '==', 'reminder')
      .where('notified', '==', false)
      .where('dueAt', '<=', now)
      .limit(100)
      .get();

    if (snap.empty) return;

    let notificados = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as {
        companyId?: string; leadId?: string; text?: string; done?: boolean;
      };

      // Marcado como hecho antes de vencer → no notificar.
      if (data.done) { await doc.ref.update({ notified: true }).catch(() => {}); continue; }
      if (!data.companyId || !data.leadId) continue;

      try {
        const lead = await leadsRepository.findById(data.companyId, data.leadId);
        if (lead) {
          const who = lead.name?.trim() || lead.phone || 'un lead';
          await sendAdvisorPush(data.companyId, lead.assignedTo, {
            title:  `⏰ Recordatorio: ${who}`,
            body:   data.text ?? 'Tienes un seguimiento pendiente.',
            url:    `/dashboard/inbox?lead=${data.leadId}`,
            type:   'reminder',
            leadId: data.leadId,
          });
          notificados++;
        }
        await doc.ref.update({ notified: true });
      } catch (err) {
        logger.error('[LeadReminders] Error notificando recordatorio', {
          noteId: doc.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[LeadReminders] Recordatorios procesados', { encontrados: snap.size, notificados });
  }
);
