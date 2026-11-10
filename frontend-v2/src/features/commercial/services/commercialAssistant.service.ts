import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AskAssistantOptions {
  companyId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  periodContext?: {
    startDate?: number;
    endDate?: number;
    periodLabel?: string;
  };
}

export async function sendQueryToCommercialAssistant(
  options: AskAssistantOptions
): Promise<string> {
  const fn = httpsCallable<
    AskAssistantOptions,
    { reply: string }
  >(functions, 'askCommercialAssistant');

  const result = await fn(options);
  return result.data?.reply || 'No se recibió respuesta del Copiloto de IA.';
}
