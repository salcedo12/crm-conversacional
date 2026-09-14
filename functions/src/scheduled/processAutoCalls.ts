import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { fireDueAutoCalls } from '../modules/autocall/autoCall.service';

/**
 * Cada 10 minutos: dispara las llamadas IA automáticas que ya están vencidas
 * (iniciales, reintentos y seguimientos), respetando el horario diurno del país
 * de cada lead y el tope diario por empresa. La lógica vive en [autoCall.service].
 *
 * Usa listDocuments() (no .get()) para incluir compañías "fantasma", igual que
 * processFollowUps/processReminders.
 */
export const processAutoCalls = onSchedule(
  {
    schedule:       'every 10 minutes',
    region:         'us-central1',
    timeoutSeconds: 300,
    memory:         '256MiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    const companies = await db.collection('companies').listDocuments();
    let total = 0;

    for (const companyRef of companies) {
      try {
        total += await fireDueAutoCalls(companyRef.id);
      } catch (err) {
        logger.error('[AutoCall] Error procesando auto-llamadas de la empresa', {
          companyId: companyRef.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (total > 0) logger.info(`[AutoCall] ${total} llamada(s) automática(s) disparada(s).`);
  }
);
