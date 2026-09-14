import * as https from 'https';
import { env }    from '../../config/env';
import { logger } from '../../utils/logger';
import { getYcloudConfigForCompany } from '../../modules/companies/channelCredentials.repository';
import { getChannelRoute } from '../../modules/companies/companyRouting';
import { normalizeBusinessNumber } from '../../modules/whatsapp/inbox';

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
export interface YcloudClientConfig {
  apiKey: string;
  from:   string;
}

export class YcloudClient {
  private readonly apiKey:  string;
  private readonly from:    string;

  constructor(config?: Partial<YcloudClientConfig>) {
    this.apiKey = config?.apiKey ?? env.ycloudApiKey();
    this.from   = config?.from   ?? env.ycloudFromNumber();
  }

  /** Número (+E.164) desde el que envía este cliente. Para etiquetar el mensaje con la línea real usada. */
  get fromNumber(): string { return this.from; }

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

  /**
   * Construye el destinatario del envío. El destino puede ser un número (E.164) o
   * un BSUID de WhatsApp (cliente que oculta su número por privacidad de nombre de
   * usuario). El BSUID tiene forma "CC.alfa" (código de país en letras + punto +
   * alfanumérico, ej. "CO.2370523146805161") y NUNCA colisiona con un teléfono
   * (que es solo dígitos). YCloud usa el campo `recipient` para BSUID y `to` para
   * número. Ver https://docs.ycloud.com/reference/whatsapp_message-send-directly
   */
  private destinationField(dest: string): { to: string } | { recipient: string } {
    const d = dest.trim();
    if (/^[A-Za-z]{2}\.[A-Za-z0-9]+$/.test(d)) return { recipient: d };
    return { to: `+${normalizePhone(d)}` };
  }

  private destinationLabel(dest: { to: string } | { recipient: string }): string {
    return 'recipient' in dest ? dest.recipient : dest.to;
  }

  // ─── Enviar texto ──────────────────────────────────────────────────────────

  async sendText(to: string, body: string): Promise<YcloudSendResult> {
    const dest = this.destinationField(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        ...dest,
        type: 'text',
        text: { body },
      }
    );
    logger.info('[ycloud] Texto enviado', { to: this.destinationLabel(dest), id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Enviar media ──────────────────────────────────────────────────────────

  async sendMedia(
    to:        string,
    mediaUrl:  string,
    mimeType:  string,
    caption?:  string,
    fileName?: string
  ): Promise<YcloudSendResult> {
    const dest = this.destinationField(to);
    const type  = mimeToYcloudType(mimeType);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        ...dest,
        type,
        [type]: {
          link: mediaUrl,
          ...(caption ? { caption } : {}),
          // WhatsApp muestra este nombre en el documento; sin él pone uno genérico.
          ...(type === 'document' && fileName ? { filename: fileName } : {}),
        },
      }
    );
    logger.info('[ycloud] Media enviada', { to: this.destinationLabel(dest), type, id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Enviar reacción (emoji) a un mensaje del cliente ───────────────────────
  // `messageId` es el wamid del mensaje al que se reacciona. emoji vacío = quitar.

  async sendReaction(to: string, messageId: string, emoji: string): Promise<YcloudSendResult> {
    const dest = this.destinationField(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        ...dest,
        type: 'reaction',
        reaction: { message_id: messageId, emoji },
      }
    );
    logger.info('[ycloud] Reacción enviada', { to: this.destinationLabel(dest), emoji: emoji || '(quitada)', id: res.id });
    return { id: res.id, status: res.status };
  }

  // ─── Enviar plantilla ─────────────────────────────────────────────────────

  async sendTemplate(
    to:           string,
    templateName: string,
    languageCode: string,
    components:   unknown[]
  ): Promise<YcloudSendResult> {
    const dest = this.destinationField(to);
    const res = await this.request<{ id: string; status: string }>(
      'POST', '/v2/whatsapp/messages',
      {
        from: this.from,
        ...dest,
        type: 'template',
        template: {
          name:       templateName,
          language:   { code: languageCode },
          components: components.length > 0 ? components : undefined,
        },
      }
    );
    logger.info('[ycloud] Plantilla enviada', { to: this.destinationLabel(dest), templateName, id: res.id });
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

// Singleton con la cuenta GLOBAL (variables de entorno). Se usa para envíos que
// no dependen de una empresa concreta (p. ej. alertas internas de error).
let _client: YcloudClient | null = null;
export const getYcloudClient = (): YcloudClient => {
  if (!_client) _client = new YcloudClient();
  return _client;
};

/**
 * Cliente YCloud para una EMPRESA concreta: usa su API key + número propios si
 * los tiene en `channelCredentials/{companyId}`, o cae a la cuenta global.
 * Es el que deben usar todos los envíos ligados a un lead/empresa para soportar
 * múltiples cuentas de YCloud (real, demo, etc.) a la vez.
 */
export const getYcloudClientForCompany = async (companyId: string): Promise<YcloudClient> => {
  const cfg = await getYcloudConfigForCompany(companyId);
  return new YcloudClient({ apiKey: cfg.apiKey, from: cfg.fromNumber });
};

/**
 * Cliente YCloud que envía desde el NÚMERO correcto según el inbox del lead.
 *
 * Un lead de la línea 317 tiene `inboxId` = número por defecto → sale por el 317
 * (sin lecturas extra). Un lead de una LÍNEA DE ASESOR en coexistencia tiene
 * `inboxId` = número personal del asesor → sale por ESE número (misma API key /
 * mismo WABA, solo cambia el `from`). Esto evita que las plantillas/videos/masivos
 * de la asesora salgan por el 317 y se crucen las conversaciones.
 *
 * Solo se sobre-escribe el `from` si el inbox está registrado como ruta activa de
 * ESTA empresa; un `inboxId` desconocido cae al número por defecto (nunca se
 * intenta enviar desde un número no registrado, que YCloud rechazaría).
 *
 * PROPIEDAD DE LÍNEA: una línea de COEXISTENCIA es PERSONAL de un asesor. Solo su
 * dueño puede enviar desde ella. Si `senderAdvisorId` no es el dueño (otro asesor,
 * admin, o un envío automático sin asesor), se envía por el 317 — así nadie manda
 * mensajes "desde el WhatsApp de otro".
 */
export const getYcloudClientForInbox = async (
  companyId: string,
  inboxId?: string | null,
  senderAdvisorId?: string,
): Promise<YcloudClient> => {
  const cfg = await getYcloudConfigForCompany(companyId);
  let from = cfg.fromNumber;

  const norm        = normalizeBusinessNumber(inboxId);
  const defaultNorm = normalizeBusinessNumber(cfg.fromNumber);
  if (norm && norm !== defaultNorm) {
    const route = await getChannelRoute('ycloud', norm);
    if (route && route.active !== false && route.companyId === companyId) {
      if (route.kind === 'advisor_coexistence' && route.advisorId && route.advisorId !== senderAdvisorId) {
        // Línea personal de OTRO asesor → NO enviar desde su número; usar el 317.
        logger.warn('[ycloud] inbox es línea personal de otro asesor; se envía por el 317', {
          companyId, inboxId: norm, owner: route.advisorId, sender: senderAdvisorId ?? '(automático)',
        });
      } else {
        from = norm;
      }
    } else {
      logger.warn('[ycloud] inboxId no registrado para la empresa; se envía por el número por defecto', {
        companyId, inboxId: norm,
      });
    }
  }

  return new YcloudClient({ apiKey: cfg.apiKey, from });
};
