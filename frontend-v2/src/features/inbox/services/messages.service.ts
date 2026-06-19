import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

interface SendMessageInput {
  companyId: string;
  leadId:    string;
  content:   string;
  mediaUrl?:  string;
  mediaType?: string;
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

/**
 * Envía un mensaje manual desde el CRM al lead via WhatsApp.
 * Pasa por la Cloud Function (nunca directo a Twilio desde el frontend).
 */
export async function sendManualMessage(
  companyId: string,
  leadId:    string,
  content:   string,
  mediaUrl?:  string,
  mediaType?: string
): Promise<string> {
  const result = await _sendManualMessage({ companyId, leadId, content, mediaUrl, mediaType });
  return result.data.messageId;
}

/** Pausa la IA para un lead */
export async function pauseAi(companyId: string, leadId: string): Promise<void> {
  await _pauseLeadAi({ companyId, leadId });
}

/** Reactiva la IA para un lead */
export async function resumeAi(companyId: string, leadId: string): Promise<void> {
  await _resumeLeadAi({ companyId, leadId });
}
