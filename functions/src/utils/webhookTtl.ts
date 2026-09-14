import { Timestamp } from 'firebase-admin/firestore';

/**
 * Los documentos de `webhookEvents` son solo marcas anti-duplicado (un id por
 * evento recibido, para no procesarlo dos veces). NO contienen la conversación:
 * los mensajes viven permanentemente en `.../messages`. Por eso pueden caducar.
 *
 * Este `expireAt` lo consume una política TTL de Firestore sobre la colección
 * `webhookEvents`, que borra automáticamente los docs vencidos. Ver el paso de
 * activación de la política en la doc/README de deploy.
 */
export const WEBHOOK_EVENT_TTL_DAYS = 30;

export function webhookEventExpireAt(): Timestamp {
  return Timestamp.fromMillis(Date.now() + WEBHOOK_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000);
}
