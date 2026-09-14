import { httpsCallable } from 'firebase/functions';
import { functions }      from '@/config/firebase';

/** Config del modo de llamadas IA automáticas (espejo de AutoCallConfig en el backend). */
export interface AutoCallConfig {
  enabled:                   boolean;
  windowStartHour:           number;
  windowEndHour:             number;
  retryOffsetsHours:         number[];
  followUpInterestedEnabled: boolean;
  followUpInterestedHours:   number;
  dailyCap:                  number;
}

const _get  = httpsCallable<{ companyId: string }, AutoCallConfig>(functions, 'getAutoCallConfigCallable');
const _save = httpsCallable<AutoCallConfig & { companyId: string }, { ok: boolean }>(functions, 'saveAutoCallConfigCallable');

export async function getAutoCallConfig(companyId: string): Promise<AutoCallConfig> {
  const r = await _get({ companyId });
  return r.data;
}

export async function saveAutoCallConfig(companyId: string, cfg: AutoCallConfig): Promise<void> {
  await _save({ companyId, ...cfg });
}
