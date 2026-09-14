import { env } from '../../config/env';

export type AdvisorWhatsappBridgeStatus =
  | 'configuration_required'
  | 'disconnected'
  | 'qr_pending'
  | 'connected'
  | 'stale'
  | 'error';

export interface AdvisorWhatsappBridgeSession {
  status: AdvisorWhatsappBridgeStatus;
  qrCode?: string;
  qrCodeDataUrl?: string;
  phone?: string;
  displayName?: string;
  lastSeenAt?: string;
  expiresAt?: string;
  error?: string;
}

interface BridgeRequest {
  companyId: string;
  advisorId: string;
}

interface BridgeSendMessageRequest extends BridgeRequest {
  to: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
}

function baseUrl(): string {
  return env.advisorWhatsappBridgeBaseUrl().replace(/\/+$/, '');
}

async function requestBridge<T>(path: string, body: BridgeRequest): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Key': env.advisorWhatsappBridgeApiKey(),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) as T : {} as T;
  if (!response.ok) {
    const message = (parsed as { message?: string }).message ?? text;
    throw new Error(`Puente WhatsApp HTTP ${response.status}: ${message}`);
  }
  return parsed;
}

export const advisorWhatsappBridgeClient = {
  configured(): boolean {
    return env.advisorWhatsappBridgeConfigured();
  },

  async requestQr(input: BridgeRequest): Promise<AdvisorWhatsappBridgeSession> {
    return requestBridge<AdvisorWhatsappBridgeSession>('/advisor-whatsapp/session/qr', input);
  },

  async status(input: BridgeRequest): Promise<AdvisorWhatsappBridgeSession> {
    return requestBridge<AdvisorWhatsappBridgeSession>('/advisor-whatsapp/session/status', input);
  },

  async disconnect(input: BridgeRequest): Promise<AdvisorWhatsappBridgeSession> {
    return requestBridge<AdvisorWhatsappBridgeSession>('/advisor-whatsapp/session/disconnect', input);
  },

  async sendMessage(input: BridgeSendMessageRequest): Promise<{ id?: string; status: string; phone?: string }> {
    return requestBridge<{ id?: string; status: string; phone?: string }>('/advisor-whatsapp/message/send', input);
  },
};
