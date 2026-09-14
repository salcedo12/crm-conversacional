import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { leadsRepository } from '../modules/leads/leads.repository';
import { syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import type { Lead } from '../modules/leads/leads.types';

/**
 * Errores de sincronización a SmartHome que son TRANSITORIOS (del lado de SmartHome,
 * no del lead ni del asesor): la validación de duplicados no estuvo disponible.
 * Estos SÍ se reintentan; los definitivos (duplicado real, asesor no mapeado) NO.
 */
const TRANSIENT_ERRORS = ['smarthome-validacion-duplicados-no-disponible'];

/** Tras estos intentos se desiste para no reintentar en bucle indefinido. */
const MAX_RETRIES = 8;

/**
 * Red de seguridad: cada 15 min reintenta crear en SmartHome los leads que quedaron
 * con un error TRANSITORIO (p. ej. el BI de SmartHome no respondió al validar
 * duplicados). El camino normal es el envío del primer mensaje del asesor
 * (sendManualMessage), pero si SmartHome estaba caído en ese momento el lead queda
 * marcado y sin reintento — este barrido lo recupera cuando SmartHome vuelve.
 *
 * Idempotente: syncLeadToSmartHome no recrea si ya existe (smartHomeCustomerId) y
 * respeta la validación de duplicados. Filtra por `smartHomeSyncError` con una
 * consulta collectionGroup, así solo toca los pocos leads atascados.
 */
export const processSmartHomeRetries = onSchedule(
  {
    schedule:       'every 15 minutes',
    region:         'us-central1',
    timeoutSeconds: 300,
    timeZone:       'America/Bogota',
  },
  async () => {
    const snap = await db
      .collectionGroup('leads')
      .where('smartHomeSyncError', 'in', TRANSIENT_ERRORS)
      .limit(25)
      .get();

    if (snap.empty) return;

    let created = 0;
    let stillFailing = 0;
    for (const doc of snap.docs) {
      const parts = doc.ref.path.split('/'); // companies/{cid}/leads/{lid}
      const companyId = parts[1];
      const data = doc.data() as Lead & { smartHomeSyncRetries?: number };

      const retries = data.smartHomeSyncRetries ?? 0;
      if (retries >= MAX_RETRIES) {
        // Se desiste: se marca como definitivo para que deje de reintentarse y
        // quede visible para revisión manual.
        await leadsRepository.update(companyId, doc.id, {
          smartHomeSyncError: 'smarthome-validacion-duplicados-agotado',
        });
        continue;
      }

      const lead: Lead = { ...data, id: doc.id, companyId };
      try {
        const result = await syncLeadToSmartHome(lead);
        if (result.ok) {
          created++;
        } else {
          stillFailing++;
          await leadsRepository.update(companyId, doc.id, { smartHomeSyncRetries: retries + 1 });
        }
      } catch (err) {
        stillFailing++;
        logger.warn('[SmartHomeRetries] Error reintentando lead', {
          companyId, leadId: doc.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(`[SmartHomeRetries] Barrido: ${snap.size} pendiente(s), ${created} creado(s), ${stillFailing} aún fallando.`);
  }
);
