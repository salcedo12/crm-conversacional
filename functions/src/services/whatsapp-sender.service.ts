import * as https from 'https';

/**
 * Envía mensajes de texto a un número de WhatsApp via Meta Cloud API.
 * Requiere: WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_TOKEN en env.
 */
export class WhatsAppSenderService {
  private readonly phoneNumberId: string;
  private readonly token: string;
  private readonly apiVersion = 'v19.0';

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
    this.token = process.env.WHATSAPP_TOKEN ?? '';
  }

  async sendText(to: string, message: string): Promise<void> {
    if (!this.phoneNumberId || !this.token) {
      console.warn('[WhatsAppSender] Credenciales no configuradas — mensaje no enviado.');
      console.log(`[WhatsAppSender MOCK] → ${to}: ${message}`);
      return;
    }

    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: message },
    });

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: 'graph.facebook.com',
        path: `/${this.apiVersion}/${this.phoneNumberId}/messages`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[WhatsAppSender] Mensaje enviado a ${to}`);
            resolve();
          } else {
            reject(new Error(`Meta API error ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
