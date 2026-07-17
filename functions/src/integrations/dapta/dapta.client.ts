import * as https from 'https';
import { env }    from '../../config/env';
import { logger } from '../../utils/logger';

export interface DaptaStartCallInput {
  /** Teléfono destino en E.164, ej: +573213443603 */
  phone:      string;
  /** Nombre del contacto (para personalizar el guion del agente). */
  name?:      string;
  /** ID del lead en el CRM — se reenvía para correlacionar el webhook de resultado. */
  leadId:     string;
  companyId:  string;
  /** ID del asesor que dispara la llamada (para trazabilidad). */
  advisorId?: string;
  /** Variables extra que el flujo de Dapta pueda consumir. */
  variables?: Record<string, string>;
}

export interface DaptaStartCallResult {
  ok:          boolean;
  status:      number;
  /** ID de la llamada/ejecución que devuelva Dapta, si lo incluye en la respuesta. */
  externalId?: string;
  raw?:        string;
}

/**
 * Cliente para iniciar llamadas con IA en Dapta.
 *
 * Las llamadas se disparan desde un flujo de Flow Studio cuyo nodo Start es de
 * tipo "Webhook" (método POST). Ese flujo contiene un nodo DAPTA_PHONECALL que es
 * el que realmente marca. La URL del webhook tiene la forma:
 *   https://api.dapta.ai/api/{workspaceId}/{flow-slug}
 * y se autentica con la API key del flujo vía cabecera/parámetro `x-api-key`.
 *
 * Config:
 *   DAPTA_CALL_TRIGGER_URL = la URL del webhook del flujo (puede incluir ?x-api-key=...)
 *   DAPTA_API_KEY          = la API key del flujo (se envía como header x-api-key)
 *
 * El payload se manda en un formato amplio para que el flujo de Dapta pueda mapear
 * los campos que necesite (phone / name / leadId / companyId / variables) en el
 * nodo DAPTA_PHONECALL (ej. {{body.phone}}).
 */
export class DaptaClient {
  private readonly triggerUrl: string;
  private readonly apiKey:     string;

  constructor() {
    this.triggerUrl = env.daptaCallTriggerUrl();
    this.apiKey     = env.daptaApiKey();
  }

  async startCall(input: DaptaStartCallInput): Promise<DaptaStartCallResult> {
    if (!this.triggerUrl) {
      logger.warn('[Dapta] Sin DAPTA_CALL_TRIGGER_URL — llamada no iniciada (modo mock)', {
        leadId: input.leadId,
      });
      return { ok: false, status: 0, raw: 'mock: DAPTA_CALL_TRIGGER_URL no configurado' };
    }

    // El nodo DAPTA_PHONECALL del flujo lee estos campos de trigger.body:
    //   {{trigger.body.phone}}       → phone
    //   {{trigger.body.first_name}}  → first_name
    //   {{trigger.body.contact_id}}  → contact_id
    // Enviamos esos nombres exactos (+ alias por robustez con otros flujos).
    const payload = JSON.stringify({
      phone:      input.phone,
      to:         input.phone,        // alias frecuente
      first_name: input.name ?? '',   // el flujo usa {{trigger.body.first_name}}
      name:       input.name ?? '',
      contact_id: input.leadId,       // el flujo usa {{trigger.body.contact_id}}
      leadId:     input.leadId,
      companyId:  input.companyId,
      advisorId:  input.advisorId ?? '',
      // Plano para flujos que esperan los campos en la raíz:
      ...(input.variables ?? {}),
      // Anidado para flujos que esperan un objeto "variables":
      variables:  input.variables ?? {},
    });

    const url = new URL(this.triggerUrl);
    // Si la API key no viene ya en la URL como ?x-api-key=..., la añadimos también
    // como query param (Dapta acepta ambas formas; usamos header + query por robustez).
    if (this.apiKey && !url.searchParams.has('x-api-key')) {
      url.searchParams.set('x-api-key', this.apiKey);
    }
    const headers: Record<string, string> = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    return new Promise<DaptaStartCallResult>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'POST',
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const ok     = status >= 200 && status < 300;
          let externalId: string | undefined;
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            externalId = (parsed.callId ?? parsed.id ?? parsed.executionId) as string | undefined;
          } catch { /* respuesta no-JSON: la dejamos en raw */ }

          if (ok) {
            logger.info('[Dapta] Llamada solicitada', { leadId: input.leadId, status, externalId });
          } else {
            logger.error('[Dapta] Trigger respondió error', { leadId: input.leadId, status, body: data.slice(0, 500) });
          }
          resolve({ ok, status, externalId, raw: data.slice(0, 1000) });
        });
      });

      req.on('error', (err) => {
        logger.error('[Dapta] Error de red al iniciar llamada', { leadId: input.leadId, error: String(err) });
        reject(err);
      });
      req.write(payload);
      req.end();
    });
  }
}

let _client: DaptaClient | null = null;
export const getDaptaClient = (): DaptaClient => {
  if (!_client) _client = new DaptaClient();
  return _client;
};
