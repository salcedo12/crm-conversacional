import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { notifyAdvisorLeadReminder } from '../modules/reminders/advisorReminderNotifier.service';

/**
 * Notifica los recordatorios manuales de seguimiento que han llegado a su fecha/hora:
 * Cada 5 minutos busca notas de tipo 'reminder' con dueAt <= ahora y notified == false,
 * y envía una notificación multicanal al asesor asignado:
 *   1. Push móvil y web en el navegador/app
 *   2. Mensaje de WhatsApp a su celular conectado (Plantilla YCloud o puente QR)
 *   3. Correo electrónico con los datos del lead y botón 1-tap para abrir la conversación
 * Marca notified = true para no repetir.
 */
export const processLeadReminders = onSchedule(
  {
    schedule:       'every 5 minutes',
    timeZone:       'America/Bogota',
    region:         'us-central1',
    timeoutSeconds: 120,
    memory:         '512MiB',
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
        companyId?: string;
        leadId?: string;
        text?: string;
        done?: boolean;
        dueAt?: Timestamp;
        assignedTo?: string;
        authorId?: string;
        leadName?: string;
        leadPhone?: string;
        project?: string;
        nextAction?: string;
        notes?: string;
      };

      // Marcado como hecho antes de vencer → no notificar.
      if (data.done) {
        await doc.ref.update({ notified: true }).catch(() => {});
        continue;
      }
      if (!data.companyId || !data.leadId) continue;

      try {
        const lead = await leadsRepository.findById(data.companyId, data.leadId);
        const targetAdvisorId = data.assignedTo || lead?.assignedTo || data.authorId;

        if (targetAdvisorId) {
          const dueAtDate = data.dueAt?.toDate() ?? new Date();
          const leadName = data.leadName || lead?.name || 'Cliente Prospecto';
          const leadPhone = data.leadPhone || lead?.phone || '';
          const project = data.project || (lead?.projectInterest && lead.projectInterest[0]) || 'Proyecto Meraki';
          const nextAction = data.nextAction || data.text || 'Llamada de seguimiento';
          const notesText = data.notes || '';

          const noticeRes = await notifyAdvisorLeadReminder({
            companyId: data.companyId,
            advisorId: targetAdvisorId,
            leadId: data.leadId,
            leadName,
            leadPhone,
            project,
            nextAction,
            notes: notesText,
            dueAt: dueAtDate,
          });

          await doc.ref.update({
            notified: true,
            notifiedAt: Timestamp.now(),
            notificationStatus: {
              push: noticeRes.pushSent,
              whatsapp: noticeRes.whatsappSent,
              email: noticeRes.emailSent,
            },
          });
          notificados++;
        } else {
          await doc.ref.update({ notified: true, noAdvisor: true });
        }
      } catch (err) {
        logger.error('[LeadReminders] Error notificando recordatorio', {
          noteId: doc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (notificados > 0) {
      logger.info('[LeadReminders] Recordatorios de seguimiento procesados', {
        encontrados: snap.size,
        notificados,
      });
    }
  }
);
