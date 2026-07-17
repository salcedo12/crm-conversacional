import * as https from 'https';
import { env }    from '../../config/env';
import { logger } from '../../utils/logger';
import { toTwilioPhone } from '../../utils/phone';

interface TwilioSendResult {
  sid:    string;
  status: string;
}

/**
 * Cliente HTTP para la API de Twilio.
 * Usa el módulo nativo `https` para evitar cargar el SDK completo.
 */
export class TwilioClient {
  private readonly accountSid: string;
  private readonly authToken:  string;
  private readonly from:       string;

  constructor() {
    this.accountSid = env.twilioAccountSid();
    this.authToken  = env.twilioAuthToken();
    this.from       = env.twilioFromNumber();
  }

  /**
   * Envía un mensaje de texto (y opcionalmente media) por WhatsApp.
   * @param mediaUrl URL pública accesible por Twilio (Firebase Storage download URL)
   */
  async sendWhatsApp(
    to:       string,
    body:     string,
    mediaUrl?: string
  ): Promise<TwilioSendResult> {
    if (!this.accountSid || !this.authToken) {
      logger.warn('[Twilio] Sin credenciales — mensaje no enviado (modo mock)', { to });
      return { sid: 'mock', status: 'mock' };
    }

    const toFormatted = toTwilioPhone(to);
    const params: Record<string, string> = {
      From: this.from,
      To:   toFormatted,
      Body: body,
    };
    if (mediaUrl) params.MediaUrl = mediaUrl;

    const bodyStr = new URLSearchParams(params).toString();
    const auth    = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    return new Promise<TwilioSendResult>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'api.twilio.com',
        path:     `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
          Authorization:    `Basic ${auth}`,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              sid?:           string;
              status?:        string;
              error_message?: string;
            };
            const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
            if (ok) {
              logger.info('[Twilio] Mensaje enviado', { to: toFormatted, sid: parsed.sid });
              resolve({ sid: parsed.sid ?? '', status: parsed.status ?? 'sent' });
            } else {
              reject(new Error(`Twilio HTTP ${res.statusCode} — ${parsed.error_message ?? data}`));
            }
          } catch {
            reject(new Error(`Twilio parse error: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * Descarga el contenido de una URL de media de Twilio (requiere autenticación Basic).
   * Usado para guardar media entrante en Firebase Storage.
   */
  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    return new Promise<Buffer>((resolve, reject) => {
      const options = new URL(mediaUrl);
      const reqOptions: https.RequestOptions = {
        hostname: options.hostname,
        path:     options.pathname + options.search,
        method:   'GET',
        headers:  { Authorization: `Basic ${auth}` },
      };

      const req = https.request(reqOptions, (res) => {
        // Manejar redirecciones (Twilio a veces redirige a S3)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (!redirectUrl) { reject(new Error('Redirect sin Location')); return; }
          https.get(redirectUrl, (res2) => {
            const chunks: Buffer[] = [];
            res2.on('data', (c: Buffer) => chunks.push(c));
            res2.on('end', () => resolve(Buffer.concat(chunks)));
            res2.on('error', reject);
          }).on('error', reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.end();
    });
  }
}

// Singleton lazy
let _client: TwilioClient | null = null;
export const getTwilioClient = (): TwilioClient => {
  if (!_client) _client = new TwilioClient();
  return _client;
};
