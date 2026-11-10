import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type {
  CommercialLeaderboardResponse,
  CommercialGoalConfig,
  AdvisorGoalItem,
} from '../types/commercialGoals.types';

const _getCommercialLeaderboard = httpsCallable<
  { companyId: string; monthKey?: string },
  CommercialLeaderboardResponse
>(functions, 'getCommercialLeaderboard');

const _saveCommercialGoals = httpsCallable<
  {
    companyId: string;
    defaultGoals: CommercialGoalConfig;
    advisorGoals?: Record<string, AdvisorGoalItem>;
  },
  { ok: boolean }
>(functions, 'saveCommercialGoals');

export async function fetchCommercialLeaderboard(
  companyId: string,
  monthKey?: string
): Promise<CommercialLeaderboardResponse> {
  const r = await _getCommercialLeaderboard({ companyId, monthKey });
  return r.data;
}

export async function saveCommercialGoalsConfig(
  companyId: string,
  defaultGoals: CommercialGoalConfig,
  advisorGoals?: Record<string, AdvisorGoalItem>
): Promise<void> {
  await _saveCommercialGoals({ companyId, defaultGoals, advisorGoals });
}
