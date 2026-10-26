import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { sendConversionEvent } from '../../integrations/meta/metaCapi.client';
import { getSmartHomeSaleForProspect } from '../../integrations/smarthome/smarthome.client';
import { getMetaCapiConfigForCompany, isMetaCapiConfigured } from '../companies/channelCredentials.repository';
import type { Lead, LeadStatus } from '../leads/leads.types';

/**
 * Estado del lead → evento de Meta que se envía como conversión.
 * Con action_source=business_messaging Meta solo acepta LeadSubmitted,
 * QualifiedLead, ViewContent, InitiateCheckout, AddToCart y Purchase
 * ('Lead' y 'Schedule' se rechazan con subcode 2804066).
 */
export const STATUS_EVENT: Partial<Record<LeadStatus, string>> = {
  qualified: 'LeadSubmitted',  // interesado (IA / bitácora)
  scheduled: 'QualifiedLead',  // agendó cita: el lead de calidad que optimiza Meta
  closed:    'Purchase',       // venta cerrada
};

export type LeadConversionResult =
  | { status: 'sent'; eventName: string; value?: number }
  | { status: 'skipped'; reason: 'not_configured' | 'no_event' | 'no_ctwa_clid' | 'already_sent' }
  | { status: 'failed'; eventName: string };

/** "2026-10-19T12:27:00.337" de SmartHome viene sin zona: es hora de Bogotá. */
function smartHomeDateToEpochS(value: string | null): number | undefined {
  if (!value) return undefined;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}-05:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/**
 * Valor de la venta: primero el corregido a mano en el informe de comisiones
 * (`sales_reports/{prospectId}`), luego el valor neto de SmartHome.
 */
async function resolveSaleValue(companyId: string, lead: Lead): Promise<{ value?: number; eventTime?: number }> {
  const prospectId = lead.smartHomeProspectId;
  if (!prospectId) return {};

  const saved = await db.collection(`companies/${companyId}/sales_reports`).doc(prospectId).get().catch(() => null);
  const savedValue = Number(saved?.data()?.totalValue ?? 0);

  // SmartHome a veces corta por tiempo: un reintento antes de enviar sin valor.
  const projectHint = lead.smartHomeProjectCode || env.smartHomeProject();
  const lookup = () => getSmartHomeSaleForProspect(prospectId, projectHint).catch(() => null);
  const sale = (await lookup()) ?? (await lookup());
  const value = savedValue > 0 ? savedValue : sale?.value;
  return { value, eventTime: smartHomeDateToEpochS(sale?.closeDate ?? null) };
}

/**
 * Envía a Meta (CAPI) la conversión correspondiente al estado actual del lead,
 * si vino de un anuncio "Click to WhatsApp" (tiene ctwa_clid). Idempotente por
 * lead + evento: marca `capiEvents.<evento>` al confirmar Meta.
 */
export async function sendLeadConversion(
  companyId: string,
  leadId: string,
  lead: Lead,
): Promise<LeadConversionResult> {
  const config = await getMetaCapiConfigForCompany(companyId);
  if (!isMetaCapiConfigured(config)) return { status: 'skipped', reason: 'not_configured' };

  const eventName = STATUS_EVENT[lead.status];
  if (!eventName) return { status: 'skipped', reason: 'no_event' };

  // Sin ctwa_clid no hay forma de atribuir la conversión al anuncio.
  const ctwaClid = lead.sourceMeta?.ctwaClid;
  if (!ctwaClid) return { status: 'skipped', reason: 'no_ctwa_clid' };

  if (lead.capiEvents?.[eventName]) return { status: 'skipped', reason: 'already_sent' };

  const { value, eventTime } = eventName === 'Purchase' ? await resolveSaleValue(companyId, lead) : {};
  if (eventName === 'Purchase' && !value) {
    logger.warn('[CAPI] Venta sin valor en SmartHome; se envía Purchase sin valor', { companyId, leadId });
  }

  const ok = await sendConversionEvent({
    eventName,
    ctwaClid,
    eventTime,
    value,
    eventId: `${leadId}:${eventName}`,   // dedupe en Meta
  }, config);

  if (!ok) return { status: 'failed', eventName };

  // Los eventos de prueba (test_event_code) no se marcan: no cuentan para Meta.
  if (!config.testEventCode) {
    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).update({
      [`capiEvents.${eventName}`]: Timestamp.now(),
    });
  }
  return { status: 'sent', eventName, value };
}
