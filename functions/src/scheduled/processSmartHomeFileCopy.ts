import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { smartHomeEnabledForCompany } from '../modules/smarthome/smarthomeSync.service';
import { copySmartHomeFiles } from '../modules/smarthomeSales/smarthomeFiles.service';

/**
 * AUTOMÁTICO: cada hora copia a Firebase Storage los archivos de SmartHome que
 * falten (unos 1.400 la primera vez → se reparte en varias corridas). Cuando ya
 * está todo copiado solo revisa y termina en segundos.
 */
export const processSmartHomeFileCopy = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'us-central1',
    timeZone: 'America/Bogota',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const companies = await db.collection('companies').listDocuments();
    for (const companyRef of companies) {
      try {
        if (!(await smartHomeEnabledForCompany(companyRef.id))) continue;
        await copySmartHomeFiles(companyRef.id, 450_000);
      } catch (err) {
        logger.error('[processSmartHomeFileCopy] error por empresa', {
          companyId: companyRef.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
