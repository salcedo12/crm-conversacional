import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface ConversionEvent {
  /** Nombre estándar de Meta: 'Lead' | 'Schedule' | 'Purchase' (o personalizado). */
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

/**
 * Envía una conversión a Meta vía Conversions API para un lead que vino de un
 * anuncio "Click to WhatsApp". Usa action_source=business_messaging +
 * messaging_channel=whatsapp + user_data.ctwa_clid — así Meta atribuye el cierre
 * al anuncio y su algoritmo optimiza por gente que realmente convierte.
 *
 * Devuelve true si Meta aceptó el evento; false ante error (no lanza).
 * Requiere `metaCapiConfigured()`.
 */
export async function sendConversionEvent(evt: ConversionEvent): Promise<boolean> {
  if (!env.metaCapiConfigured()) return false;

  const version   = env.metaGraphVersion();
  const datasetId = env.metaCapiDatasetId();
  const token     = env.metaCapiAccessToken();
  const testCode  = env.metaCapiTestCode();

  const body: Record<string, unknown> = {
    data: [{
      event_name:        evt.eventName,
      event_time:        evt.eventTime ?? Math.floor(Date.now() / 1000),
      action_source:     'business_messaging',
      messaging_channel: 'whatsapp',
      ...(evt.eventId ? { event_id: evt.eventId } : {}),
      user_data: { ctwa_clid: evt.ctwaClid },
      ...(evt.value && evt.value > 0
        ? { custom_data: { currency: env.metaCapiCurrency(), value: evt.value } }
        : {}),
    }],
    ...(testCode ? { test_event_code: testCode } : {}),
    access_token: token,
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${datasetId}/events`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = (await res.json()) as { events_received?: number; error?: { message?: string; code?: number } };

    if (json.error) {
      logger.error('[metaCapi] Meta rechazó el evento', {
        eventName: evt.eventName, message: json.error.message, code: json.error.code,
      });
      return false;
    }

    logger.info('[metaCapi] Conversión enviada a Meta', {
      eventName: evt.eventName, received: json.events_received,
    });
    return true;
  } catch (err) {
    logger.error('[metaCapi] Error enviando conversión', {
      eventName: evt.eventName, error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
