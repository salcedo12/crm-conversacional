import * as crypto from 'crypto';

/**
 * Valida la firma HMAC-SHA1 que Twilio incluye en el header
 * X-Twilio-Signature para garantizar que el request viene de Twilio.
 *
 * Algoritmo: https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
 *
 * Pasos:
 * 1. Tomar la URL completa del webhook.
 * 2. Ordenar todos los parámetros POST alfabéticamente y concatenar nombre+valor.
 * 3. Calcular HMAC-SHA1 con el Auth Token como clave secreta.
 * 4. Comparar en tiempo constante contra la firma recibida.
 */
export function validateTwilioSignature(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !twilioSignature) return false;

  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), '');

  const stringToSign = url + sortedParams;

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest('base64');

  // Comparación en tiempo constante para prevenir timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf-8'),
      Buffer.from(twilioSignature, 'utf-8')
    );
  } catch {
    return false;
  }
}

/**
 * Reconstruye la URL del webhook desde el objeto Request de Express.
 * Cloud Run siempre usa HTTPS, pero el proxy puede reportar HTTP internamente.
 */
export function getWebhookUrl(req: {
  protocol: string;
  headers: Record<string, string | string[] | undefined>;
  originalUrl: string;
}): string {
  // Cloud Run siempre recibe tráfico HTTPS — forzar protocolo correcto
  const host = req.headers['x-forwarded-host'] ?? req.headers['host'] ?? '';
  const proto = 'https';
  return `${proto}://${host}${req.originalUrl}`;
}
