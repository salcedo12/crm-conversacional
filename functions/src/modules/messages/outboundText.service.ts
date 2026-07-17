import { getYcloudClient }        from '../../integrations/ycloud/ycloud.client';
import { getMetaMessagingClient } from '../../integrations/meta/metaMessaging.client';
import type { Lead } from '../leads/leads.types';

export interface SendTextResult {
  provider:       'ycloud' | 'meta_messenger' | 'meta_instagram';
  externalMsgId?: string;
}

type SendLead = Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId'>;

export async function sendTextToLeadChannel(
  lead: SendLead,
  content: string
): Promise<SendTextResult> {
  const channel = lead.channel ?? 'whatsapp';

  if (channel === 'messenger' || channel === 'instagram') {
    if (!lead.externalId) throw new Error(`Lead sin externalId para canal ${channel}`);
    const r = await getMetaMessagingClient().sendText(lead.externalId, content);
    return { provider: channel === 'messenger' ? 'meta_messenger' : 'meta_instagram', externalMsgId: r.id };
  }

  const r = await getYcloudClient().sendText(lead.phone, content);
  return { provider: 'ycloud', externalMsgId: r.id };
}

export async function sendMediaToLeadChannel(
  lead: SendLead,
  mediaUrl: string,
  mediaType: string,
  caption?: string
): Promise<SendTextResult> {
  const channel = lead.channel ?? 'whatsapp';

  if (channel === 'messenger' || channel === 'instagram') {
    if (!lead.externalId) throw new Error(`Lead sin externalId para canal ${channel}`);
    const r = await getMetaMessagingClient().sendMedia(lead.externalId, mediaUrl, mediaType);
    return { provider: channel === 'messenger' ? 'meta_messenger' : 'meta_instagram', externalMsgId: r.id };
  }

  const r = await getYcloudClient().sendMedia(lead.phone, mediaUrl, mediaType, caption);
  return { provider: 'ycloud', externalMsgId: r.id };
}
