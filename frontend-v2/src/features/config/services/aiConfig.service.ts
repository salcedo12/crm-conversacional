import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';
import type { AiConfig, AiConfigDraft } from '../types';

const _getAiConfig   = httpsCallable<{ companyId: string }, AiConfig>(functions, 'getAiConfig');
const _saveAiConfig  = httpsCallable<{ companyId: string } & AiConfigDraft, { ok: boolean }>(functions, 'saveAiConfig');
const _resetAiConfig = httpsCallable<{ companyId: string }, { ok: boolean }>(functions, 'resetAiConfig');

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
