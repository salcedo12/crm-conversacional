import { Timestamp } from 'firebase-admin/firestore';
import { getOpenAIClient } from '../../integrations/openai/openai.client';
import { env }             from '../../config/env';
import { leadsRepository } from '../leads/leads.repository';
import type { Lead } from '../leads/leads.types';
import { messagesRepository } from '../messages/messages.repository';
import { sendTextToLeadChannel } from '../messages/outboundText.service';
import type { SendTextResult } from '../messages/outboundText.service';
import { followUpsRepository } from '../followups/followups.repository';
import { getAiConfig } from './aiConfig.repository';
import { buildOpenAiMessages, detectsTransferKeyword } from './aiContext.service';
import { bookAppointment, rescheduleAppointment, cancelActiveAppointment } from '../appointments/appointments.service';
import { buildConfirmation, buildReschedule, buildCancellation } from '../appointments/appointmentMessages';
import { AvailabilityError, formatSuggestions } from '../appointments/availability.service';
import { logger } from '../../utils/logger';
import type OpenAI from 'openai';
import type { Message } from '../messages/messages.types';
import type { AiConfig } from './ai.types';

export interface OrchestratorInput {
  companyId:   string;
  leadId:      string;
  messageId:   string;
  userMessage: string;
  mediaUrl?:   string;
  mediaType?:  string;
}

/**
 * Ventana de agrupación de ráfagas: si el lead escribe varios mensajes seguidos,
 * cada uno espera este tiempo; solo el ÚLTIMO responde (con toda la ráfaga en el
 * contexto), evitando respuestas múltiples y pisadas.
 */
const DEBOUNCE_MS = 6000;

/**
 * Guarda de costo / anti-loop: máximo de respuestas automáticas de la IA a un
 * mismo lead dentro de una ventana de 1 hora. Si se supera (spam o bucle entre
 * bots), se pausa la IA del lead para cortar el gasto y que un asesor lo revise.
 */
const AI_HOURLY_CAP = 25;
const AI_WINDOW_MS  = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Orquestador principal de respuestas de IA.
 *
 * Flujo:
 * 1. Verifica que la IA sigue activa para el lead.
 * 2. Carga configuración de IA desde Firestore.
 * 3. Carga historial de mensajes (limitado a maxContextMessages).
 * 4. Detecta si el usuario pide transferir a humano.
 * 5. Genera respuesta con OpenAI.
 * 6. Guarda mensaje de IA en Firestore.
 * 7. Envía por el canal del lead (WhatsApp/YCloud, Messenger o Instagram).
 * 8. Actualiza lead.lastMessageText.
 */
export async function orchestrateAiResponse(
  input: OrchestratorInput
): Promise<void> {
  let { companyId, leadId, messageId, userMessage, mediaUrl, mediaType } = input;

  // 1. Verificar que la IA sigue activa (puede haber cambiado desde que llegó el mensaje)
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) {
    logger.warn('[AI] Lead no encontrado', { companyId, leadId });
    return;
  }
  if (!lead.aiEnabled) {
    logger.info('[AI] IA pausada para este lead — no se genera respuesta', { leadId });
    return;
  }

  // 1b. Verificación a nivel de empresa: hay que tener configurado al menos un
  //     canal de envío (YCloud para WhatsApp, o Meta para Messenger/Instagram).
  //     No es un check por lead — solo evita intentar responder si la empresa
  //     no tiene ningún proveedor de mensajería configurado.
  if (!env.useYcloud() && !env.metaConfigured()) {
    logger.warn('[AI] Ningún canal de mensajería configurado — se omite respuesta IA', { leadId });
    return;
  }

  // 2. Cargar config de IA
  const config = await getAiConfig(companyId);
  if (!config.enabled) {
    logger.info('[AI] IA deshabilitada para la empresa', { companyId });
    return;
  }

  // 2b. Debounce: agrupar ráfagas. Esperamos y, si ya llegó un mensaje más
  //     nuevo del lead, dejamos que ESE responda toda la ráfaga (incluye este
  //     mensaje en su historial). Así no contestamos 3 veces a 3 globos seguidos.
  await sleep(DEBOUNCE_MS);
  const latest = await messagesRepository.getLatest(companyId, leadId);
  if (latest && latest.id !== messageId && latest.direction === 'inbound' && latest.senderType === 'lead') {
    logger.info('[AI] Mensaje más nuevo durante el debounce — lo maneja ese', { leadId, messageId, latestId: latest.id });
    return;
  }

  // Revalidar que la IA no fue pausada durante la espera (asesor tomó el control).
  const freshLead = await leadsRepository.findById(companyId, leadId);
  if (!freshLead?.aiEnabled) {
    logger.info('[AI] IA pausada durante el debounce — no se responde', { leadId });
    return;
  }

  // 2b-bis. Guarda de costo / anti-loop: si la IA ya respondió demasiado en la
  //         última hora a este lead, se pausa y no se responde (spam o bucle).
  const nowMs        = Date.now();
  const windowActive = nowMs - (freshLead.aiHourlyWindowStart?.toMillis?.() ?? 0) < AI_WINDOW_MS;
  const priorCount   = windowActive ? (freshLead.aiHourlyCount ?? 0) : 0;
  if (priorCount >= AI_HOURLY_CAP) {
    logger.warn('[AI] Tope horario de respuestas alcanzado — se pausa la IA (posible loop/spam)', {
      leadId, count: priorCount,
    });
    await leadsRepository.update(companyId, leadId, { aiEnabled: false });
    return;
  }

  // 2c. Procesar media (tras el debounce, para no gastar en mensajes descartados)
  if (mediaUrl && mediaType) {
    if (mediaType.startsWith('audio/')) {
      // Transcribir audio con Whisper
      try {
        logger.info('[AI] Transcribiendo audio con Whisper', { leadId });
        userMessage = await transcribeAudio(mediaUrl, mediaType);
        logger.info('[AI] Transcripción lista', { leadId, length: userMessage.length });
      } catch (err) {
        logger.error('[AI] Error transcribiendo audio', { error: String(err) });
        userMessage = '[El lead envió un audio que no se pudo transcribir]';
      }
      mediaUrl  = undefined; // ya está en texto, no enviar como imagen
      mediaType = undefined;
    } else if (!mediaType.startsWith('image/')) {
      // Documentos, video, stickers: la IA no puede abrirlos → darle contexto en texto.
      const kind =
        mediaType.startsWith('video/')                                  ? 'un video' :
        /(pdf|word|document|sheet|excel|presentation)/i.test(mediaType) ? 'un documento' :
        mediaType.includes('sticker')                                   ? 'un sticker' :
                                                                          'un archivo';
      if (!userMessage.trim()) {
        userMessage =
          `[El lead envió ${kind} que no puedo abrir. Reconócelo con naturalidad ` +
          `y pregúntale en qué puedes ayudarle o pídele que te lo cuente por texto.]`;
      }
      mediaUrl  = undefined;
      mediaType = undefined;
    }
    // Imágenes: se pasan a buildOpenAiMessages para usar vision.
  }

  // 3. Detectar keyword de transferencia a humano
  if (detectsTransferKeyword(userMessage, config.transferKeywords)) {
    logger.info('[AI] Keyword de transferencia detectado', { leadId, userMessage });
    const transferMsg = '¡Claro! Te voy a conectar con uno de nuestros asesores. Por favor espera un momento. 🙏';
    await saveAndSendAiResponse(companyId, leadId, lead, transferMsg);
    // Pausar IA automáticamente
    await leadsRepository.update(companyId, leadId, { aiEnabled: false });
    return;
  }

  // 4. Cargar historial reciente
  const history: Message[] = await messagesRepository.getRecent(
    companyId,
    leadId,
    config.maxContextMessages
  );

  // 5. Construir mensajes para OpenAI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = buildOpenAiMessages(config, history, userMessage, mediaUrl, mediaType) as any[];

  // Inyectar fecha/hora actual para que la IA calcule correctamente fechas relativas
  const tz  = env.calendarTimeZone();
  const nowStr = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full', timeStyle: 'short', timeZone: tz,
  }).format(new Date());
  messages.push({
    role: 'system',
    content: `Contexto temporal: hoy es ${nowStr} (zona horaria ${tz}). ` +
      `Usa siempre fechas en formato ISO 8601 con offset -05:00. ` +
      `Cuando el lead confirme una fecha y hora concretas para una cita/reunión, usa agendar_cita. ` +
      `Si el lead pide cambiar, mover o reprogramar su cita a otra fecha/hora, usa reagendar_cita. ` +
      `Si el lead pide cancelar o anular su cita, usa cancelar_cita.`,
  });

  // 6. Llamar a OpenAI con herramienta de agendamiento
  let aiReply: string;
  let appointmentScheduled = false; // true si en este turno se agendó/reagendó una cita
  try {
    logger.info('[AI] Llamando a OpenAI', { leadId, historyLength: history.length, hasMedia: !!mediaUrl });

    const completion = await getOpenAIClient().chat.completions.create({
      model:       'gpt-4o-mini',
      messages,
      max_tokens:  350,
      temperature: 0.7,
      tools:       APPOINTMENT_TOOLS,
      tool_choice: 'auto',
    });

    const choice = completion.choices[0]?.message;
    const toolCalls = choice?.tool_calls ?? [];

    if (toolCalls.length > 0) {
      // La IA decidió agendar — ejecutar la(s) herramienta(s)
      messages.push(choice);
      let bookingMessage: string | null = null;
      for (const call of toolCalls) {
        const result = await runAppointmentTool(companyId, leadId, call, config.businessName);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        const conf = (result as { confirmationMessage?: string }).confirmationMessage;
        if (conf) bookingMessage = conf;
        if ((result as { scheduled?: boolean }).scheduled) appointmentScheduled = true;
      }
      if (bookingMessage) {
        // Cita agendada con éxito → usar el mensaje lindo y consistente (no el del LLM)
        aiReply = bookingMessage;
      } else {
        // Errores / horario ocupado → dejar que el LLM redacte (propone alternativas)
        const followUp = await getOpenAIClient().chat.completions.create({
          model: 'gpt-4o-mini', messages, max_tokens: 350, temperature: 0.7,
        });
        aiReply = followUp.choices[0]?.message?.content?.trim() ?? config.fallbackMessage;
      }
    } else {
      aiReply = choice?.content?.trim() ?? config.fallbackMessage;
    }

    logger.info('[AI] Respuesta generada', {
      leadId, replyLength: aiReply.length, toolCalls: toolCalls.length,
      promptTokens: completion.usage?.prompt_tokens,
    });
  } catch (err) {
    logger.error('[AI] Error llamando a OpenAI', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    aiReply = config.fallbackMessage;
  }

  // 7. Guardar respuesta IA + enviar por el canal del lead
  const aiSentAt = await saveAndSendAiResponse(companyId, leadId, lead, aiReply);

  // 7b. Actualizar el contador de la guarda de costo (ventana horaria).
  await leadsRepository.update(companyId, leadId, {
    aiHourlyCount:       priorCount + 1,
    aiHourlyWindowStart: windowActive
      ? (freshLead.aiHourlyWindowStart ?? Timestamp.fromMillis(nowMs))
      : Timestamp.fromMillis(nowMs),
  });

  // 8. Marcar mensaje original como procesado (idempotencia)
  await messagesRepository.markAiProcessed(companyId, leadId, messageId);

  // 9. Follow-ups. Si en este turno se agendó/reagendó una cita, es un cierre
  //    positivo: cancelamos los follow-ups pendientes y NO programamos más
  //    (evita el "¿necesitas algo más?" redundante tras confirmar la cita).
  //    Los recordatorios de la cita los maneja processReminders por aparte.
  if (appointmentScheduled) {
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    logger.info('[AI] Cita agendada — follow-ups cancelados', { leadId });
  } else {
    await scheduleFollowUps(companyId, leadId, aiSentAt, config);
  }
}

// ─── Herramienta de agendamiento para la IA ─────────────────────────────────────

const APPOINTMENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agendar_cita',
      description:
        'Agenda una cita o reunión NUEVA con el lead. Úsala SOLO cuando el lead ya confirmó una fecha y hora concretas. ' +
        'Crea automáticamente un evento de Google Calendar con enlace de Google Meet.',
      parameters: {
        type: 'object',
        properties: {
          fecha_hora_iso: {
            type: 'string',
            description: 'Fecha y hora de inicio en ISO 8601 con offset de Colombia, ej: 2026-06-20T15:00:00-05:00',
          },
          duracion_minutos: { type: 'number', description: 'Duración en minutos (default 30).' },
        },
        required: ['fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reagendar_cita',
      description:
        'Reagenda (mueve/cambia) la cita existente del lead a una nueva fecha y hora. ' +
        'Úsala cuando el lead pida cambiar, mover o reprogramar su cita. ' +
        'Cancela la cita anterior (y su evento de Google) y crea una nueva en el nuevo horario.',
      parameters: {
        type: 'object',
        properties: {
          nueva_fecha_hora_iso: {
            type: 'string',
            description: 'Nueva fecha y hora de inicio en ISO 8601 con offset de Colombia, ej: 2026-06-21T10:00:00-05:00',
          },
          duracion_minutos: { type: 'number', description: 'Duración en minutos (si no se da, se conserva la de la cita anterior).' },
        },
        required: ['nueva_fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_cita',
      description:
        'Cancela la cita existente del lead. Úsala cuando el lead pida cancelar, anular o eliminar su cita. ' +
        'Borra el evento del Google Calendar del asesor.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full', timeStyle: 'short', timeZone: env.calendarTimeZone(),
  }).format(d);

/** Ejecuta una tool_call de agenda (agendar/reagendar/cancelar) para la IA. */
async function runAppointmentTool(
  companyId:    string,
  leadId:       string,
  call:         OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  businessName: string
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };
  const name = call.function.name;

  try {
    const args = JSON.parse(call.function.arguments || '{}') as {
      fecha_hora_iso?: string; nueva_fecha_hora_iso?: string; duracion_minutos?: number;
    };

    // ── Agendar nueva ────────────────────────────────────────────────────────
    if (name === 'agendar_cita') {
      if (!args.fecha_hora_iso) return { ok: false, error: 'falta fecha_hora_iso' };
      const start = new Date(args.fecha_hora_iso);
      if (isNaN(start.getTime())) return { ok: false, error: 'fecha inválida' };

      const appt = await bookAppointment({
        companyId, leadId, startTime: start,
        durationMinutes: args.duracion_minutos, source: 'ai',
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appt.googleMeetLink ?? null,
        confirmationMessage: buildConfirmation(businessName, appt.leadName, start),
        mensaje: 'Cita agendada correctamente.',
      };
    }

    // ── Reagendar (mover) ──────────────────────────────────────────────────────
    if (name === 'reagendar_cita') {
      if (!args.nueva_fecha_hora_iso) return { ok: false, error: 'falta nueva_fecha_hora_iso' };
      const start = new Date(args.nueva_fecha_hora_iso);
      if (isNaN(start.getTime())) return { ok: false, error: 'fecha inválida' };

      const { appointment, hadPrevious } = await rescheduleAppointment({
        companyId, leadId, startTime: start, durationMinutes: args.duracion_minutos,
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appointment.googleMeetLink ?? null,
        confirmationMessage: hadPrevious
          ? buildReschedule(businessName, appointment.leadName, start)
          : buildConfirmation(businessName, appointment.leadName, start),
        mensaje: hadPrevious ? 'Cita reprogramada correctamente.' : 'No tenía cita previa; se agendó una nueva.',
      };
    }

    // ── Cancelar ───────────────────────────────────────────────────────────────
    if (name === 'cancelar_cita') {
      const cancelled = await cancelActiveAppointment(companyId, leadId);
      if (!cancelled) {
        return {
          ok: false,
          reason: 'sin_cita',
          mensaje: 'El lead no tiene una cita activa para cancelar. Pregúntale en qué más puedes ayudarle.',
        };
      }
      return {
        ok: true,
        confirmationMessage: buildCancellation(businessName, cancelled.leadName),
        mensaje: 'Cita cancelada correctamente.',
      };
    }

    return { ok: false, error: 'herramienta desconocida' };
  } catch (err) {
    if (err instanceof AvailabilityError) {
      return {
        ok: false,
        error: err.message,
        reason: 'horario_ocupado',
        sugerencias: err.suggestions.map((date) => date.toISOString()),
        mensaje:
          err.suggestions.length > 0
            ? `Ese horario no está disponible (puede ser en el pasado, demasiado pronto, estar ocupado o fuera del horario de atención). Propón estas opciones cercanas: ${formatSuggestions(err.suggestions)}.`
            : 'Ese horario no está disponible. Pide al lead otra fecha u hora más adelante.',
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Guarda y envía la respuesta IA. Retorna el Timestamp del mensaje guardado. */
async function saveAndSendAiResponse(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId'>,
  content:   string
): Promise<Timestamp> {
  const now = Timestamp.now();
  let status: 'sent' | 'failed' = 'sent';
  let externalMsgId: string | undefined;
  let provider: SendTextResult['provider'] | undefined;
  let sendError: string | undefined;

  try {
    const result = await sendTextToLeadChannel(lead, content);
    provider = result.provider;
    externalMsgId = result.externalMsgId;
  } catch (err) {
    status = 'failed';
    sendError = err instanceof Error ? err.message : String(err);
    logger.error('[AI] Error enviando respuesta', {
      leadId,
      via:   lead.channel ?? 'whatsapp',
      error: sendError,
    });
  }

  await messagesRepository.create({
    companyId,
    leadId,
    direction:        'outbound',
    senderType:       'ai',
    content,
    channel:          lead.channel ?? 'whatsapp',
    status,
    twilioMessageSid: externalMsgId,
    createdAt:        now,
    metadata: {
      provider: provider ?? lead.inboxProvider ?? 'auto',
      ...(sendError ? { sendError } : {}),
    },
  });

  await leadsRepository.update(companyId, leadId, {
    lastMessageText: content,
    lastMessageAt:   now,
  });

  return now;
}

/** Descarga y transcribe un audio con OpenAI Whisper. */
async function transcribeAudio(audioUrl: string, mimeType: string): Promise<string> {
  // Node 22 tiene fetch nativo con manejo de redirects
  const resp = await fetch(audioUrl, { headers: { 'X-API-Key': env.ycloudApiKey() } });
  if (!resp.ok) throw new Error(`Audio download failed: ${resp.status}`);

  const arrayBuffer = await resp.arrayBuffer();
  const buffer      = Buffer.from(arrayBuffer);

  // Determinar extensión para que Whisper identifique el formato
  const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg';
  const file = new File([buffer], `audio.${ext}`, { type: mimeType });

  const result = await getOpenAIClient().audio.transcriptions.create({
    file,
    model:    'whisper-1',
    language: 'es',
  });

  return result.text.trim();
}

/** Crea las tareas de follow-up en Firestore para los pasos habilitados. */
async function scheduleFollowUps(
  companyId:     string,
  leadId:        string,
  aiMessageSentAt: Timestamp,
  config:        AiConfig
): Promise<void> {
  const steps = config.followUpSequence?.filter((s) => s.enabled) ?? [];
  if (steps.length === 0) return;

  // Primero cancela cualquier follow-up pendiente previo de este lead
  await followUpsRepository.cancelPendingForLead(companyId, leadId);

  const now = aiMessageSentAt.toMillis();
  const tasks = steps.map((step, index) => ({
    companyId,
    leadId,
    stepIndex:       index,
    scheduledAt:     Timestamp.fromMillis(now + step.delayMinutes * 60_000),
    aiMessageSentAt,
    status:          'pending' as const,
    createdAt:       Timestamp.now(),
  }));

  await followUpsRepository.createBatch(tasks);
  logger.info('[AI] Follow-ups agendados', { leadId, count: tasks.length });
}
