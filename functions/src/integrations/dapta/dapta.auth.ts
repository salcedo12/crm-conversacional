import type { Request } from 'express';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * IPs públicas desde las que Dapta envía webhooks (docs.dapta.ai).
 * Mismo respaldo blando que usa daptaWebhook.function.ts.
 */
const DAPTA_IPS = ['3.135.117.63', '3.143.158.83', '3.14.139.223'];

/** Valida que la petición venga de Dapta: secreto compartido, o IP conocida como respaldo. */
export function verifyDaptaRequest(req: Request): boolean {
  const secret = env.daptaWebhookSecret();
  if (secret) {
    const provided = (req.query.secret as string | undefined) ?? (req.header('x-dapta-secret') ?? undefined);
    return provided === secret;
  }

  const fwd = (req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim());
  const sourceIp = fwd[0] || req.ip || '';
  if (sourceIp && !DAPTA_IPS.includes(sourceIp)) {
    logger.warn('[Dapta] IP no reconocida — se procesa igual, configura DAPTA_WEBHOOK_SECRET para reforzar', { sourceIp });
  }
  return true;
}
