import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp }          from 'firebase-admin/firestore';
import { z }                  from 'zod';
import { db }                 from '../lib/admin';
import { logger }             from '../utils/logger';
import { getAiConfig }        from '../modules/ai/aiConfig.repository';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

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
  basePrompt:         z.string().min(10).max(20_000),
  tone:               z.enum(['professional', 'friendly', 'formal', 'casual']),
  knowledgeBase:      z.string().max(20_000),
  fallbackMessage:    z.string().min(1).max(500),
  maxContextMessages: z.number().int().min(5).max(50),
  transferKeywords:   z.array(z.string().max(60)).max(30),
  blockedTopics:      z.array(z.string().max(60)).max(30),
  followUpSequence:   z.array(FollowUpStepSchema).max(5),
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
