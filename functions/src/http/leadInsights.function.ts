import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { db } from '../lib/admin';
import { getOpenAIClient } from '../integrations/openai/openai.client';
import { getAiConfig } from '../modules/ai/aiConfig.repository';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import type { Lead } from '../modules/leads/leads.types';
import type { LeadLossCategory } from '../modules/ai/leadAnalysis.types';

const LOSS_LABEL: Record<LeadLossCategory, string> = {
  precio:        'Precio / presupuesto',
  ubicacion:     'Ubicación / zona',
  competencia:   'Se fue con la competencia',
  sin_respuesta: 'Dejó de responder',
  tiempo:        'No es el momento',
  no_califica:   'No califica',
  atencion:      'Mala atención / demora',
  otro:          'Otro',
  ninguno:       'Sin riesgo claro',
};

/**
 * Genera una recomendación ejecutiva (2-4 frases) sobre por qué se están
 * perdiendo los leads, a partir de las razones de pérdida ya calificadas por la
 * IA. Solo admin/manager; bajo demanda (no se ejecuta en cada carga del panel).
 */
export const generateLossInsight = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    if (!env.openaiApiKey()) {
      throw new HttpsError('failed-precondition', 'OpenAI no está configurado.');
    }

    const snap = await db
      .collection('companies').doc(companyId)
      .collection('leads')
      .where('status', '==', 'lost')
      .get();

    const lostLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
    const analyzed = lostLeads.filter((l) => l.aiAnalysis && typeof l.aiAnalysis.score === 'number');

    if (analyzed.length < 3) {
      throw new HttpsError(
        'failed-precondition',
        'Aún no hay suficientes leads perdidos analizados por la IA. Espera al análisis nocturno o analiza algunos leads perdidos manualmente.'
      );
    }

    // Distribución de motivos + textos de ejemplo para dar contexto al modelo.
    const lossCount = new Map<LeadLossCategory, number>();
    const sampleRisks: string[] = [];
    const objections = new Map<string, number>();

    for (const lead of analyzed) {
      const ai = lead.aiAnalysis!;
      const cat = (ai.lossCategory ?? 'otro') as LeadLossCategory;
      if (cat !== 'ninguno') lossCount.set(cat, (lossCount.get(cat) ?? 0) + 1);
      if (ai.lossRisk && sampleRisks.length < 15) sampleRisks.push(ai.lossRisk);
      for (const obj of ai.objections ?? []) {
        const key = obj.trim().toLowerCase();
        if (key) objections.set(key, (objections.get(key) ?? 0) + 1);
      }
    }

    const distribution = [...lossCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `- ${LOSS_LABEL[cat]}: ${count} (${Math.round((count / analyzed.length) * 100)}%)`)
      .join('\n');

    const topObjections = [...objections.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([obj, count]) => `- ${obj} (${count})`)
      .join('\n');

    const config = await getAiConfig(companyId);

    const systemPrompt =
      `Eres un director comercial de ${config.businessName} (constructora/inmobiliaria). ` +
      `Te dan un resumen de por qué se están perdiendo los leads. Escribe un análisis ejecutivo ` +
      `breve (máximo 4 frases) en español: identifica el patrón principal, su impacto y 2 recomendaciones ` +
      `concretas y accionables para el equipo comercial. Sé directo y específico; no repitas los números uno por uno.`;

    const userPrompt =
      `Total de leads perdidos analizados: ${analyzed.length}\n\n` +
      `## MOTIVOS DE PÉRDIDA\n${distribution || '(sin motivos claros)'}\n\n` +
      (topObjections ? `## OBJECIONES MÁS FRECUENTES\n${topObjections}\n\n` : '') +
      (sampleRisks.length ? `## EJEMPLOS (texto libre)\n${sampleRisks.map((r) => `- ${r}`).join('\n')}\n\n` : '') +
      `Redacta el análisis ejecutivo.`;

    let insight: string;
    try {
      const completion = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 320,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      insight = completion.choices[0]?.message?.content?.trim() ?? '';
    } catch (err) {
      logger.error('[generateLossInsight] OpenAI error', {
        companyId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo generar la recomendación con IA.');
    }

    if (!insight) throw new HttpsError('internal', 'La IA no devolvió una recomendación.');

    logger.info('[generateLossInsight] Recomendación generada', { companyId, basedOn: analyzed.length });
    return { insight, basedOn: analyzed.length, generatedAt: Date.now() };
  }
);
