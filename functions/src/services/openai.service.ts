import OpenAI from 'openai';
import { db } from '../lib/admin';

const DEFAULT_SYSTEM_PROMPT = `Eres un asistente de ventas amable y profesional.
Tu objetivo es calificar prospectos y agendar demos por Google Meet.
Responde siempre en español, de forma concisa (máximo 3 oraciones).
No inventes precios ni datos técnicos que no tengas.`;

export class OpenAIService {
  private _client: OpenAI | null = null;

  // Lazy init: el cliente se crea la primera vez que se usa,
  // cuando las env vars ya están disponibles en el runtime de Cloud Functions.
  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this._client;
  }

  /**
   * Genera una respuesta de la IA para una conversación dada.
   * - Carga el prompt de la empresa desde Firestore
   * - Usa los últimos 20 mensajes como contexto
   */
  async generateReply(
    conversationId: string,
    companyId: string,
    newUserMessage: string
  ): Promise<string> {
    // 1. Cargar el prompt config de la empresa
    const promptSnap = await db
      .collection('promptConfigs')
      .where('companyId', '==', companyId)
      .limit(1)
      .get();

    const systemPrompt = promptSnap.empty
      ? DEFAULT_SYSTEM_PROMPT
      : (promptSnap.docs[0].data().behaviorInstructions as string) +
        (promptSnap.docs[0].data().knowledgeBase
          ? `\n\nBase de conocimiento:\n${promptSnap.docs[0].data().knowledgeBase}`
          : '');

    // 2. Cargar historial de mensajes (últimos 20 para no exceder context window)
    const messagesSnap = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .limitToLast(20)
      .get();

    const history: OpenAI.Chat.ChatCompletionMessageParam[] = messagesSnap.docs.map((doc) => {
      const data = doc.data();
      // LEAD → user,  AI/ADVISER/SYSTEM → assistant
      const role: 'user' | 'assistant' =
        data.senderType === 'LEAD' ? 'user' : 'assistant';
      return { role, content: data.content as string };
    });

    // 3. Agregar el mensaje nuevo del lead (ya guardado en Firestore, pero lo incluimos
    //    en caso de que aún no esté en el historial que cargamos)
    const lastInHistory = history[history.length - 1];
    if (!lastInHistory || lastInHistory.content !== newUserMessage) {
      history.push({ role: 'user', content: newUserMessage });
    }

    // 4. Llamar a OpenAI
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content?.trim() ?? 'Disculpa, no pude procesar tu mensaje en este momento.';
  }
}
