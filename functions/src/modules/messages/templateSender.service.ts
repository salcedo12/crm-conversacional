import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { messagesRepository } from './messages.repository';
import { leadsRepository } from '../leads/leads.repository';
import { getYcloudClient } from '../../integrations/ycloud/ycloud.client';
import { buildPositionalComponents } from '../templates/templates.helpers';
import { describeSendError } from '../../utils/sendError';
import type { Lead } from '../leads/leads.types';
import type { WhatsAppTemplate } from '../templates/templates.types';

export interface SendTemplateParams {
  companyId: string;
  lead:      Lead;
  template:  WhatsAppTemplate;
  variables: Record<string, string>;
  /** uid del asesor que origina el envío (para el mensaje guardado). */
  advisorId?: string;
  broadcastId?: string;
}

export interface SendTemplateResult {
  messageId:     string;
  externalMsgId?: string;
}

/**
 * Envía una plantilla de WhatsApp a un lead por YCloud, guarda el mensaje
 * saliente en Firestore y actualiza el último mensaje del lead.
 *
 * Centraliza la lógica usada tanto por el envío individual (sendTemplateMessage)
 * como por el envío masivo (sendBroadcast). Lanza si el proveedor falla.
 */
export async function sendTemplateToLead(params: SendTemplateParams): Promise<SendTemplateResult> {
  const { companyId, lead, template, variables, advisorId, broadcastId } = params;

  // Rellenar variables en el body: {{nombre}} → "Juan"
  let body = template.body;
  for (const [key, value] of Object.entries(variables)) {
    body = body.split(`{{${key}}}`).join(String(value));
  }

  const now = Timestamp.now();

  let externalMsgId: string | undefined;
  try {
    const components = buildPositionalComponents(template, variables);
    const r = await getYcloudClient().sendTemplate(
      lead.phone, template.name, template.language ?? 'es', components
    );
    externalMsgId = r.id;
  } catch (err) {
    logger.error('[TemplateSender] Error enviando plantilla', {
      companyId, leadId: lead.id, templateId: template.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(describeSendError(err));
  }

  // Header con media → adjuntarlo al mensaje para que la bandeja lo muestre.
  const mediaUrl  = template.headerMediaUrl;
  const mediaType =
    template.headerType === 'document' ? 'application/pdf' :
    template.headerType === 'video'    ? 'video/mp4'       :
    template.headerType === 'image'    ? 'image/jpeg'      : undefined;

  const message = await messagesRepository.create({
    companyId,
    leadId:           lead.id,
    direction:        'outbound',
    senderType:       'advisor',
    content:          body,
    channel:          'whatsapp',
    status:           'sent',
    twilioMessageSid: externalMsgId,
    advisorId,
    createdAt:        now,
    ...(mediaUrl && mediaType ? { mediaUrl, mediaType } : {}),
    metadata:         { templateId: template.id, templateName: template.name, ...(broadcastId ? { broadcastId } : {}) },
  });

  const preview = body.trim()
    || (mediaType === 'application/pdf' ? '📎 Documento'
      : mediaType?.startsWith('video') ? '🎥 Video'
      : mediaType?.startsWith('image') ? '📷 Imagen' : '');
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: preview.slice(0, 80),
    lastMessageAt:   now,
  });

  return { messageId: message.id, externalMsgId };
}
