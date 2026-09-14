import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { messagesRepository } from './messages.repository';
import { leadsRepository } from '../leads/leads.repository';
import { getYcloudClientForInbox } from '../../integrations/ycloud/ycloud.client';
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
  /**
   * Línea (+E.164) desde la que el asesor ELIGIÓ enviar, ignorando el `inboxId`
   * del lead. Sirve para que un asesor con línea de coexistencia (p. ej. Angelica)
   * pueda mandar SU plantilla desde SU número a un lead que entró por el 317.
   * `getYcloudClientForInbox` ya valida propiedad: si el asesor no es dueño de esa
   * línea, cae al 317, así nadie envía "desde el WhatsApp de otro".
   */
  fromInboxId?: string;
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
  const { companyId, lead, template, variables, advisorId, broadcastId, fromInboxId } = params;
  // Línea efectiva: la elegida por el asesor (si envió una) o la del lead.
  const sendInboxId = fromInboxId || lead.inboxId;

  // WhatsApp RECHAZA parámetros de texto vacíos ("Parameter of type text is missing
  // text value"). Si la plantilla tiene variables sin valor, cortar con un mensaje
  // claro en vez de dejar que Meta la rechace con su error críptico.
  const missingVars = template.variables
    .filter((v) => !String(variables[v.key] ?? '').trim())
    .map((v) => `{{${v.key}}}`);
  if (missingVars.length) {
    throw new Error(`Faltan datos en la plantilla: ${missingVars.join(', ')}. Complétalos antes de enviar.`);
  }

  // Rellenar variables en el body: {{nombre}} → "Juan"
  let body = template.body;
  for (const [key, value] of Object.entries(variables)) {
    body = body.split(`{{${key}}}`).join(String(value));
  }

  const now = Timestamp.now();

  let externalMsgId: string | undefined;
  try {
    const components = buildPositionalComponents(template, variables);
    // El `from` sigue el inbox del lead, PERO una línea de coexistencia es personal:
    // solo su dueño la usa. Si envía otro asesor, sale por el 317 (ver getYcloudClientForInbox).
    const client = await getYcloudClientForInbox(companyId, sendInboxId, advisorId);
    // Preferir el TELÉFONO sobre el BSUID: el BSUID (identidad de un lead que ocultó
    // su número) es POR WABA — el de la 317 NO vale para enviar desde la WABA del
    // asesor (Meta da "User is not valid"). El teléfono sí funciona entre WABAs.
    // Solo se usa el BSUID cuando NO hay teléfono (lead 100% oculto, misma WABA).
    const dest = lead.phone || lead.whatsappUserId;
    if (!dest) throw new Error('El lead no tiene número ni identidad de WhatsApp para enviarle la plantilla.');
    const r = await client.sendTemplate(
      dest, template.name, template.language ?? 'es', components
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
    metadata:         {
      templateId: template.id,
      templateName: template.name,
      ...(broadcastId ? { broadcastId } : {}),
      // Línea (+E.164) desde la que salió: alimenta la etiqueta "Enviado desde…"
      // de la burbuja, que resuelve el nombre del número (317 vs línea del asesor).
      ...(sendInboxId ? { businessPhone: sendInboxId } : {}),
    },
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
