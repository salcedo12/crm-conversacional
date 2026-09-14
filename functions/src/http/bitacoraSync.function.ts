import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { syncBitacoraStatus } from '../modules/leads/bitacoraStatusSync.service';

/**
 * Sincroniza el estado comercial de los leads con su bitácora de SmartHome.
 * `apply=false` (por defecto) = SIMULACIÓN: devuelve qué cambiaría sin escribir.
 * `apply=true` = aplica los cambios (y dispara las conversiones a Meta vía el
 * trigger onLeadStatusChanged para los que pasan a Agendado/Calificado).
 */
export const syncBitacoraStatusNow = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, apply } = z.object({
      companyId: z.string().min(1),
      apply: z.boolean().optional().default(false),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const result = await syncBitacoraStatus(companyId, !apply);
    return {
      applied: result.applied,
      scanned: result.scanned,
      total: result.changes.length,
      byTransition: result.changes.reduce<Record<string, number>>((o, c) => {
        const k = `${c.from}->${c.to}`;
        o[k] = (o[k] ?? 0) + 1;
        return o;
      }, {}),
      changes: result.changes.slice(0, 500),
    };
  },
);
