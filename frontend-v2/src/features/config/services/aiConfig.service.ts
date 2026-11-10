import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';
import type { AiConfig, AiConfigDraft } from '../types';

const _getAiConfig   = httpsCallable<{ companyId: string }, AiConfig>(functions, 'getAiConfig');
const _saveAiConfig  = httpsCallable<{ companyId: string } & AiConfigDraft, { ok: boolean }>(functions, 'saveAiConfig');
const _resetAiConfig = httpsCallable<{ companyId: string }, { ok: boolean }>(functions, 'resetAiConfig');

export interface AiTestMessage { role: 'user' | 'assistant'; content: string; }
const _testAiAssistant = httpsCallable<
  { companyId: string; messages: AiTestMessage[]; basePrompt?: string; knowledgeBase?: string },
  { reply: string }
>(functions, 'testAiAssistant');

export async function fetchAiConfig(companyId: string): Promise<AiConfig> {
  const result = await _getAiConfig({ companyId });
  return result.data;
}

export async function persistAiConfig(companyId: string, draft: AiConfigDraft): Promise<void> {
  await _saveAiConfig({ companyId, ...draft });
}

export async function restoreAiConfigDefaults(companyId: string): Promise<void> {
  await _resetAiConfig({ companyId });
}

/**
 * Genera una respuesta de prueba del asistente con el prompt/base de conocimiento
 * indicados (los del borrador que se está editando). No manda WhatsApp ni guarda.
 */
export async function testAiAssistant(
  companyId: string,
  messages: AiTestMessage[],
  overrides?: { basePrompt?: string; knowledgeBase?: string },
): Promise<string> {
  const result = await _testAiAssistant({ companyId, messages, ...overrides });
  return result.data.reply;
}

export interface AiReportDay {
  day:          string;
  chats:        number;
  respuestas:   number;
  cotizaciones: number;
  traspasos:    number;
  fallos:       number;
  fichas:       Record<string, number>;
  entrada:      number;
  salida:       number;
}
export interface AiReport { from: string; days: AiReportDay[]; chatsPeriodo: number }

const _getAiReport = httpsCallable<{ companyId: string; days: number }, AiReport>(functions, 'getAiReport');

/** Contadores diarios de la IA (chats, cotizaciones, citas, traspasos y consumo). */
export async function fetchAiReport(companyId: string, days: number): Promise<AiReport> {
  const result = await _getAiReport({ companyId, days });
  return result.data;
}
