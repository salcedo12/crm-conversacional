import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { getAutoCallConfig, saveAutoCallConfig } from '../modules/autocall/autoCallConfig';
import { requireAuth, requireRole, assertCompany } from '../lib/authContext';
import type { UserRole } from '../lib/authContext';

/** Solo admin de empresa y admin de plataforma pueden ver/cambiar el modo automático. */
const AUTO_CALL_ROLES: UserRole[] = ['admin', 'platformAdmin'];

const SaveSchema = z.object({
  companyId:                 z.string().min(1),
  enabled:                   z.boolean(),
  windowStartHour:           z.number().int().min(0).max(23),
  windowEndHour:             z.number().int().min(1).max(24),
  retryOffsetsHours:         z.array(z.number().min(0).max(720)).max(6),
  followUpInterestedEnabled: z.boolean(),
  followUpInterestedHours:   z.number().min(1).max(168),
  dailyCap:                  z.number().int().min(0).max(5000),
}).refine((d) => d.windowEndHour > d.windowStartHour, {
  message: 'La hora de fin debe ser mayor que la de inicio.',
});

// ─── getAutoCallConfig ─────────────────────────────────────────────────────────

export const getAutoCallConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, AUTO_CALL_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    return await getAutoCallConfig(companyId);
  }
);

// ─── saveAutoCallConfig ────────────────────────────────────────────────────────

export const saveAutoCallConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, AUTO_CALL_ROLES);

    const parse = SaveSchema.safeParse(request.data);
    if (!parse.success) {
      throw new HttpsError('invalid-argument', 'Datos inválidos: ' + parse.error.message);
    }

    const { companyId, ...cfg } = parse.data;
    assertCompany(ctx, companyId);

    await saveAutoCallConfig(companyId, cfg);
    logger.info('[AutoCall] Config guardada', { companyId, enabled: cfg.enabled });
    return { ok: true };
  }
);
