import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import type { Lead } from '../modules/leads/leads.types';

/** Fuentes cuyos leads se envían a SmartHome (conversacionales; excluye cargas manuales masivas). */
const SYNC_SOURCES = new Set(['whatsapp', 'meta_ads', 'messenger', 'instagram', 'facebook', 'web']);

/**
 * Crea automáticamente cada lead nuevo (ya asignado a un asesor) en SmartHome.
 * Gated por `SMARTHOME_SYNC_ENABLED=true` — empieza APAGADO para probar primero
 * con el callable. Idempotente (no reenvía si ya tiene smartHomeCustomerId).
 */
export const onLeadSmartHomeSync = onDocumentWritten(
  { document: 'companies/{companyId}/leads/{leadId}', region: 'us-central1', timeoutSeconds: 180 },
  async (event) => {
    if (!env.smartHomeSyncEnabled()) return;

    const after = event.data?.after.data() as Lead | undefined;
    if (!after) return;
    const before = event.data?.before.data() as Lead | undefined;

    // Solo cuando ya hay asesor, no se ha sincronizado y es una fuente elegible.
    if (!after.assignedTo) return;
    if (after.smartHomeCustomerId) return;
    if (after.source && !SYNC_SOURCES.has(after.source)) return;
    if (
      after.smartHomeSyncError &&
      before?.smartHomeSyncError === after.smartHomeSyncError &&
      before?.assignedTo === after.assignedTo &&
      before?.phone === after.phone &&
      before?.source === after.source
    ) return;

    const { companyId, leadId } = event.params;
    const lead: Lead = { ...after, id: leadId, companyId };

    try {
      const result = await syncLeadToSmartHome(lead);
      if (!result.ok && result.reason !== 'already-synced') {
        logger.warn('[smartHome] No se pudo sincronizar lead', { companyId, leadId, reason: result.reason });
      }
    } catch (err) {
      logger.error('[smartHome] Error en trigger de sync', {
        companyId, leadId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
