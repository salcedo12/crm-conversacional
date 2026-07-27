import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { LeadAnalysis } from '@/features/inbox/types';

/** Análisis tal como lo devuelve el callable: analyzedAt viene como epoch millis. */
export type LeadAnalysisResult = Omit<LeadAnalysis, 'analyzedAt'> & { analyzedAt: number };

const _analyzeLead = httpsCallable<
  { companyId: string; leadId: string },
  { analysis: LeadAnalysisResult }
>(functions, 'analyzeLead');

/** Genera (o regenera) la radiografía IA de un lead. Pasa por Cloud Function. */
export async function analyzeLead(companyId: string, leadId: string): Promise<LeadAnalysisResult> {
  const r = await _analyzeLead({ companyId, leadId });
  return r.data.analysis;
}

/** Normaliza el análisis guardado en el lead (Timestamp) a la forma de la vista (millis). */
export function toAnalysisResult(a: LeadAnalysis): LeadAnalysisResult {
  return { ...a, analyzedAt: a.analyzedAt?.toMillis?.() ?? 0 };
}
