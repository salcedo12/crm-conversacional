import type OpenAI from 'openai';
import type { AiConfig } from './ai.types';
import type { Message } from '../messages/messages.types';

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
  const systemPrompt = config.knowledgeBase
    ? `${config.basePrompt}\n\n## BASE DE CONOCIMIENTO ADICIONAL\n${config.knowledgeBase}`
    : config.basePrompt;

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
 */
export function detectsTransferKeyword(
  message: string,
  keywords: string[]
): boolean {
  const lower = message.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}
