import * as https from 'https';
import { env }    from '../../config/env';
import { logger } from '../../utils/logger';

const YCLOUD_API = 'api.ycloud.com';

export interface YcloudSendResult {
  id:     string;
  status: string;
}

export type YcloudTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type YcloudTemplateStatus =
  | 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL';

export interface YcloudTemplateButton {
  type:          'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text?:         string;
  url?:          string;
  phone_number?: string;
  example?:      string[];
}

export interface YcloudTemplateComponent {
  type:     'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?:  'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?:    string;
  example?: { header_text?: string[]; header_url?: string[]; body_text?: string[][] };
  buttons?: YcloudTemplateButton[];
}

export interface YcloudTemplate {
  id?:        string;
  wabaId?:    string;
  name:       string;
  language:   string;
  category:   YcloudTemplateCategory;
  status?:    YcloudTemplateStatus;
  components: YcloudTemplateComponent[];
}

export interface CreateYcloudTemplateInput {
  wabaId:     string;
  name:       string;
  language:   string;
  category:   YcloudTemplateCategory;
  components: YcloudTemplateComponent[];
}

// ─── WhatsApp Calling (voz vía WebRTC) ──────────────────────────────────────
// Docs: https://docs.ycloud.com/reference/whatsapp-calling-examples

export interface YcloudCallResult {
  id:        string;
  wacid?:    string;
  phoneId?:  string;
  status?:   string;
  sdpType?:  string;
  sdp?:      string;
}

/**
 * Cliente HTTP para la API de ycloud WhatsApp.
 * Docs: https://docs.ycloud.com/reference/whatsapp-messages
 */
export class YcloudClient {
  private readonly apiKey:  string;
  private readonly from:    string;

  constructor() {
    this.apiKey = env.ycloudApiKey();
    this.from   = env.ycloudFromNumber();
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const opts: https.RequestOptions = {
        hostname: YCLOUD_API,
        path,
        method,
        headers: {
          'X-API-Key':    this.apiKey,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', (c: string) => d += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(d) as T & { error?: { message: string; code: number } };
            if (res.statusCode && res.statusCode >= 400) {
              const errMsg = (parsed as { message?: string }).message ?? d;
              reject(new Error(`ycloud HTTP ${res.statusCode}: ${errMsg}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`ycloud parse error: ${d.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ─── Enviar texto ──────────────────────────────────────────────────────────

  async sendText(to: string, body: string): Promise<YcloudSendResult> {
    const phone = normalizePhone(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        to:   `+${phone}`,
        type: 'text',
        text: { body },
      }
    );
    logger.info('[ycloud] Texto enviado', { to: phone, id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Enviar media ──────────────────────────────────────────────────────────

  async sendMedia(
    to:        string,
    mediaUrl:  string,
    mimeType:  string,
    caption?:  string
  ): Promise<YcloudSendResult> {
    const phone = normalizePhone(to);
    const type  = mimeToYcloudType(mimeType);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        to:   `+${phone}`,
        type,
        [type]: { link: mediaUrl, ...(caption ? { caption } : {}) },
      }
    );
    logger.info('[ycloud] Media enviada', { to: phone, type, id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Enviar plantilla ─────────────────────────────────────────────────────

  async sendTemplate(
    to:           string,
    templateName: string,
    languageCode: string,
    components:   unknown[]
  ): Promise<YcloudSendResult> {
    const phone = normalizePhone(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        to:   `+${phone}`,
        type: 'template',
        template: {
          name:       templateName,
          language:   { code: languageCode },
          components: components.length > 0 ? components : undefined,
        },
      }
    );
    logger.info('[ycloud] Plantilla enviada', { to: phone, templateName, id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Crear plantilla (la envía a Meta para aprobación) ──────────────────────

  async createTemplate(input: CreateYcloudTemplateInput): Promise<YcloudTemplate> {
    const res = await this.request<YcloudTemplate>(
      'POST', '/v2/whatsapp/templates', input
    );
    logger.info('[ycloud] Plantilla creada', { name: input.name, status: res.status });
    return res;
  }

  // ─── Listar plantillas de un WABA ───────────────────────────────────────────

  async listTemplates(wabaId: string): Promise<YcloudTemplate[]> {
    const res = await this.request<{ items?: YcloudTemplate[] }>(
      'GET',
      `/v2/whatsapp/templates?limit=100&filter.wabaId=${encodeURIComponent(wabaId)}`
    );
    return res.items ?? [];
  }

  // ─── Llamada de voz: iniciar (saliente, el negocio manda el SDP offer) ──────

  async connectCall(input: { from: string; to: string; sdp: string }): Promise<YcloudCallResult> {
    const res = await this.request<YcloudCallResult>(
      'POST', '/v2/whatsapp/calls/connect',
      { from: input.from, to: input.to, sdpType: 'offer', sdp: input.sdp }
    );
    logger.info('[ycloud] Llamada saliente conectada', { to: input.to, id: res.id });
    return res;
  }

  // ─── Llamada de voz: pre-aceptar entrante (SDP answer temprano) ─────────────

  async preAcceptCall(input: { phoneId: string; sdp: string }): Promise<YcloudCallResult> {
    return this.request<YcloudCallResult>(
      'POST', '/v2/whatsapp/calls/preAccept',
      { phoneId: input.phoneId, sdpType: 'answer', sdp: input.sdp }
    );
  }

  // ─── Llamada de voz: aceptar entrante (confirmación final) ──────────────────

  async acceptCall(input: { phoneId: string; wacid: string }): Promise<YcloudCallResult> {
    return this.request<YcloudCallResult>(
      'POST', '/v2/whatsapp/calls/accept',
      { phoneId: input.phoneId, wacid: input.wacid, sdpType: 'answer' }
    );
  }

  // ─── Llamada de voz: rechazar entrante ───────────────────────────────────────

  async rejectCall(input: { phoneId: string; wacid: string }): Promise<YcloudCallResult> {
    return this.request<YcloudCallResult>(
      'POST', '/v2/whatsapp/calls/reject',
      { phoneId: input.phoneId, wacid: input.wacid }
    );
  }

  // ─── Llamada de voz: terminar (cualquier dirección) ──────────────────────────

  async terminateCall(input: { phoneId: string; wacid: string }): Promise<YcloudCallResult> {
    return this.request<YcloudCallResult>(
      'POST', '/v2/whatsapp/calls/terminate',
      { phoneId: input.phoneId, wacid: input.wacid }
    );
  }

  // ─── Solicitar permiso de llamada al usuario (mensaje interactivo) ──────────
  // Payload inferido de la doc de Meta/YCloud — verificar contra un envío real
  // antes de confiar del todo en el nombre exacto de los campos.

  async requestCallPermission(from: string, to: string, bodyText: string): Promise<YcloudSendResult> {
    const phone = normalizePhone(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from,
        to:   `+${phone}`,
        type: 'interactive',
        interactive: {
          type:   'call_permission_request',
          body:   { text: bodyText },
          action: { name: 'call_permission_request' },
        },
      }
    );
    logger.info('[ycloud] Solicitud de permiso de llamada enviada', { to: phone, id: res.id });
    return { id: res.id, status: res.status };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/^whatsapp:/i, '').replace(/^\+/, '').replace(/\s/g, '');
}

function mimeToYcloudType(mime: string): string {
  if (mime.startsWith('image/'))   return 'image';
  if (mime.startsWith('video/'))   return 'video';
  if (mime.startsWith('audio/'))   return 'audio';
  if (mime === 'application/pdf')  return 'document';
  return 'document';
}

// Singleton
let _client: YcloudClient | null = null;
export const getYcloudClient = (): YcloudClient => {
  if (!_client) _client = new YcloudClient();
  return _client;
};
