import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { syncBitacoraStatus } from '../modules/leads/bitacoraStatusSync.service';

/**
 * AUTOMÁTICO: cada día actualiza el estado comercial de los leads según lo que el
 * asesor escribió en la bitácora de SmartHome (No interesado→Perdido,
 * Agendado→Agendado, Interesado→Calificado). Ver bitacoraStatusSync.service.ts.
 * Corre 1 vez al día (madrugada Colombia) para no chocar con la operación.
 */
export const processBitacoraStatusSync = onSchedule(
  {
    schedule: 'every day 05:30',
    region: 'us-central1',
    timeZone: 'America/Bogota',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const companies = await db.collection('companies').listDocuments();
    for (const companyRef of companies) {
      try {
        const result = await syncBitacoraStatus(companyRef.id, false);
        if (result.changes.length) {
          logger.info('[processBitacoraStatusSync] estados sincronizados', {
            companyId: companyRef.id, scanned: result.scanned, changed: result.changes.length,
          });
        }
      } catch (err) {
        logger.error('[processBitacoraStatusSync] error por empresa', {
          companyId: companyRef.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
