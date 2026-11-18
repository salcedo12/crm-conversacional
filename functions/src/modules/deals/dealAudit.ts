import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { postLeadSmartHomeBitacora } from '../smarthome/smarthomeEvents.service';
import type { Lead } from '../leads/leads.types';

export type DealActivityEvent =
  | 'created'
  | 'buyers_saved'
  | 'lot_reserved'
  | 'lot_released'
  | 'plan_saved'
  | 'document_generated'
  | 'document_deleted'
  | 'attachment_uploaded'
  | 'attachment_deleted'
  | 'cancelled'
  | 'sent_to_signature'
  | 'signature_update'
  | 'advisor_reassigned';

export interface DealActivityInput {
  companyId:       string;
  leadId:          string;
  dealId:          string;
  actorId:         string;
  actorName:       string;
  event:           DealActivityEvent;
  title:           string;
  lines?:          string[];
  createdAt?:      Timestamp;
  syncToSmartHome?: boolean;
}

export const leadRef = (companyId: string, leadId: string) =>
  db.collection('companies').doc(companyId).collection('leads').doc(leadId);

export const dealActivityRef = (companyId: string, leadId: string) =>
  leadRef(companyId, leadId).collection('notes').doc();

/** Fecha/hora local de Bogotá en formato compatible con los parseadores de bitácora y Gestión Comercial. */
export function bogotaNowString(ms = Date.now()): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** Deduplica arreglos de bitácora preservando el orden más reciente al frente. */
export function mergeBitacoraLists(
  existingSources: unknown[],
  prependEntry?: Record<string, unknown>,
  limit = 60,
): Record<string, unknown>[] {
  const combined: unknown[] = [...(prependEntry ? [prependEntry] : [])];
  for (const src of existingSources) {
    if (Array.isArray(src)) combined.push(...src);
  }
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const b of combined) {
    if (!b || typeof b !== 'object') continue;
    const item = b as Record<string, unknown>;
    const key = `${String(item.action || '').trim()}|${String(item.description || '').trim()}|${String(item.fecha || item.lastDate || '').slice(0, 16)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Documento que aparece en "Bitácora del negocio" y "Bitácora & historial" de la ficha del lead. */
export function dealActivityDoc(input: DealActivityInput) {
  const lines = (input.lines ?? []).filter(Boolean);
  return {
    companyId: input.companyId,
    leadId: input.leadId,
    dealId: input.dealId,
    kind: 'note',
    type: 'deal_activity',
    actionType: 'negocio',
    dealEvent: input.event,
    text: [`NEGOCIO · ${input.title}`, ...lines.map((line) => `• ${line}`)].join('\n'),
    authorId: input.actorId,
    authorName: input.actorName,
    createdAt: input.createdAt ?? Timestamp.now(),
  };
}

/**
 * Sincroniza un evento del módulo Negocios con:
 * 1) La ficha del lead (`bitacoras`, `metadata.smarthomeBitacoras`, últimos seguimientos)
 *    para que "Línea de Tiempo de Gestiones" y "Falta Seguimiento" estén al día.
 * 2) La bitácora de SmartHome (best-effort, no bloquea el flujo del CRM).
 */
export async function syncDealActivityToLeadAndSmartHome(input: DealActivityInput): Promise<void> {
  if (!input.companyId || !input.leadId) return;
  try {
    const lRef = leadRef(input.companyId, input.leadId);
    const snap = await lRef.get();
    if (!snap.exists) return;

    const leadData = snap.data() as Record<string, any>;
    const nowTs = input.createdAt ?? Timestamp.now();
    const nowFormatted = bogotaNowString(nowTs.toMillis());
    const cleanLines = (input.lines ?? []).filter(Boolean);
    const description = (cleanLines.join(' · ') || input.title).slice(0, 600);
    const actionLabel = `Negocio · ${input.title}`;
    const entry: Record<string, unknown> = {
      id_registro: `deal_${input.dealId}_${nowTs.toMillis()}`,
      origen: 'CRM',
      fecha: nowFormatted,
      lastDate: nowFormatted,
      action: actionLabel,
      description,
      asesor: input.actorName,
      dealId: input.dealId,
      dealEvent: input.event,
    };

    const updatedBitacoras = mergeBitacoraLists([
      leadData.bitacoras,
      leadData.metadata?.smarthomeBitacoras,
      leadData.smarthomeBitacoras,
    ], entry);

    const isHumanActor = input.actorId !== 'docublock' && input.actorId !== 'system';
    const leadPatch: Record<string, unknown> = {
      bitacoras: updatedBitacoras,
      'metadata.smarthomeBitacoras': updatedBitacoras,
      'metadata.hasFicha': true,
      smartHomeLastBitacoraAt: nowTs,
      smartHomeLastBitacoraBy: input.actorId,
      smartHomeLastBitacoraByName: input.actorName,
      smartHomeLastBitacoraText: description.slice(0, 240),
      smartHomeLastActionLabel: actionLabel,
      smartHomeTrackingUpdatedAt: nowTs,
      ...(isHumanActor ? {
        lastFollowUpAt: nowTs,
        lastFollowUpAction: actionLabel,
        lastFollowUpSummary: `${actionLabel}: ${description}`.slice(0, 240),
        lastFollowUpAuthor: input.actorName,
        aiTakeoverSlaStatus: 'compliant',
      } : {}),
      updatedAt: nowTs,
    };

    await lRef.update(leadPatch);

    if (input.syncToSmartHome !== false) {
      const leadObj: Lead = { ...(leadData as Lead), id: input.leadId, companyId: input.companyId };
      await postLeadSmartHomeBitacora(leadObj, `[CRM · ${actionLabel}] ${description}`).catch((err) => {
        logger.warn('[DealAudit] No se pudo sincronizar bitácora a SmartHome', {
          dealId: input.dealId,
          leadId: input.leadId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (err) {
    logger.warn('[DealAudit] No se pudo sincronizar evento del negocio a la ficha del lead', {
      dealId: input.dealId,
      leadId: input.leadId,
      event: input.event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Escribe la nota de auditoría en `leads/{id}/notes` y sincroniza ficha + Gestión Comercial + SmartHome. */
export async function writeDealActivity(input: DealActivityInput): Promise<void> {
  await dealActivityRef(input.companyId, input.leadId).set(dealActivityDoc(input));
  await syncDealActivityToLeadAndSmartHome(input);
}

export function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString('es-CO')}`;
}
