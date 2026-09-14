import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { getSmartHomeProspectEvents } from '../../integrations/smarthome/smarthome.client';
import { classifyBitacora, latestAdvisorNoteText } from '../smarthome/bitacoraClassify';
import { countsAs317LineLead } from './leadClassification';
import type { Lead, LeadStatus } from './leads.types';

/**
 * Sincroniza el ESTADO comercial del lead con lo que el asesor escribió en la
 * bitácora de SmartHome. Transiciones (elegidas por el negocio):
 *   - No interesado  → lost      (no dispara nada a Meta)
 *   - Agendado       → scheduled (dispara conversión "Schedule" a Meta vía trigger)
 *   - Interesado     → qualified (dispara conversión "Lead" a Meta vía trigger)
 *
 * SALVAGUARDAS (para que una mala clasificación no haga daño):
 *   - Nunca toca leads `closed` (venta) — no se degrada una venta.
 *   - Solo AVANZA: no baja de un estado más avanzado (no marca `qualified` a un
 *     `scheduled`, ni `lost` a un `scheduled`/`closed`).
 *   - Idempotente: si ya está en el estado destino, no escribe.
 * El cambio de estado lo detecta `onLeadStatusChanged` y, si el lead trae
 * `ctwa_clid`, envía la conversión a Meta.
 */

/** Estados desde los que se permite cada destino (solo avanzar, nunca degradar). */
const ALLOWED_FROM: Record<'lost' | 'scheduled' | 'qualified', Set<LeadStatus>> = {
  lost:      new Set<LeadStatus>(['new', 'active', 'qualified']),   // no degradar scheduled/closed
  scheduled: new Set<LeadStatus>(['new', 'active', 'qualified']),
  qualified: new Set<LeadStatus>(['new', 'active']),
};
const SYNCABLE = new Set<LeadStatus>(['lost', 'scheduled', 'qualified']);

export interface BitacoraStatusChange {
  leadId: string;
  name: string;
  phone: string;
  from: LeadStatus;
  to: LeadStatus;
  signal: string;
  reason: string | null;
  note: string;
}

export interface BitacoraSyncResult {
  companyId: string;
  scanned: number;
  changes: BitacoraStatusChange[];
  applied: boolean;
}

/**
 * Escanea los leads 317 con prospecto en SmartHome, clasifica su última bitácora
 * y actualiza el estado según las reglas. `dryRun` = solo devuelve qué cambiaría.
 */
export async function syncBitacoraStatus(companyId: string, dryRun: boolean): Promise<BitacoraSyncResult> {
  const leadsCol = db.collection('companies').doc(companyId).collection('leads');
  const snap = await leadsCol.get();
  const leads = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Lead))
    .filter(countsAs317LineLead)
    .filter((l) => l.smartHomeProspectId && l.status !== 'closed');

  const changes: BitacoraStatusChange[] = [];
  const CONC = 10;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, leads.length) }, async () => {
    while (cursor < leads.length) {
      const lead = leads[cursor++];
      const events = await getSmartHomeProspectEvents(
        lead.smartHomeProspectId!,
        (lead as unknown as { smartHomeProjectCode?: string }).smartHomeProjectCode,
      ).catch(() => null);
      if (!events || events.length === 0) continue;

      const noteText = latestAdvisorNoteText(events);
      if (!noteText) continue;
      const cls = classifyBitacora(noteText);
      const target = cls.suggested;
      if (!target || !SYNCABLE.has(target)) continue;
      if (lead.status === target) continue;                         // idempotente
      if (!ALLOWED_FROM[target as 'lost' | 'scheduled' | 'qualified'].has(lead.status)) continue; // solo avanza

      changes.push({
        leadId: lead.id,
        name: lead.name || lead.phone || 'Lead',
        phone: lead.phone || '',
        from: lead.status,
        to: target,
        signal: cls.signal,
        reason: cls.reason ?? null,
        note: noteText.slice(0, 140),
      });
    }
  }));

  if (!dryRun && changes.length) {
    // Lotes de 400 (límite de batch 500, dejamos margen).
    for (let i = 0; i < changes.length; i += 400) {
      const batch = db.batch();
      for (const ch of changes.slice(i, i + 400)) {
        batch.update(leadsCol.doc(ch.leadId), {
          status: ch.to,
          updatedAt: Timestamp.now(),
          'metadata.bitacoraAutoStatus': ch.signal,
          ...(ch.reason ? { 'metadata.bitacoraAutoReason': ch.reason } : {}),
          'metadata.bitacoraAutoAt': new Date().toISOString(),
        });
      }
      await batch.commit();
    }
    logger.info('[bitacoraStatusSync] estados actualizados desde bitácora', {
      companyId, total: changes.length,
    });
  }

  return { companyId, scanned: leads.length, changes, applied: !dryRun && changes.length > 0 };
}
