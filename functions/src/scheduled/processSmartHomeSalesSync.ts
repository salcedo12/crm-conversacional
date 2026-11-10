import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { smartHomeEnabledForCompany } from '../modules/smarthome/smarthomeSync.service';
import { syncSmartHomeSales } from '../modules/smarthomeSales/smarthomeSales.service';

/**
 * AUTOMÁTICO: cada día copia los lotes vendidos de SmartHome (comprador, valor,
 * etapa y lista de archivos) para el módulo Negocios. Solo empresas con SmartHome
 * activo; un admin también puede forzarla desde la pantalla (syncSmartHomeSalesNow).
 */
export const processSmartHomeSalesSync = onSchedule(
  {
    schedule: 'every day 04:30',
    region: 'us-central1',
    timeZone: 'America/Bogota',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const companies = await db.collection('companies').listDocuments();
    for (const companyRef of companies) {
      try {
        if (!(await smartHomeEnabledForCompany(companyRef.id))) continue;
        await syncSmartHomeSales(companyRef.id);
      } catch (err) {
        logger.error('[processSmartHomeSalesSync] error por empresa', {
          companyId: companyRef.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
