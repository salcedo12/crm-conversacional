import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { checkPreCitaSla, checkPostCitaSla, checkManualTakeoverSla } from '../modules/appointments/appointmentSla.service';

/**
 * Scheduled Function que se ejecuta cada 5 minutos para auditar los SLAs:
 * 1. SLA Pre-Cita (30 min): Reasigna citas si el asesor no ha escrito al cliente.
 * 2. SLA Post-Cita (1 hora): Bloquea recepción de leads si el asesor no reportó la Ficha Técnica.
 * 3. SLA Toma Manual IA (24 horas): Bloquea recepción de leads si el asesor apagó la IA y no agendó cita ni llenó Ficha Técnica en 24h.
 */
export const processAppointmentSla = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async () => {
    try {
      const companiesSnap = await db.collection('companies').get();

      for (const compDoc of companiesSnap.docs) {
        const companyId = compDoc.id;

        // 1. Ejecutar auditoría Pre-Cita (30 minutos)
        const reasignadas = await checkPreCitaSla(companyId).catch((err) => {
          logger.error('[ProcessAppointmentSLA] Error en checkPreCitaSla', { companyId, error: err.message });
          return 0;
        });

        // 2. Ejecutar auditoría Post-Cita (1 hora)
        const bloqueados = await checkPostCitaSla(companyId).catch((err) => {
          logger.error('[ProcessAppointmentSLA] Error en checkPostCitaSla', { companyId, error: err.message });
          return 0;
        });

        // 3. Ejecutar auditoría Toma Manual al apagar la IA (24 horas)
        const bloqueadosTakeover = await checkManualTakeoverSla(companyId).catch((err) => {
          logger.error('[ProcessAppointmentSLA] Error en checkManualTakeoverSla', { companyId, error: err.message });
          return 0;
        });

        if (reasignadas > 0 || bloqueados > 0 || bloqueadosTakeover > 0) {
          logger.info('[ProcessAppointmentSLA] Auditoría completada con novedades', {
            companyId,
            reasignadas,
            bloqueados,
            bloqueadosTakeover,
          });
        }
      }
    } catch (err) {
      logger.error('[ProcessAppointmentSLA] Error general en auditoría de SLA', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
