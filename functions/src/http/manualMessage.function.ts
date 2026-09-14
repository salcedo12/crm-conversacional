import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { logger }          from '../utils/logger';
import { sendTextToLeadChannel, sendMediaToLeadChannel } from '../modules/messages/outboundText.service';
import { leadsRepository }    from '../modules/leads/leads.repository';
import { messagesRepository } from '../modules/messages/messages.repository';
import { syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import { describeSendError }  from '../utils/sendError';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { advisorWhatsappBridgeClient } from '../integrations/advisorWhatsapp/advisorWhatsappBridge.client';
import { getAdvisorLineForAdvisor } from '../modules/companies/companyRouting';
import { getYcloudClientForInbox } from '../integrations/ycloud/ycloud.client';

const SendMessageSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
  content:   z.string().max(1600).default(''),
  deliveryChannel: z.enum(['company_whatsapp', 'advisor_whatsapp']).default('company_whatsapp'),
  // Media opcional — Firebase serializa undefined como null, usamos nullish()
  mediaUrl:  z.string().url().nullish(),
  mediaType: z.string().nullish(),
  fileName:  z.string().max(255).nullish(),
}).refine(
  (d) => (d.content?.trim().length ?? 0) > 0 || !!d.mediaUrl,
  { message: 'Se requiere content o mediaUrl' }
);

/**
 * Callable Function: envía un mensaje manual desde el CRM al lead, por el canal
 * que corresponda (WhatsApp/YCloud, Messenger o Instagram Direct — ver `lead.channel`).
 *
 * Responsabilidades:
 * 1. (Fase 1) Validar usuario autenticado — actualmente permisivo hasta que se implemente Auth.
 * 2. Validar input con Zod.
 * 3. Verificar que el lead existe y pertenece a la empresa.
 * 4. Enviar mensaje por el canal del lead (sendTextToLeadChannel/sendMediaToLeadChannel).
 * 5. Guardar mensaje en Firestore como senderType: 'advisor'.
 * 6. Actualizar lastMessage del lead.
 *
 * El frontend NUNCA envía directamente a WhatsApp/Meta — siempre pasa por esta Function.
 */
export const sendManualMessage = onCall(
  {
    region:         'us-central1',
    timeoutSeconds: 120,
    memory:         '256MiB',
  },
  async (request) => {
    // ── Auth: usuario autenticado, con empresa, y rol con permiso de escritura ──
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    // ── Validar input ─────────────────────────────────────────────────────────
    const parseResult = SendMessageSchema.safeParse(request.data);
    if (!parseResult.success) {
      const errs = JSON.stringify(parseResult.error.flatten());
      logger.warn('[ManualMessage] Validación fallida', { errors: errs, data: request.data });
      throw new HttpsError('invalid-argument', `Datos inválidos: ${errs}`);
    }

    const { companyId, leadId, content, deliveryChannel, mediaUrl, mediaType, fileName } = parseResult.data;

    // Impedir operar sobre datos de otra empresa
    assertCompany(ctx, companyId);

    // ── Verificar lead ────────────────────────────────────────────────────────
    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) {
      throw new HttpsError('not-found', 'Lead no encontrado.');
    }
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes escribir a leads asignados a ti.');
    }

    const now        = Timestamp.now();
    const advisorId  = ctx.uid;

    let externalMsgId: string | undefined;
    let advisorWhatsappPhone: string | undefined;
    // Número de la línea de coexistencia del asesor si "Mi WhatsApp" salió por YCloud
    // (no por Baileys). Sirve para anclar el lead a su línea y etiquetar el mensaje.
    let coexistenceLineNumber: string | undefined;
    // Número REAL desde el que salió por la línea oficial (puede ser el 317 aunque el
    // inbox del lead sea otro, por el chequeo de dueño). Para etiquetar bien el mensaje.
    let companyLineFrom: string | undefined;
    try {
      if (deliveryChannel === 'advisor_whatsapp') {
        if ((lead.channel ?? 'whatsapp') !== 'whatsapp') {
          throw new Error('El envio por WhatsApp del asesor solo aplica para leads de WhatsApp.');
        }
        if (!lead.phone) {
          // Lead que entró por USUARIO (sin número): su identidad de WhatsApp está
          // atada a la línea que contactó (el 317). Ni Baileys (solo teléfonos) ni la
          // coexistencia (otra WABA) pueden escribirle. Solo el 317.
          throw new Error('Este lead entró por usuario de WhatsApp (sin número): solo se le puede responder por la Línea de Ventas (317), no desde tu WhatsApp personal.');
        }
        // Preferir la LÍNEA DE COEXISTENCIA (YCloud) del asesor: sale por su propio
        // número por la API oficial (con entrega/acuse reales), reemplazando Baileys.
        const advisorLine = await getAdvisorLineForAdvisor(companyId, advisorId);
        if (advisorLine) {
          const client = await getYcloudClientForInbox(companyId, advisorLine.number, advisorId);
          // IMPORTANTE: al enviar desde la línea del asesor (OTRO WABA que el 317),
          // hay que usar el TELÉFONO, no el BSUID. Los BSUID (identidad de un lead
          // que ocultó su número) son POR WABA: el que emitió la 317 NO sirve para
          // enviar desde el WABA del asesor → Meta responde 131000. El guard de
          // arriba ya garantizó que hay teléfono para esta rama.
          const dest = lead.phone;
          const r = (mediaUrl && mediaType)
            ? await client.sendMedia(dest, mediaUrl, mediaType, content || undefined, fileName || undefined)
            : await client.sendText(dest, content);
          externalMsgId = r.id;
          advisorWhatsappPhone = advisorLine.number;
          coexistenceLineNumber = advisorLine.number;
        } else if (advisorWhatsappBridgeClient.configured()) {
          // Legado: asesores que aún usan el puente Baileys (no migrados a coexistencia).
          const r = await advisorWhatsappBridgeClient.sendMessage({
            companyId,
            advisorId,
            to: lead.phone,
            content,
            ...(mediaUrl ? { mediaUrl } : {}),
            ...(mediaType ? { mediaType } : {}),
            ...(fileName ? { fileName } : {}),
          });
          externalMsgId = r.id;
          advisorWhatsappPhone = r.phone;
        } else {
          throw new Error('No tienes una línea de WhatsApp propia conectada (ni coexistencia ni puente).');
        }
      } else if (mediaUrl && mediaType) {
        // Línea oficial: pasar quién envía → si el lead vive en la línea PERSONAL de
        // otro asesor, NO sale por su número; sale por el 317 (ver getYcloudClientForInbox).
        const r = await sendMediaToLeadChannel(lead, mediaUrl, mediaType, content || undefined, fileName || undefined, advisorId);
        externalMsgId = r.externalMsgId;
        companyLineFrom = r.fromNumber;
      } else {
        const r = await sendTextToLeadChannel(lead, content, advisorId);
        externalMsgId = r.externalMsgId;
        companyLineFrom = r.fromNumber;
      }
    } catch (err) {
      logger.error('[ManualMessage] Error enviando mensaje', {
        leadId,
        via:   lead.channel ?? 'whatsapp',
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', describeSendError(err));
    }

    // ── Guardar mensaje en Firestore ─────────────────────────────────────────
    const message = await messagesRepository.create({
      companyId,
      leadId,
      direction:        'outbound',
      senderType:       'advisor',
      content,
      channel:          lead.channel ?? 'whatsapp',
      status:           'sent',
      twilioMessageSid: externalMsgId,
      advisorId,
      metadata: {
        deliveryChannel,
        ...(deliveryChannel === 'advisor_whatsapp' ? (coexistenceLineNumber ? {
          // Coexistencia YCloud: salió por el número propio del asesor.
          origin: 'advisor_coexistence',
          businessPhone: coexistenceLineNumber,
        } : {
          origin: 'advisor_whatsapp_bridge',
          ...(advisorWhatsappPhone ? { advisorPhone: advisorWhatsappPhone } : {}),
        }) : {
          origin: 'company_whatsapp',
          // Número REAL usado (317 si el inbox era de otro asesor); cae al inboxId si no vino.
          ...((companyLineFrom || lead.inboxId) ? { businessPhone: companyLineFrom || lead.inboxId } : {}),
        }),
      },
      ...(mediaUrl  ? { mediaUrl }  : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(fileName  ? { fileName }  : {}),
      createdAt:        now,
    });

    // ── Actualizar lastMessage del lead ──────────────────────────────────────
    const mt = mediaType ?? '';
    const previewText = content.trim() || (mt.startsWith('image') ? '📷 Imagen' : mt.startsWith('video') ? '🎥 Video' : mt.startsWith('audio') ? '🎵 Audio' : '📎 Archivo');
    const isFirstAdvisorContact = !lead.advisorFirstContactAt;
    const leadUpdate: Record<string, unknown> = {
      lastMessageText: previewText,
      lastMessageAt:   now,
      lastAdvisorMessageAt: now,
      // Un asesor ya escribió: el lead deja de estar pendiente de primer contacto,
      // así queda fuera de la query de reasignación automática.
      pendingFirstContact: false,
      // IMPORTANTE: NO se cambia el `inboxId` del lead al enviar por "Mi WhatsApp".
      // El lead conserva su línea de origen (la 317 sigue siendo la principal). Así
      // el botón de línea oficial no se contamina y los envíos del 317 salen por el
      // 317. La línea del asesor solo es "casa" de los leads que ENTRARON por ella.
    };

    if (isFirstAdvisorContact) {
      leadUpdate.advisorFirstContactAt = now;
      leadUpdate.advisorFirstContactBy = advisorId;
      leadUpdate.assignedTo = advisorId;
      if (!lead.smartHomeCustomerId) leadUpdate.smartHomeSyncAttemptedAt = now;
    }

    await leadsRepository.update(companyId, leadId, leadUpdate);

    if (isFirstAdvisorContact && !lead.smartHomeCustomerId) {
      // La sincronización con SmartHome es "mejor esfuerzo": NUNCA debe demorar ni
      // tumbar el envío del mensaje (que ya salió arriba). Aunque el cliente ya tiene
      // timeout por llamada, le ponemos un presupuesto total: si se pasa, la función
      // responde igual y la sincro se resuelve en segundo plano / queda para otra vez.
      const SYNC_BUDGET_MS = 25_000;
      const syncPromise = syncLeadToSmartHome({
        ...lead,
        id: leadId,
        companyId,
        assignedTo: advisorId,
        advisorFirstContactAt: now,
        advisorFirstContactBy: advisorId,
        lastAdvisorMessageAt: now,
        lastMessageText: previewText,
        lastMessageAt: now,
      }).catch((err) => {
        logger.warn('[ManualMessage] SmartHome no sincronizado en primer contacto', {
          leadId,
          advisorId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      await Promise.race([
        syncPromise,
        new Promise<void>((resolve) => setTimeout(resolve, SYNC_BUDGET_MS)),
      ]);
    }

    logger.info('[ManualMessage] Mensaje enviado', {
      leadId,
      messageId: message.id,
      advisorId,
    });

    return { messageId: message.id, status: 'sent' };
  }
);
