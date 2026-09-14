import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp }          from 'firebase-admin/firestore';
import { z }                  from 'zod';
import { db }                 from '../lib/admin';
import { logger }             from '../utils/logger';
import { getAiConfig }        from '../modules/ai/aiConfig.repository';
import { buildOpenAiMessages } from '../modules/ai/aiContext.service';
import { getOpenAIClient }    from '../integrations/openai/openai.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import type { Message } from '../modules/messages/messages.types';

// ─── Ruta del documento de config ────────────────────────────────────────────
const configRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('aiConfigs').doc('default');

// ─── Schema de validación ────────────────────────────────────────────────────
const FollowUpStepSchema = z.object({
  delayMinutes: z.number().int().min(1).max(10_080), // máx 1 semana
  enabled:      z.boolean(),
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
    return {
      ...config,
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

    const { companyId, ...fields } = parse.data;
    assertCompany(ctx, companyId);

    await configRef(companyId).set({
      ...fields,
      companyId,
      updatedAt: Timestamp.now(),
    });

    logger.info('[AiConfig] Config guardada', { companyId });
    return { ok: true };
  }
);

// ─── resetAiConfig ────────────────────────────────────────────────────────────

/**
 * Callable: elimina el doc de Firestore → el backend vuelve al prompt de Victoria hardcodeado.
 */
export const resetAiConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) })
      .parse(request.data);
    assertCompany(ctx, companyId);

    await configRef(companyId).delete();

    logger.info('[AiConfig] Config reseteada a defaults', { companyId });
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
