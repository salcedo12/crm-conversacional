import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

interface SendMessageInput {
  companyId: string;
  leadId:    string;
  content:   string;
  deliveryChannel?: 'company_whatsapp' | 'advisor_whatsapp';
  mediaUrl?:  string;
  mediaType?: string;
  fileName?:  string;
}

interface SendMessageResult {
  messageId: string;
  status:    string;
}

interface AiControlInput {
  companyId: string;
  leadId:    string;
}

const _sendManualMessage = httpsCallable<SendMessageInput, SendMessageResult>(
  functions,
  'sendManualMessage'
);
const _pauseLeadAi  = httpsCallable<AiControlInput, { aiEnabled: boolean }>(functions, 'pauseLeadAi');
const _resumeLeadAi = httpsCallable<AiControlInput, { aiEnabled: boolean }>(functions, 'resumeLeadAi');

interface ReactInput {
  companyId: string;
  leadId:    string;
  messageId: string;
  emoji:     string;
}
const _reactToMessage = httpsCallable<ReactInput, { ok: boolean }>(functions, 'reactToMessage');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía un mensaje manual desde el CRM al lead via WhatsApp.
 * Pasa por la Cloud Function (nunca directo a Twilio desde el frontend).
 * Cuenta con reintento automático silencioso para proteger la experiencia del
 * asesor ante micro-cortes de red o latencias en frío de la infraestructura.
 */
export async function sendManualMessage(
  companyId: string,
  leadId:    string,
  content:   string,
  deliveryChannel: 'company_whatsapp' | 'advisor_whatsapp' = 'company_whatsapp',
  mediaUrl?:  string,
  mediaType?: string,
  fileName?:  string
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await _sendManualMessage({ companyId, leadId, content, deliveryChannel, mediaUrl, mediaType, fileName });
      return result.data.messageId;
    } catch (err: any) {
      lastError = err;
      const isTransient =
        err?.code === 'internal' ||
        err?.code === 'unavailable' ||
        err?.code === 'deadline-exceeded' ||
        err?.message?.includes('network') ||
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('500');

      if (!isTransient || attempt === 3) {
        throw err;
      }
      console.warn(`[sendManualMessage] Intento ${attempt} no completó, reintentando automáticamente en ${attempt * 700}ms...`);
      await delay(attempt * 700);
    }
  }
  throw lastError;
}

/** Pausa la IA para un lead */
export async function pauseAi(companyId: string, leadId: string): Promise<void> {
  await _pauseLeadAi({ companyId, leadId });
}

/** Reactiva la IA para un lead */
export async function resumeAi(companyId: string, leadId: string): Promise<void> {
  await _resumeLeadAi({ companyId, leadId });
}

/**
 * Reacciona (emoji) a un mensaje del lead, como en WhatsApp. `emoji` vacío quita
 * la reacción. Pasa por la Cloud Function (envía a WhatsApp por YCloud).
 */
export async function reactToMessage(
  companyId: string,
  leadId:    string,
  messageId: string,
  emoji:     string
): Promise<void> {
  await _reactToMessage({ companyId, leadId, messageId, emoji });
}

const _retryFailedMessage = httpsCallable<{ companyId: string; leadId: string; messageId: string }, { ok: boolean }>(
  functions, 'retryFailedMessage',
);

/** Reenvía un mensaje saliente que quedó "No entregado" (mismo texto o archivo). */
export async function retryFailedMessage(companyId: string, leadId: string, messageId: string): Promise<void> {
  await _retryFailedMessage({ companyId, leadId, messageId });
}
