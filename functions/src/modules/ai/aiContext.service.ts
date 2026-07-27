import type OpenAI from 'openai';
import type { AiConfig } from './ai.types';
import type { Message } from '../messages/messages.types';

/** Guía de estilo por tono, inyectada al prompt para que el selector de la UI tenga efecto real. */
const TONE_GUIDANCE: Record<AiConfig['tone'], string> = {
  professional: 'Profesional pero cercano: formal, claro y confiable. Ideal para ventas.',
  friendly:     'Amigable y cálido: cercano, conversacional y con calidez humana.',
  formal:       'Formal y corporativo: trato de "usted", lenguaje pulido y respetuoso.',
  casual:       'Casual y relajado: natural y espontáneo, como con un amigo, sin perder el respeto.',
};

/**
 * Directivas derivadas de la configuración (nombre, negocio, tono, temas bloqueados).
 * Se anexan DESPUÉS del prompt base para que los ajustes de la UI tengan efecto sin
 * romper el prompt detallado del asistente.
 */
function buildAssistantDirectives(config: AiConfig): string {
  const lines: string[] = ['## AJUSTES DEL ASISTENTE'];
  lines.push(`- Te llamas ${config.assistantName} y representas a ${config.businessName}. Preséntate con ese nombre.`);
  lines.push(`- Estilo de comunicación: ${TONE_GUIDANCE[config.tone] ?? TONE_GUIDANCE.professional}`);

  const blocked = config.blockedTopics.map((topic) => topic.trim()).filter(Boolean);
  if (blocked.length) {
    lines.push(
      `- No converses sobre estos temas: ${blocked.join(', ')}. ` +
      'Si el lead insiste, declina con amabilidad y reencauza hacia cómo puedes ayudarle.'
    );
  }
  return lines.join('\n');
}

/**
 * Construye el array de mensajes para la API de OpenAI
 * a partir del historial reciente de la conversación.
 */
export function buildOpenAiMessages(
  config:         AiConfig,
  history:        Message[],
  newUserMessage: string,
  mediaUrl?:      string,
  mediaType?:     string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const knowledge = config.knowledgeBase?.trim()
    ? `## BASE DE CONOCIMIENTO ADICIONAL\n${config.knowledgeBase.trim()}`
    : '';
  const systemPrompt = [config.basePrompt, buildAssistantDirectives(config), knowledge]
    .filter(Boolean)
    .join('\n\n');

  // Historial: mensajes previos como texto (imágenes anteriores se muestran como [Imagen])
  const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] = history.map((msg) => ({
    role:    msg.senderType === 'lead' ? 'user' : 'assistant',
    content: msg.content || (msg.mediaType?.startsWith('image/') ? '[Imagen adjunta]' : msg.mediaType?.startsWith('audio/') ? '[Audio]' : ''),
  }));

  // Verificar si el mensaje actual ya está en el historial
  const lastMsg = historyMessages[historyMessages.length - 1];
  const alreadyIncluded = lastMsg?.role === 'user' && lastMsg?.content === newUserMessage;

  if (!alreadyIncluded) {
    if (mediaUrl && mediaType?.startsWith('image/')) {
      // Mensaje actual con imagen — usar formato vision de OpenAI
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: 'image_url', image_url: { url: mediaUrl } },
      ];
      if (newUserMessage) {
        parts.push({ type: 'text', text: newUserMessage });
      }
      historyMessages.push({ role: 'user', content: parts });
    } else {
      historyMessages.push({ role: 'user', content: newUserMessage || '[Mensaje vacío]' });
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
  ];
}

/**
 * Verifica si el mensaje contiene palabras clave de transferencia a humano.
 * Coincide por palabra/frase completa (con límites de letra) para evitar falsos
 * positivos: "asesor" ya NO dispara dentro de "asesoramiento".
 */
export function detectsTransferKeyword(
  message: string,
  keywords: string[]
): boolean {
  const text = message.toLowerCase();
  return keywords.some((keyword) => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return false;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (^|no-letra) keyword (no-letra|$) — respeta acentos con \p{L} y flag u.
    return new RegExp(`(^|\\P{L})${escaped}(\\P{L}|$)`, 'iu').test(text);
  });
}
