import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';

/** Uso de una llamada al modelo (lo que devuelve OpenAI en `usage`). */
export interface ModelUsage {
  prompt_tokens?:     number;
  completion_tokens?: number;
}

/** Fecha YYYY-MM-DD en hora de Colombia (los informes del CRM van por día de Bogotá). */
export function bogotaDay(date: Date = new Date()): string {
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function sumUsage(usages: Array<ModelUsage | null | undefined>): { calls: number; input: number; output: number } {
  return usages.reduce<{ calls: number; input: number; output: number }>((acc, u) => {
    if (!u) return acc;
    return { calls: acc.calls + 1, input: acc.input + (u.prompt_tokens ?? 0), output: acc.output + (u.completion_tokens ?? 0) };
  }, { calls: 0, input: 0, output: 0 });
}

/**
 * Suma el consumo del turno en companies/{id}/aiUsage/{día}. Los nombres no llevan la
 * palabra "token" a propósito: el logger oculta cualquier campo que la contenga.
 */
export async function recordAiUsage(
  companyId: string,
  leadId: string,
  model: string,
  usages: Array<ModelUsage | null | undefined>
): Promise<void> {
  const total = sumUsage(usages);
  if (total.calls === 0) return;
  logger.info('[AI] Consumo del turno', { leadId, model, llamadas: total.calls, usoEntrada: total.input, usoSalida: total.output });
  const day = bogotaDay();
  await db.doc(`companies/${companyId}/aiUsage/${day}`).set({
    day,
    turnos: FieldValue.increment(1),
    leads: FieldValue.arrayUnion(leadId),
    llamadas: FieldValue.increment(total.calls),
    entrada: FieldValue.increment(total.input),
    salida: FieldValue.increment(total.output),
    [`porModelo.${model.replace(/[.\s]/g, '_')}.entrada`]: FieldValue.increment(total.input),
    [`porModelo.${model.replace(/[.\s]/g, '_')}.salida`]: FieldValue.increment(total.output),
    updatedAt: Timestamp.now(),
  }, { merge: true }).catch((err) => logger.warn('[AI] No se pudo registrar el consumo', { companyId, error: String(err) }));
}

/**
 * Suma contadores del día para el tablero de la IA (cotizaciones, traspasos, fichas…).
 * Best-effort: nunca rompe la conversación.
 */
export async function bumpAiDaily(companyId: string, counters: Record<string, number>): Promise<void> {
  const day = bogotaDay();
  const update: Record<string, unknown> = { day, updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(counters)) update[key] = FieldValue.increment(value);
  await db.doc(`companies/${companyId}/aiUsage/${day}`).set(update, { merge: true })
    .catch((err) => logger.warn('[AI] No se pudo sumar el contador diario', { companyId, error: String(err) }));
}
