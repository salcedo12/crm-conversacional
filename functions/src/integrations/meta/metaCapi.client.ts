import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { MetaCapiCompanyConfig } from '../../modules/companies/channelCredentials.repository';

export interface ConversionEvent {
  /** Evento de mensajería de Meta: 'LeadSubmitted' | 'QualifiedLead' | 'Purchase' (ver STATUS_EVENT). */
  eventName:  string;
  /** ctwa_clid guardado del anuncio "Click to WhatsApp" que originó el lead. */
  ctwaClid:   string;
  /** Momento del evento (segundos epoch). Default: ahora. */
  eventTime?: number;
  /** Valor de la venta (solo para Purchase). */
  value?:     number;
  /** Id del lead, para deduplicación en Meta. */
  eventId?:   string;
}

/** Meta rechaza eventos con event_time de más de 7 días; dejamos margen. */
const MAX_EVENT_AGE_S = 6 * 86_400;

/**
 * Envía una conversión a Meta vía Conversions API para un lead que vino de un
 * anuncio "Click to WhatsApp". Usa action_source=business_messaging +
 * messaging_channel=whatsapp + user_data.ctwa_clid — así Meta atribuye el cierre
 * al anuncio y su algoritmo optimiza por gente que realmente convierte.
 *
 * Devuelve true si Meta aceptó el evento; false ante error (no lanza).
 * Requiere `isMetaCapiConfigured(config)`.
 */
export async function sendConversionEvent(evt: ConversionEvent, config: MetaCapiCompanyConfig): Promise<boolean> {
  if (!config.datasetId || !config.accessToken || !config.pageId) return false;

  const nowS = Math.floor(Date.now() / 1000);
  const eventTime = evt.eventTime && evt.eventTime >= nowS - MAX_EVENT_AGE_S && evt.eventTime <= nowS
    ? evt.eventTime
    : nowS;

  const body: Record<string, unknown> = {
    data: [{
      event_name:        evt.eventName,
      event_time:        eventTime,
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      ...(evt.eventId ? { event_id: evt.eventId } : {}),
      // Meta exige page_id (o whatsapp_business_account_id) de la página del anuncio.
      user_data: { ctwa_clid: evt.ctwaClid, page_id: config.pageId },
      ...(evt.value && evt.value > 0
        ? { custom_data: { currency: config.currency, value: evt.value } }
        : {}),
    }],
    ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
    access_token: config.accessToken,
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${env.metaGraphVersion()}/${config.datasetId}/events`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = (await res.json()) as {
      events_received?: number;
      error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
    };

    if (json.error) {
      logger.error('[metaCapi] Meta rechazó el evento', {
        eventName: evt.eventName, message: json.error.message, code: json.error.code,
        subcode: json.error.error_subcode, detail: json.error.error_user_msg,
      });
      return false;
    }

    logger.info('[metaCapi] Conversión enviada a Meta', {
      eventName: evt.eventName, received: json.events_received, value: evt.value ?? null,
      test: !!config.testEventCode,
    });
    return true;
  } catch (err) {
    logger.error('[metaCapi] Error enviando conversión', {
      eventName: evt.eventName, error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
