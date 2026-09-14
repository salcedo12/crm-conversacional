import { getYcloudClientForInbox } from '../../integrations/ycloud/ycloud.client';
import { getMetaMessagingClient } from '../../integrations/meta/metaMessaging.client';
import type { Lead } from '../leads/leads.types';

export interface SendTextResult {
  provider:       'ycloud' | 'meta_messenger' | 'meta_instagram';
  externalMsgId?: string;
  /** Número real desde el que salió (para etiquetar el mensaje con la línea correcta). */
  fromNumber?:    string;
}

// `inboxId` decide el número `from`: la 317 sale por el 317, la línea del asesor
// (coexistencia) sale por su propio número. Ver [[getYcloudClientForInbox]].
type SendLead = Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'companyId' | 'whatsappUserId' | 'inboxId'>;

/**
 * Destino de WhatsApp del lead: su BSUID si escribió ocultando el número
 * (privacidad de nombre de usuario), o su teléfono. El cliente de YCloud enruta
 * automáticamente al campo `recipient` o `to` según la forma del valor.
 */
function whatsappDestination(lead: Pick<Lead, 'phone' | 'whatsappUserId'>): string {
  return lead.whatsappUserId || lead.phone;
}

export async function sendTextToLeadChannel(
  lead: SendLead,
  content: string,
  senderAdvisorId?: string,
): Promise<SendTextResult> {
  const channel = lead.channel ?? 'whatsapp';

  if (channel === 'messenger' || channel === 'instagram') {
    if (!lead.externalId) throw new Error(`Lead sin externalId para canal ${channel}`);
    const r = await getMetaMessagingClient().sendText(lead.externalId, content);
    return { provider: channel === 'messenger' ? 'meta_messenger' : 'meta_instagram', externalMsgId: r.id };
  }

  const client = await getYcloudClientForInbox(lead.companyId, lead.inboxId, senderAdvisorId);
  const r = await client.sendText(whatsappDestination(lead), content);
  return { provider: 'ycloud', externalMsgId: r.id, fromNumber: client.fromNumber };
}

/**
 * Envía una reacción (emoji) a un mensaje del lead. `wamid` es el id de WhatsApp
 * del mensaje al que se reacciona; emoji vacío quita la reacción. Solo WhatsApp:
 * Messenger/Instagram tienen otro mecanismo de reacciones (no soportado aquí).
 */
export async function sendReactionToLeadChannel(
  lead: SendLead,
  wamid: string,
  emoji: string
): Promise<SendTextResult> {
  const channel = lead.channel ?? 'whatsapp';
  if (channel !== 'whatsapp') {
    throw new Error(`Las reacciones solo están disponibles en WhatsApp (canal actual: ${channel}).`);
  }
  const client = await getYcloudClientForInbox(lead.companyId, lead.inboxId);
  const r = await client.sendReaction(whatsappDestination(lead), wamid, emoji);
  return { provider: 'ycloud', externalMsgId: r.id };
}

export async function sendMediaToLeadChannel(
  lead: SendLead,
  mediaUrl: string,
  mediaType: string,
  caption?: string,
  fileName?: string,
  senderAdvisorId?: string,
): Promise<SendTextResult> {
  const channel = lead.channel ?? 'whatsapp';

  if (channel === 'messenger' || channel === 'instagram') {
    if (!lead.externalId) throw new Error(`Lead sin externalId para canal ${channel}`);
    const r = await getMetaMessagingClient().sendMedia(lead.externalId, mediaUrl, mediaType);
    return { provider: channel === 'messenger' ? 'meta_messenger' : 'meta_instagram', externalMsgId: r.id };
  }

  const client = await getYcloudClientForInbox(lead.companyId, lead.inboxId, senderAdvisorId);
  const r = await client.sendMedia(whatsappDestination(lead), mediaUrl, mediaType, caption, fileName);
  return { provider: 'ycloud', externalMsgId: r.id, fromNumber: client.fromNumber };
}
