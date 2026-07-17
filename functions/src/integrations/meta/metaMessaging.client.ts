import * as https from 'https';
import { env }    from '../../config/env';
import { logger } from '../../utils/logger';

const GRAPH_API_HOST    = 'graph.facebook.com';
const GRAPH_API_VERSION = 'v21.0';

export interface MetaSendResult {
  id:     string;
  status: string;
}

/**
 * Cliente HTTP para el Send API de Meta (Messenger Platform / Instagram Messaging).
 * Un mismo endpoint (`/me/messages` con el Page Access Token) sirve tanto para
 * Messenger como para Instagram Direct, porque la cuenta de Instagram Business
 * está vinculada a la misma Página.
 * Docs: https://developers.facebook.com/docs/messenger-platform/send-messages
 */
export class MetaMessagingClient {
  private readonly accessToken: string;

  constructor() {
    this.accessToken = env.metaPageAccessToken();
  }

  private request<T>(body: unknown): Promise<T> {
    const bodyStr = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const opts: https.RequestOptions = {
        hostname: GRAPH_API_HOST,
        path:     `/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(this.accessToken)}`,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', (c: string) => d += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(d) as T & { error?: { message: string; code: number } };
            if (res.statusCode && res.statusCode >= 400) {
              const errMsg = (parsed as unknown as { error?: { message: string } }).error?.message ?? d;
              reject(new Error(`meta HTTP ${res.statusCode}: ${errMsg}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`meta parse error: ${d.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  // ─── Enviar texto ──────────────────────────────────────────────────────────

  async sendText(recipientId: string, text: string): Promise<MetaSendResult> {
    const res = await this.request<{ recipient_id: string; message_id: string }>({
      recipient:      { id: recipientId },
      message:        { text },
      messaging_type: 'RESPONSE',
    });
    logger.info('[meta] Texto enviado', { to: recipientId, id: res.message_id });
    return { id: res.message_id, status: 'sent' };
  }

  // ─── Enviar media ──────────────────────────────────────────────────────────
  // Meta descarga la URL directamente (is_reusable evita volver a subirla en envíos futuros).

  async sendMedia(recipientId: string, mediaUrl: string, mimeType: string): Promise<MetaSendResult> {
    const type = mimeToMetaAttachmentType(mimeType);
    const res = await this.request<{ recipient_id: string; message_id: string }>({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type,
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
      messaging_type: 'RESPONSE',
    });
    logger.info('[meta] Media enviada', { to: recipientId, type, id: res.message_id });
    return { id: res.message_id, status: 'sent' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mimeToMetaAttachmentType(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// Singleton
let _client: MetaMessagingClient | null = null;
export const getMetaMessagingClient = (): MetaMessagingClient => {
  if (!_client) _client = new MetaMessagingClient();
  return _client;
};
