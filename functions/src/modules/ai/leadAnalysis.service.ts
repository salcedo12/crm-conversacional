import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getOpenAIClient } from '../../integrations/openai/openai.client';
import { messagesRepository } from '../messages/messages.repository';
import { leadsRepository } from '../leads/leads.repository';
import { getAiConfig } from './aiConfig.repository';
import type { Lead } from '../leads/leads.types';
import type { LeadAnalysis, LeadAnalysisAi } from './leadAnalysis.types';

const MODEL        = 'gpt-4o-mini';
const MAX_MESSAGES = 40;
const MAX_CALLS    = 5;

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo', active: 'Activo', qualified: 'Calificado',
  scheduled: 'Agendado', lost: 'Perdido', closed: 'Cerrado',
};
const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', manual: 'Carga manual', web: 'Sitio web',
  facebook: 'Facebook', instagram: 'Instagram', meta_ads: 'Anuncio de Meta',
};

/** JSON schema de Structured Outputs: obliga a la IA a devolver esta forma exacta. */
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score:            { type: 'integer', description: 'Puntaje 0-100 de calidad/probabilidad de cierre del lead.' },
    temperature:      { type: 'string', enum: ['hot', 'warm', 'cold'], description: 'hot=muy interesado y listo, warm=interés medio, cold=frío o poco interés.' },
    summary:          { type: 'string', description: 'Resumen ejecutivo de 1-2 frases del estado comercial del lead.' },
    interestLevel:    { type: 'string', description: 'Descripción breve del nivel de interés detectado.' },
    buyingSignals:    { type: 'array', items: { type: 'string' }, description: 'Señales de compra (urgencia, presupuesto, decisión, pide precios/visita).' },
    objections:       { type: 'array', items: { type: 'string' }, description: 'Objeciones o frenos detectados (precio, ubicación, "lo pienso", etc.).' },
    budget:           { type: ['string', 'null'], description: 'Presupuesto mencionado por el cliente o null si no se mencionó.' },
    interestArea:     { type: ['string', 'null'], description: 'Proyecto/zona/producto de interés o null si no se mencionó.' },
    nextAction:       { type: 'string', description: 'Próximo paso concreto y accionable para el asesor.' },
    nextActionReason: { type: 'string', description: 'Por qué ese próximo paso es el ideal ahora.' },
    lossRisk:         { type: 'string', description: 'Principal riesgo de pérdida; si el lead ya está perdido, la razón más probable por la que se perdió.' },
    lossCategory:     { type: 'string', enum: ['precio', 'ubicacion', 'competencia', 'sin_respuesta', 'tiempo', 'no_califica', 'atencion', 'otro', 'ninguno'], description: 'Categoría fija del riesgo/motivo de pérdida. Usa "ninguno" solo si el lead va bien y no hay riesgo claro.' },
    scoreReasons:     { type: 'array', items: { type: 'string' }, description: 'Factores clave que sustentan el puntaje.' },
  },
  required: [
    'score', 'temperature', 'summary', 'interestLevel', 'buyingSignals',
    'objections', 'budget', 'interestArea', 'nextAction', 'nextActionReason',
    'lossRisk', 'lossCategory', 'scoreReasons',
  ],
} as const;

function messageAuthor(senderType: string): string {
  switch (senderType) {
    case 'lead':    return 'CLIENTE';
    case 'advisor': return 'ASESOR';
    case 'ai':      return 'ASISTENTE IA';
    default:        return 'SISTEMA';
  }
}

/**
 * Analiza la conversación (WhatsApp + llamadas IA) de un lead y devuelve una
 * "radiografía": score de calificación + análisis cualitativo. No persiste nada;
 * el callable se encarga de guardar el resultado en el lead.
 */
export async function analyzeLeadConversation(
  lead: Lead
): Promise<{ analysis: LeadAnalysisAi; messageCount: number; model: string }> {
  if (!env.openaiApiKey()) {
    throw new HttpsError('failed-precondition', 'OpenAI no está configurado.');
  }

  const [messages, config, callsSnap] = await Promise.all([
    messagesRepository.getRecent(lead.companyId, lead.id, MAX_MESSAGES),
    getAiConfig(lead.companyId),
    db.collection('companies').doc(lead.companyId)
      .collection('leads').doc(lead.id)
      .collection('calls')
      .orderBy('createdAt', 'desc')
      .limit(MAX_CALLS)
      .get(),
  ]);

  if (messages.length === 0 && callsSnap.empty) {
    throw new HttpsError(
      'failed-precondition',
      'Este lead aún no tiene conversación ni llamadas para analizar.'
    );
  }

  const transcript = messages
    .map((m) => {
      const text = m.content
        || (m.mediaType?.startsWith('image/') ? '[imagen]'
          : m.mediaType?.startsWith('audio/') ? '[audio]'
          : m.mediaUrl ? '[archivo adjunto]' : '');
      return `${messageAuthor(m.senderType)}: ${text}`.trim();
    })
    .filter(Boolean)
    .join('\n');

  const callsText = callsSnap.docs
    .map((d) => {
      const c = d.data() as { summary?: string; outcome?: string; durationSec?: number };
      if (!c.summary && !c.outcome) return '';
      const parts = [
        c.outcome ? `resultado: ${c.outcome}` : '',
        c.durationSec ? `duración: ${c.durationSec}s` : '',
        c.summary ? `resumen: ${c.summary}` : '',
      ].filter(Boolean);
      return `- Llamada IA (${parts.join(', ')})`;
    })
    .filter(Boolean)
    .join('\n');

  const leadFacts = [
    `Nombre: ${lead.name || 'desconocido'}`,
    `Estado comercial actual: ${STATUS_LABEL[lead.status] ?? lead.status}`,
    `Fuente: ${SOURCE_LABEL[lead.source] ?? lead.source}`,
    lead.sourceMeta?.headline ? `Anuncio de origen: ${lead.sourceMeta.headline}` : '',
    lead.tags?.length ? `Etiquetas: ${lead.tags.join(', ')}` : '',
    lead.createdAt ? `Lead creado: ${lead.createdAt.toDate().toISOString().slice(0, 10)}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt =
    `Eres un analista comercial senior de ${config.businessName}, una constructora/inmobiliaria. ` +
    `Tu trabajo es calificar leads leyendo su conversación real y decirle al asesor qué tan bueno es el lead, ` +
    `por qué, y qué hacer ahora. Sé concreto, honesto y accionable; no inventes datos que no estén en la conversación. ` +
    `Responde SIEMPRE en español.` +
    (config.knowledgeBase ? `\n\n## CONTEXTO DEL NEGOCIO\n${config.knowledgeBase}` : '');

  const userPrompt =
    `## DATOS DEL LEAD\n${leadFacts}\n\n` +
    (callsText ? `## LLAMADAS CON IA\n${callsText}\n\n` : '') +
    `## CONVERSACIÓN (más reciente al final)\n${transcript || '(sin mensajes de texto)'}\n\n` +
    `Analiza este lead y devuelve el JSON con el score (0-100), la temperatura, el resumen, ` +
    `señales de compra, objeciones, presupuesto/zona si se mencionaron, el próximo paso ideal y el riesgo de pérdida.`;

  let raw: string | null | undefined;
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'lead_analysis', strict: true, schema: ANALYSIS_SCHEMA },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    raw = completion.choices[0]?.message?.content;
  } catch (err) {
    logger.error('[analyzeLeadConversation] OpenAI error', {
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new HttpsError('unavailable', 'No se pudo generar el análisis con IA en este momento.');
  }

  if (!raw) throw new HttpsError('internal', 'La IA no devolvió un análisis.');

  let parsed: LeadAnalysisAi;
  try {
    parsed = JSON.parse(raw) as LeadAnalysisAi;
  } catch {
    throw new HttpsError('internal', 'La IA devolvió un análisis con formato inválido.');
  }

  // Blindaje del score (la IA debería respetar 0-100, pero por si acaso).
  parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));

  return { analysis: parsed, messageCount: messages.length, model: MODEL };
}

/**
 * Analiza un lead y **persiste** el resultado en `lead.aiAnalysis`. Lógica
 * compartida por el callable `analyzeLead` (analyzedBy = uid del asesor) y el
 * job nocturno `processLeadAnalysis` (analyzedBy = 'system').
 */
export async function runAndStoreLeadAnalysis(
  lead: Lead,
  analyzedBy: string
): Promise<LeadAnalysis> {
  const { analysis, messageCount, model } = await analyzeLeadConversation(lead);
  const stored: LeadAnalysis = {
    ...analysis,
    messageCount,
    model,
    analyzedBy,
    analyzedAt: Timestamp.now(),
  };
  await leadsRepository.update(lead.companyId, lead.id, { aiAnalysis: stored });
  return stored;
}
