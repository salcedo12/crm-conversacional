import { onSchedule }   from 'firebase-functions/v2/scheduler';
import { Timestamp }    from 'firebase-admin/firestore';
import { db }           from '../lib/admin';
import { logger }       from '../utils/logger';
import { followUpsRepository } from '../modules/followups/followups.repository';
import { leadsRepository }     from '../modules/leads/leads.repository';
import { messagesRepository }  from '../modules/messages/messages.repository';
import { getAiConfig }         from '../modules/ai/aiConfig.repository';
import { getOpenAIClient }     from '../integrations/openai/openai.client';
import { buildOpenAiMessages } from '../modules/ai/aiContext.service';
import { sendTextToLeadChannel } from '../modules/messages/outboundText.service';
import type { Message }        from '../modules/messages/messages.types';

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

  // 3. ¿El lead respondió desde que se agendó?
  //    Si lastMessageAt del lead es POSTERIOR a aiMessageSentAt → respondió → cancelar
  const leadLastMessageAt = lead.lastMessageAt?.toMillis() ?? 0;
  const aiSentAtMs        = aiMessageSentAt.toMillis();
  if (leadLastMessageAt > aiSentAtMs) {
    await followUpsRepository.markCancelled(companyId, taskId);
    logger.info('[FollowUps] Lead respondió — cancelando follow-up', { leadId, taskId });
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
  const timeLabel = minutesSinceLastAi >= 60
    ? `${Math.round(minutesSinceLastAi / 60)} hora(s)`
    : `${minutesSinceLastAi} minuto(s)`;

  // 7. Construir prompt con instrucción de seguimiento
  const followUpInstruction = `Han pasado ${timeLabel} desde tu último mensaje y el lead no ha respondido. ` +
    `Este es el seguimiento #${stepIndex + 1}. ` +
    `Genera un mensaje de seguimiento breve, amistoso y no invasivo para retomar la conversación. ` +
    `No repitas lo que ya dijiste. Sé creativo y natural.`;

  const messages = buildOpenAiMessages(config, history, followUpInstruction);

  // 8. Llamar a OpenAI
  let aiReply: string;
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model:       'gpt-4o-mini',
      messages,
      max_tokens:  200,
      temperature: 0.8,
    });
    aiReply = completion.choices[0]?.message?.content?.trim() ?? config.fallbackMessage;
  } catch (err) {
    logger.error('[FollowUps] Error OpenAI', { leadId, error: String(err) });
    return; // no marcar como sent — se reintentará en el próximo ciclo
  }

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
  });

  // 10. Marcar tarea como enviada solo si realmente saliÃ³ por WhatsApp.
  if (status === 'sent') {
    await followUpsRepository.markSent(companyId, taskId);
  } else {
    await followUpsRepository.markCancelled(companyId, taskId);
  }

  logger.info('[FollowUps] Follow-up procesado', { leadId, taskId, stepIndex, status });
}
