import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functionsInstance = getFunctions(undefined, 'us-central1');

export type AiTone = 'professional' | 'friendly' | 'formal' | 'casual';

export interface FollowUpStep {
  delayMinutes: number;
  enabled: boolean;
}

export interface AiConfig {
  enabled: boolean;
  assistantName: string;
  businessName: string;
  basePrompt: string;
  tone: AiTone;
  knowledgeBase: string;
  fallbackMessage: string;
  maxContextMessages: number;
  transferKeywords: string[];
  blockedTopics: string[];
  followUpSequence: FollowUpStep[];
  updatedAt: number | null;
}

export type AiConfigDraft = Omit<AiConfig, 'updatedAt'>;

const _getAiConfig = httpsCallable<{ companyId: string }, AiConfig>(functionsInstance, 'getAiConfig');
const _saveAiConfig = httpsCallable<{ companyId: string } & AiConfigDraft, { ok: boolean }>(functionsInstance, 'saveAiConfig');

export async function fetchAiConfig(companyId: string): Promise<AiConfig> {
  const result = await _getAiConfig({ companyId });
  return result.data;
}

export async function persistAiConfig(companyId: string, draft: AiConfigDraft): Promise<void> {
  await _saveAiConfig({ companyId, ...draft });
}
