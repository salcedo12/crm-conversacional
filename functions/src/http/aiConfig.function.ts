import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z }                  from 'zod';
import { db }                 from '../lib/admin';
import { logger }             from '../utils/logger';
import { getAiConfig }        from '../modules/ai/aiConfig.repository';
import { VICTORIA_BASE_PROMPT } from '../modules/ai/defaultPrompt';
import { buildOpenAiMessages } from '../modules/ai/aiContext.service';
import { getOpenAIClient }    from '../integrations/openai/openai.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import type { Message } from '../modules/messages/messages.types';

// ─── Ruta del documento de config ────────────────────────────────────────────
const configRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('aiConfigs').doc('default');

// ─── Schema de validación ────────────────────────────────────────────────────
const FollowUpStepSchema = z.object({
  delayMinutes: z.number().int().min(1).max(30_000),
  enabled:      z.boolean(),
  templateName: z.string().optional(),
});

const SaveAiConfigSchema = z.object({
  companyId:          z.string().min(1),
  enabled:            z.boolean(),
  assistantName:      z.string().min(1).max(80),
  businessName:       z.string().min(1).max(120),
  basePrompt:         z.string().min(10).max(100_000),
  tone:               z.enum(['professional', 'friendly', 'formal', 'casual']),
  knowledgeBase:      z.string().max(100_000),
  fallbackMessage:    z.string().min(1).max(500),
  maxContextMessages: z.number().int().min(5).max(50),
  transferKeywords:   z.array(z.string().max(60)).max(30),
  blockedTopics:      z.array(z.string().max(60)).max(30),
  followUpSequence:   z.array(FollowUpStepSchema).max(5),
  quoteMode:          z.enum(['off', 'on_request', 'proactive']).default('off'),
  // Opcionales: si no vienen, se conserva lo guardado.
  agentProfile:        z.enum(['legacy', 'consultive']).optional(),
  model:               z.string().trim().min(1).max(60).optional(),
  voiceEnabled:        z.boolean().optional(),
  sobreMontanasQuotes: z.boolean().optional(),
  advertisedPrice:     z.number().int().min(1_000_000).max(5_000_000_000).optional(),
  quoteBonusBase:      z.number().int().min(0).max(500_000_000).optional(),
  quoteBonusMax:       z.number().int().min(0).max(500_000_000).optional(),
  priceReference:      z.number().int().min(1_000_000).max(5_000_000_000).optional(),
  priceReferenceArea:  z.number().int().min(1).max(1_000_000).optional(),
  priceWithBonusFrom:  z.number().int().min(1_000_000).max(5_000_000_000).optional(),
  bonusRangeMin:       z.number().int().min(0).max(500_000_000).optional(),
  separationAmount:    z.number().int().min(0).max(500_000_000).optional(),
  paymentPlanExample:  z.string().max(300).optional(),
  // null = sin piloto (atiende a todos los leads con IA activa).
  rollout: z.object({
    testPhones: z.array(z.string().trim().min(7).max(30)).max(50).default([]),
    startAt:    z.number().int().positive().nullable().optional(),
    sources:    z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  }).nullable().optional(),
});

// ─── getAiConfig ─────────────────────────────────────────────────────────────

/**
 * Callable: devuelve la config de IA activa para la empresa.
 * Si no hay doc en Firestore, devuelve la config por defecto (prompt de Victoria).
 */
export const getAiConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) })
      .parse(request.data);
    assertCompany(ctx, companyId);

    const config = await getAiConfig(companyId);

    // Convertir Timestamp a millis para que el cliente pueda deserializarlo
    const startAt = config.rollout?.startAt as Timestamp | undefined;
    return {
      ...config,
      rollout: config.rollout
        ? { testPhones: config.rollout.testPhones ?? [], sources: config.rollout.sources ?? [], startAt: startAt?.toMillis?.() ?? null }
        : null,
      updatedAt: config.updatedAt ? (config.updatedAt as Timestamp).toMillis() : null,
    };
  }
);

// ─── saveAiConfig ─────────────────────────────────────────────────────────────

/**
 * Callable: guarda la config de IA en Firestore.
 * Crea o sobreescribe companies/{companyId}/aiConfigs/default.
 */
export const saveAiConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const parse = SaveAiConfigSchema.safeParse(request.data);
    if (!parse.success) {
      throw new HttpsError('invalid-argument', 'Datos inválidos: ' + parse.error.message);
    }

    const { companyId, rollout, ...fields } = parse.data;
    assertCompany(ctx, companyId);
    if (fields.quoteBonusBase !== undefined && fields.quoteBonusMax !== undefined && fields.quoteBonusMax < fields.quoteBonusBase) {
      throw new HttpsError('invalid-argument', 'El bono máximo no puede ser menor que el bono base.');
    }

    // merge: conserva los campos que no vienen en la petición.
    await configRef(companyId).set({
      ...fields,
      companyId,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    // El piloto se reemplaza completo (update), para que quitar la fecha o los orígenes sí se borre.
    if (rollout !== undefined) {
      await configRef(companyId).update({
        rollout: rollout === null
          ? FieldValue.delete()
          : {
            testPhones: rollout.testPhones,
            sources:    rollout.sources,
            ...(rollout.startAt ? { startAt: Timestamp.fromMillis(rollout.startAt) } : {}),
          },
      });
    }

    logger.info('[AiConfig] Config guardada', { companyId });
    return { ok: true };
  }
);

// ─── resetAiConfig ────────────────────────────────────────────────────────────

/**
 * Callable: restaura SOLO las instrucciones (basePrompt) a las del código. No toca si la
 * IA está encendida, el piloto, los precios ni nada más: antes borraba todo el documento
 * y la empresa quedaba con la configuración por defecto.
 */
export const resetAiConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) })
      .parse(request.data);
    assertCompany(ctx, companyId);

    await configRef(companyId).set({ basePrompt: VICTORIA_BASE_PROMPT, updatedAt: Timestamp.now() }, { merge: true });

    logger.info('[AiConfig] Instrucciones restauradas', { companyId });
    return { ok: true };
  }
);

// ─── testAiAssistant (playground) ─────────────────────────────────────────────

/**
 * Callable de PRUEBA: genera una respuesta del asistente con el prompt/config
 * actuales (o el borrador sin guardar que se está editando), sin efectos: NO
 * manda WhatsApp, NO guarda mensajes, NO agenda. Solo para probar a la IA desde
 * la pantalla de configuración, como un chat de prueba. Sin herramientas (agendar
 * cita, etc.) — es una conversación pura para validar tono y conocimiento.
 */
export const testAiAssistant = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, messages, basePrompt, knowledgeBase } = z.object({
      companyId:     z.string().min(1),
      messages:      z.array(z.object({
        role:    z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      })).min(1).max(40),
      basePrompt:    z.string().max(100_000).optional(),   // borrador sin guardar
      knowledgeBase: z.string().max(100_000).optional(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    if (messages[messages.length - 1].role !== 'user') {
      throw new HttpsError('invalid-argument', 'El último mensaje debe ser del cliente.');
    }

    // Config guardada + overrides del borrador que se está editando en pantalla.
    const saved = await getAiConfig(companyId);
    const config = {
      ...saved,
      ...(basePrompt    !== undefined ? { basePrompt }    : {}),
      ...(knowledgeBase !== undefined ? { knowledgeBase } : {}),
    };

    // La conversación de prueba → formato Message[] para reutilizar el mismo
    // armador de prompt que usa el motor real.
    const history = messages.map((m) => ({
      senderType: m.role === 'user' ? 'lead' : 'ai',
      content:    m.content,
    })) as unknown as Message[];
    const lastUser = messages[messages.length - 1].content;

    const oaMessages = buildOpenAiMessages(config, history, lastUser);

    try {
      const completion = await getOpenAIClient().chat.completions.create({
        model:       'gpt-4o-mini',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages:    oaMessages as any,
        max_tokens:  400,
        temperature: 0.7,
      });
      const reply = completion.choices[0]?.message?.content?.trim();
      return { reply: reply || config.fallbackMessage || '(La IA no devolvió respuesta.)' };
    } catch (err) {
      logger.error('[AiConfig] Error en prueba de IA', {
        companyId, error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'No se pudo generar la respuesta de prueba. Revisa que la clave de OpenAI esté configurada.');
    }
  }
);
