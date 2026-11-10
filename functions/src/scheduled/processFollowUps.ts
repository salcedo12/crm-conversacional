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
import { templatesRepository } from '../modules/templates/templates.repository';
import { sendTemplateToLead }  from '../modules/messages/templateSender.service';
import type { Message }        from '../modules/messages/messages.types';
import { hasPendingAppointment } from '../modules/appointments/appointments.service';

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

  // 3. ¿El lead respondió desde que se agendó?
  //    Si lastMessageAt del lead es POSTERIOR a aiMessageSentAt → respondió → cancelar
  const leadLastMessageAt = lead.lastMessageAt?.toMillis() ?? 0;
  const aiSentAtMs        = aiMessageSentAt.toMillis();
  if (leadLastMessageAt > aiSentAtMs) {
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
  const templateName = stepConfig?.templateName || (
    stepIndex === 0 ? 'seguimiento_inicial_prospecto' :
    stepIndex === 1 ? 'opciones_proyectos_meraki' :
    stepIndex === 2 ? 'reactivacion_interes_meraki' : undefined
  );

  if (templateName) {
    const template = await templatesRepository.findByName(companyId, templateName);
    if (template) {
      const leadFirstName = lead.name?.trim().split(/\s+/)[0] || 'amigo(a)';
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

  // 8. Construir prompt con instrucción de seguimiento personalizada (fallback IA)
  const lastOutbound = [...history].reverse().find((m) => m.direction === 'outbound' && m.senderType === 'ai');
  const lastMetadata = (lastOutbound?.metadata ?? {}) as Record<string, any>;
  const leadFirstName = lead.name?.trim().split(/\s+/)[0] || '';

  let specificContext = '';
  if (lastMetadata.origin === 'ai_cotizacion' || lastMetadata.terreno) {
    const terreno = lastMetadata.terreno ? `terreno ${lastMetadata.terreno}` : 'terreno cotizado';
    const sector = lastMetadata.sector ? ` del sector ${lastMetadata.sector}` : '';
    specificContext = `En tu mensaje anterior enviaste una cotización del ${terreno}${sector}. ` +
      `Pregunta con calidez y naturalidad si pudo ver la cotización de ese terreno, si le quedó alguna duda con las opciones de pago o si le gustaría revisar otro sector o disponibilidad. Ejemplo de tono: "Hola${leadFirstName ? ` ${leadFirstName}` : ''}, ¿pudiste ver la cotización del ${terreno}${sector}? Cuéntame si te quedó alguna duda con las opciones de pago o si te gustaría que revisemos otro sector 😊". `;
  } else if (lastMetadata.origin === 'ai_portafolio' || lastMetadata.project) {
    const clubName = lastMetadata.project || 'el club de campo';
    specificContext = `En tu mensaje anterior enviaste el portafolio/brochure de ${clubName}. ` +
      `Pregunta amablemente si tuvo la oportunidad de revisar el material y las amenidades, o si le gustaría conocer la disponibilidad de terrenos. `;
  } else if (lastMetadata.origin === 'ai_plano') {
    specificContext = `En tu mensaje anterior compartiste el plano de disponibilidad. ` +
      `Pregunta con amabilidad si pudo ver los terrenos disponibles o si hay alguna ubicación que le llame la atención. `;
  }

  const followUpInstruction = `Han pasado ${timeLabel} desde tu último mensaje y el lead no ha respondido. ` +
    `Este es el seguimiento #${stepIndex + 1}. ` +
    specificContext +
    `Genera un mensaje de seguimiento breve, amistoso, empático y no invasivo para retomar la conversación. ` +
    `Dirígete por su nombre si lo tienes registrado ("${leadFirstName}"). ` +
    `No uses la palabra "financiación" ni "proyecto" (usa "forma de pago" o "club de campo"). ` +
    `No repitas exactamente lo que ya dijiste. Sé creativo y natural.`;

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
