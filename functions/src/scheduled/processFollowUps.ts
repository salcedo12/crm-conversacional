import { onSchedule }   from 'firebase-functions/v2/scheduler';
import { Timestamp }    from 'firebase-admin/firestore';
import { db }           from '../lib/admin';
import { logger }       from '../utils/logger';
import { followUpsRepository } from '../modules/followups/followups.repository';
import { leadsRepository }     from '../modules/leads/leads.repository';
import { messagesRepository }  from '../modules/messages/messages.repository';
import { getAiConfig }         from '../modules/ai/aiConfig.repository';
import { sendTextToLeadChannel } from '../modules/messages/outboundText.service';
import { templatesRepository } from '../modules/templates/templates.repository';
import { sendTemplateToLead }  from '../modules/messages/templateSender.service';
import type { Message }        from '../modules/messages/messages.types';
import { hasPendingAppointment } from '../modules/appointments/appointments.service';
import { personFirstName } from '../modules/ai/personName';
import { buildSameDayFollowUp } from '../modules/ai/followUpText';

const BOGOTA_OFFSET_MS = 5 * 3600_000; // Bogotá es UTC-5 todo el año
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 20;

/**
 * Los seguimientos solo salen entre 8:00 a. m. y 8:00 p. m. de Bogotá. Fuera de ese horario
 * devuelve la próxima 8:00 a. m. (hoy si es de madrugada, mañana si ya pasó de las 8 p. m.).
 */
export function nextAllowedFollowUpTime(nowMs: number): number | null {
  const local = new Date(nowMs - BOGOTA_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR) return null;
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), SEND_FROM_HOUR, 0, 0));
  if (hour >= SEND_UNTIL_HOUR) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() + BOGOTA_OFFSET_MS;
}

/** Variable {{1}} de la plantilla: el nombre si es de persona; si no, "Hola nuevamente, …". */
export function followUpGreetingName(name: string | undefined): string {
  return personFirstName(name) || 'nuevamente';
}

/**
 * Cada 5 minutos: procesa follow-ups vencidos.
 *
 * Por cada tarea pendiente cuyo scheduledAt <= ahora:
 * 1. Verifica que el lead no haya respondido desde que se agendó el follow-up.
 * 2. Verifica que la IA siga activa.
 * 3. Genera mensaje de seguimiento con OpenAI (contexto especial de follow-up).
 * 4. Envía por WhatsApp y guarda en Firestore.
 * 5. Marca la tarea como 'sent'.
 */
const MIN_FOLLOWUP_DELAY_MINUTES = 60;

export const processFollowUps = onSchedule(
  {
    schedule:       'every 5 minutes',
    region:         'us-central1',
    timeoutSeconds: 300,
    memory:         '512MiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    const now = Timestamp.now();

    // Obtener todas las compañías activas (por ahora con DEFAULT_COMPANY_ID)
    // En producción multi-empresa, iterar sobre companies/
    const companiesSnap = await db.collection('companies').listDocuments();

    let totalProcessed = 0;

    for (const companyDoc of companiesSnap) {
      const companyId = companyDoc.id;
      const tasks = await followUpsRepository.getDueTasks(companyId, now);

      if (tasks.length === 0) continue;

      logger.info('[FollowUps] Tareas vencidas', { companyId, count: tasks.length });

      for (const task of tasks) {
        try {
          await processFollowUpTask(companyId, task.leadId, task.id, task.aiMessageSentAt, task.stepIndex);
          totalProcessed++;
        } catch (err) {
          logger.error('[FollowUps] Error procesando tarea', {
            taskId: task.id,
            leadId: task.leadId,
            error:  err instanceof Error ? err.message : String(err),
          });
          // No re-lanzar: continuar con las otras tareas
        }
      }
    }

    logger.info('[FollowUps] Ciclo completado', { totalProcessed });
  }
);

async function processFollowUpTask(
  companyId:       string,
  leadId:          string,
  taskId:          string,
  aiMessageSentAt: Timestamp,
  stepIndex:       number
): Promise<void> {
  // 1. Cargar lead
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) {
    await followUpsRepository.markCancelled(companyId, taskId);
    return;
  }

  // 2. IA activa para este lead?
  if (!lead.aiEnabled) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] IA pausada — cancelando follow-up', { leadId, taskId });
    return;
  }

  // 3. ¿El lead respondió desde que se agendó? Se miran SOLO los mensajes del lead: antes se
  //    usaba lead.lastMessageAt, que también cambia con los mensajes de la IA (el seguimiento de
  //    las 3 h y las plantillas), y por eso se cancelaban las plantillas del día 1, 3 y 8.
  const aiSentAtMs = aiMessageSentAt.toMillis();
  const recentForReply = await messagesRepository.getRecent(companyId, leadId, 30);
  const leadReplied = recentForReply.some((m) =>
    m.direction === 'inbound' && m.senderType === 'lead' && (m.createdAt?.toMillis?.() ?? 0) > aiSentAtMs);
  if (leadReplied) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Lead respondió — cancelando follow-up', { leadId, taskId });
    return;
  }

  // 3b. Con una cita agendada no se envían seguimientos.
  if (await hasPendingAppointment(companyId, leadId)) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Lead con cita agendada — cancelando follow-up', { leadId, taskId });
    return;
  }

  // 3c. Fuera del horario permitido: se corre la tarea a las 8:00 a. m.
  const postponeTo = nextAllowedFollowUpTime(Date.now());
  if (postponeTo !== null) {
    await db.collection('companies').doc(companyId).collection('followUpTasks').doc(taskId)
      .update({ scheduledAt: Timestamp.fromMillis(postponeTo) });
    logger.info('[FollowUps] Fuera de horario — se envía a las 8:00 a. m.', { leadId, taskId, postponeTo: new Date(postponeTo).toISOString() });
    return;
  }

  // 4. Cargar config de IA
  const config = await getAiConfig(companyId);
  if (!config.enabled) {
    await followUpsRepository.markCancelled(companyId, taskId);
    return;
  }

  // 5. Cargar historial reciente
  const history: Message[] = await messagesRepository.getRecent(
    companyId, leadId, config.maxContextMessages
  );

  // 6. Calcular tiempo transcurrido para el contexto
  const minutesSinceLastAi = Math.round((Date.now() - aiSentAtMs) / 60_000);
  if (minutesSinceLastAi < MIN_FOLLOWUP_DELAY_MINUTES) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Cancelado por actividad demasiado reciente', {
      leadId,
      taskId,
      minutesSinceLastAi,
    });
    return;
  }

  const timeLabel = minutesSinceLastAi >= 60
    ? `${Math.round(minutesSinceLastAi / 60)} hora(s)`
    : `${minutesSinceLastAi} minuto(s)`;

  // 7. Verificar si este paso corresponde a una plantilla aprobada de Meta (Día 1, Día 3, Día 8)
  const stepConfig = config.followUpSequence?.[stepIndex];
  // Un paso configurado sin plantilla es un mensaje libre de la IA (solo dentro de la ventana de 24 h).
  const templateName = stepConfig ? (stepConfig.templateName?.trim() || undefined) : (
    stepIndex === 0 ? 'seguimiento_inicial_prospecto' :
    stepIndex === 1 ? 'opciones_proyectos_meraki' :
    stepIndex === 2 ? 'reactivacion_interes_meraki' : undefined
  );

  if (templateName) {
    const template = await templatesRepository.findByName(companyId, templateName);
    if (template) {
      const leadFirstName = followUpGreetingName(lead.name);
      try {
        const result = await sendTemplateToLead({
          companyId,
          lead,
          template,
          variables: { '1': leadFirstName },
          senderType: 'ai',
          fromInboxId: lead.inboxId || undefined,
        });

        await followUpsRepository.markSent(companyId, taskId);
        logger.info('[FollowUps] Plantilla oficial enviada con éxito', {
          leadId,
          taskId,
          stepIndex,
          templateName,
          messageId: result.messageId,
        });
        return;
      } catch (templateErr) {
        logger.error('[FollowUps] Error enviando plantilla oficial de seguimiento', {
          leadId,
          taskId,
          templateName,
          error: templateErr instanceof Error ? templateErr.message : String(templateErr),
        });
        // Si falló el envío de la plantilla oficial, cancelar la tarea para evitar bucles
        await followUpsRepository.markCancelled(companyId, taskId);
        return;
      }
    } else {
      logger.warn('[FollowUps] Plantilla configurada no encontrada en Firestore, procediendo con IA fallback', {
        companyId,
        templateName,
      });
    }
  }

  // 7b. Mensaje libre: WhatsApp solo lo permite dentro de las 24 h desde el último mensaje del lead.
  const lastInbound = [...history].reverse().find((m) => m.direction === 'inbound' && m.senderType === 'lead');
  if (!lastInbound || Date.now() - lastInbound.createdAt.toMillis() > 23 * 3600_000) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Fuera de la ventana de 24 h — no se envía el mensaje libre', { leadId, taskId });
    return;
  }

  // 7c. El mensaje del mismo día sale UNA sola vez por lead (antes, cada "gracias" del cliente
  //     reprogramaba otro y a una clienta le llegaron 3 en un día).
  if ((lead as { aiSameDayFollowUpAt?: Timestamp }).aiSameDayFollowUpAt) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Ya se envió el mensaje del mismo día a este lead — se omite', { leadId, taskId });
    return;
  }

  // 8. Texto fijo según lo último que se le envió (brochure, plano, cotización…).
  const aiReply = buildSameDayFollowUp(personFirstName(lead.name), history);
  void timeLabel;

  // 9. Enviar por el mismo canal/número por el que entró el lead.
  const now = Timestamp.now();
  let status: 'sent' | 'failed' = 'sent';
  let externalMsgId: string | undefined;
  let provider: string | undefined;
  let sendError: string | undefined;

  try {
    const result = await sendTextToLeadChannel(lead, aiReply);
    provider = result.provider;
    externalMsgId = result.externalMsgId;
  } catch (err) {
    status = 'failed';
    sendError = err instanceof Error ? err.message : String(err);
    logger.error('[FollowUps] Error enviando WhatsApp', { leadId, provider, error: sendError });
  }

  await messagesRepository.create({
    companyId,
    leadId,
    direction:        'outbound',
    senderType:       'ai',
    content:          aiReply,
    channel:          'whatsapp',
    status,
    twilioMessageSid: externalMsgId,
    createdAt:        now,
    metadata: {
      provider: provider ?? lead.inboxProvider ?? 'auto',
      ...(sendError ? { sendError } : {}),
    },
  });

  await leadsRepository.update(companyId, leadId, {
    lastMessageText: aiReply,
    lastMessageAt:   now,
    ...(status === 'sent' ? { aiSameDayFollowUpAt: now } : {}),
  });

  // 10. Marcar tarea como enviada solo si realmente saliÃ³ por WhatsApp.
  if (status === 'sent') {
    await followUpsRepository.markSent(companyId, taskId);
  } else {
    await followUpsRepository.markCancelled(companyId, taskId);
  }

  logger.info('[FollowUps] Follow-up procesado', { leadId, taskId, stepIndex, status });
}
