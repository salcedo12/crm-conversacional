import nodemailer from 'nodemailer';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { getYcloudClientForCompany } from '../../integrations/ycloud/ycloud.client';
import { getYcloudConfigForCompany } from '../companies/channelCredentials.repository';
import { advisorWhatsappBridgeClient } from '../../integrations/advisorWhatsapp/advisorWhatsappBridge.client';
import { sendAdvisorPush } from '../messages/pushNotifications.service';
import { formatLongDate, formatTime } from '../appointments/appointmentMessages';
import { normalizePhone } from '../../utils/phone';

export interface AdvisorReminderNoticeParams {
  companyId:   string;
  advisorId:   string;
  leadId:      string;
  leadName?:   string;
  leadPhone?:  string;
  project?:    string;
  nextAction?: string;
  notes?:      string;
  dueAt:       Date;
}

export interface AdvisorReminderNoticeResult {
  pushSent:     boolean;
  whatsappSent: boolean;
  emailSent:    boolean;
}

function cleanString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Busca teléfono y correo del asesor:
 * 1. Campo `phone` y `email` en companies/{companyId}/users/{advisorId}.
 * 2. Si no tiene teléfono en perfil, busca en advisorWhatsappConnections/{advisorId}.
 */
async function getAdvisorProfile(companyId: string, advisorId: string): Promise<{
  displayName: string;
  phone: string | null;
  email: string | null;
}> {
  const companyRef = db.collection('companies').doc(companyId);
  const userSnap = await companyRef.collection('users').doc(advisorId).get();
  const userData = userSnap.data();

  const displayName = cleanString(userData?.displayName) || cleanString(userData?.email) || 'Asesor Comercial';
  let phone = cleanString(userData?.phone);

  if (!phone) {
    const connSnap = await companyRef.collection('advisorWhatsappConnections').doc(advisorId).get();
    phone = cleanString(connSnap.data()?.phone);
  }

  const emailRaw = cleanString(userData?.email);
  const email = emailRaw && emailRaw.includes('@') ? emailRaw : null;

  return { displayName, phone, email };
}

/**
 * Plantilla HTML para correo electrónico de recordatorio de seguimiento
 */
function buildReminderEmailHtml(params: {
  advisorName: string;
  leadName: string;
  leadPhone: string;
  project: string;
  nextAction: string;
  formattedDate: string;
  formattedTime: string;
  notes: string;
  leadUrl: string;
  cleanLeadPhone: string;
}): string {
  const {
    advisorName, leadName, leadPhone, project, nextAction,
    formattedDate, formattedTime, notes, leadUrl, cleanLeadPhone,
  } = params;

  const waLeadUrl = cleanLeadPhone ? `https://wa.me/${cleanLeadPhone.replace(/\D/g, '')}` : null;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Recordatorio de Seguimiento - Meraki CRM</title>
  </head>
  <body style="margin:0;background:#0b0b0f;font-family:Arial,Helvetica,sans-serif;color:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#18181b;border:1px solid #2f2f35;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.5);">
            <tr>
              <td style="padding:24px 32px;background:#131316;border-bottom:1px solid #2f2f35;">
                <div style="display:inline-block;background:#7c3aed;color:#ffffff;border-radius:10px;padding:6px 12px;font-weight:700;font-size:15px;letter-spacing:1px;">
                  MERAKI CRM
                </div>
                <span style="display:inline-block;margin-left:12px;color:#a1a1aa;font-size:13px;vertical-align:middle;">
                  Alerta de Seguimiento Comercial
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;color:#a1a1aa;font-size:14px;">Hola <strong>${escapeHtml(advisorName)}</strong>,</p>
                <h1 style="margin:0 0 16px;color:#ffffff;font-size:22px;line-height:1.3;">
                  ⏰ Tienes un seguimiento comercial programado
                </h1>
                <p style="margin:0 0 24px;color:#d4d4d8;font-size:14px;line-height:1.6;">
                  De acuerdo con la Ficha Técnica y el protocolo comercial, ha llegado el momento de contactar al siguiente cliente:
                </p>

                <!-- Tarjeta con datos del lead -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #3f3f46;border-radius:12px;background:#111113;">
                  <tr>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;width:35%;">👤 Cliente</td>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#ffffff;font-size:14px;font-weight:600;">${escapeHtml(leadName)}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;">📞 Teléfono</td>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#10b981;font-size:14px;font-weight:600;">
                      <a href="tel:${escapeHtml(leadPhone)}" style="color:#10b981;text-decoration:none;">${escapeHtml(leadPhone)}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;">🏡 Proyecto</td>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#ffffff;font-size:14px;">${escapeHtml(project)}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;">📌 Gestión</td>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#f59e0b;font-size:14px;font-weight:600;">${escapeHtml(nextAction)}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:13px;">📅 Hora programada</td>
                    <td style="padding:14px 18px;border-bottom:1px solid #27272a;color:#ffffff;font-size:13px;">${escapeHtml(formattedDate)} a las ${escapeHtml(formattedTime)}</td>
                  </tr>
                  ${notes ? `
                  <tr>
                    <td style="padding:14px 18px;color:#a1a1aa;font-size:13px;vertical-align:top;">📝 Notas previas</td>
                    <td style="padding:14px 18px;color:#d4d4d8;font-size:13px;line-height:1.5;">${escapeHtml(notes)}</td>
                  </tr>
                  ` : ''}
                </table>

                <!-- Botones de Acción -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 16px;">
                  <tr>
                    <td style="background:#7c3aed;border-radius:10px;margin-right:12px;">
                      <a href="${escapeHtml(leadUrl)}" target="_blank" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
                        👉 Abrir Conversación en Meraki CRM
                      </a>
                    </td>
                    ${waLeadUrl ? `
                    <td style="padding-left:12px;">
                      <a href="${escapeHtml(waLeadUrl)}" target="_blank" style="display:inline-block;padding:13px 20px;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;">
                        💬 Abrir WhatsApp del Cliente
                      </a>
                    </td>
                    ` : ''}
                  </tr>
                </table>

                <p style="margin:24px 0 0;color:#71717a;font-size:12px;line-height:1.5;">
                  Recuerda que una vez realizado el contacto debes diligenciar la <strong>Ficha Técnica</strong> para registrar el avance en la bitácora del cliente.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#111113;color:#52525b;font-size:11px;text-align:center;">
                Meraki CRM · Notificación automática de recordatorio de seguimiento
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Notificador multicanal para recordatorios de seguimiento de asesores:
 * 1. Web Push (FCM / Notificación de navegador y móvil)
 * 2. WhatsApp a celular del asesor (Plantilla YCloud o Puente QR)
 * 3. Correo Electrónico (HTML formateado con llamada y WhatsApp 1-tap)
 */
export async function notifyAdvisorLeadReminder(params: AdvisorReminderNoticeParams): Promise<AdvisorReminderNoticeResult> {
  const {
    companyId, advisorId, leadId, leadName = 'Cliente', leadPhone = 'Sin número',
    project = 'Proyecto Meraki', nextAction = 'Seguimiento comercial', notes = '', dueAt,
  } = params;

  let pushSent = false;
  let whatsappSent = false;
  let emailSent = false;

  const formattedDate = formatLongDate(dueAt);
  const formattedTime = formatTime(dueAt);
  const leadUrl = `${env.appBaseUrl()}/dashboard/inbox?lead=${leadId}`;

  // 1. Obtener datos del perfil del asesor (teléfono y correo)
  let advisorProfile: { displayName: string; phone: string | null; email: string | null };
  try {
    advisorProfile = await getAdvisorProfile(companyId, advisorId);
  } catch (err) {
    logger.error('[AdvisorReminder] Error consultando perfil de asesor', { companyId, advisorId, error: err });
    advisorProfile = { displayName: 'Asesor', phone: null, email: null };
  }

  // 2. DISPATCHER: Notificación PUSH (Móvil / Web)
  try {
    await sendAdvisorPush(companyId, advisorId, {
      title:  `⏰ Seguimiento: ${leadName}`,
      body:   `${nextAction} programada para hoy. Toca para ver la conversación.`,
      url:    `/dashboard/inbox?lead=${leadId}`,
      type:   'reminder',
      leadId,
    });
    pushSent = true;
  } catch (err) {
    logger.warn('[AdvisorReminder] Push falló (best-effort)', { companyId, advisorId, error: err });
  }

  // 3. DISPATCHER: WhatsApp a celular del asesor
  if (advisorProfile.phone) {
    const rawPhone = advisorProfile.phone;
    const cleanPhone = normalizePhone(rawPhone);

    // Intento A: Plantilla YCloud
    try {
      const cfg = await getYcloudConfigForCompany(companyId);
      if (cfg.apiKey) {
        const client = await getYcloudClientForCompany(companyId);
        const templateName = env.advisorReminderTemplate();

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: advisorProfile.displayName.slice(0, 50) },
              { type: 'text', text: leadName.slice(0, 50) },
              { type: 'text', text: leadPhone.slice(0, 30) },
              { type: 'text', text: nextAction.slice(0, 60) },
              { type: 'text', text: `${formattedDate} ${formattedTime}`.slice(0, 50) },
              { type: 'text', text: (project || 'Meraki Campestre').slice(0, 50) },
              { type: 'text', text: (notes || 'Sin observaciones adicionales').slice(0, 100) },
            ],
          },
        ];

        await client.sendTemplate(cleanPhone, templateName, 'es', components);
        whatsappSent = true;
        logger.info('[AdvisorReminder] Plantilla WhatsApp enviada al asesor exitosamente', {
          companyId, advisorId, phone: cleanPhone, templateName,
        });
      }
    } catch (ycloudErr) {
      logger.warn('[AdvisorReminder] YCloud template no se pudo enviar (posible plantilla no aprobada aún)', {
        companyId, advisorId, phone: cleanPhone,
        error: ycloudErr instanceof Error ? ycloudErr.message : String(ycloudErr),
      });

      // Intento B: Si el asesor tiene WhatsApp conectado por el puente QR
      if (advisorWhatsappBridgeClient.configured()) {
        try {
          const reminderMsg =
            `⏰ *RECORDATORIO DE SEGUIMIENTO MERAKI*\n\n` +
            `Hola *${advisorProfile.displayName}*, tienes un seguimiento programado:\n\n` +
            `👤 *Cliente:* ${leadName}\n` +
            `📞 *Teléfono:* ${leadPhone}\n` +
            `🏡 *Proyecto:* ${project}\n` +
            `📌 *Gestión:* ${nextAction}\n` +
            `📅 *Fecha:* ${formattedDate} a las ${formattedTime}\n` +
            (notes ? `📝 *Notas:* ${notes}\n` : '') +
            `\n🔗 *Abrir en CRM:* ${leadUrl}`;

          await advisorWhatsappBridgeClient.sendMessage({
            companyId,
            advisorId,
            to: cleanPhone,
            content: reminderMsg,
          });
          whatsappSent = true;
          logger.info('[AdvisorReminder] Mensaje de WhatsApp enviado vía puente QR', { companyId, advisorId });
        } catch (bridgeErr) {
          logger.warn('[AdvisorReminder] Puente QR no disponible para mensaje', { companyId, advisorId, error: bridgeErr });
        }
      }
    }
  } else {
    logger.info('[AdvisorReminder] Asesor sin celular configurado para avisos de WhatsApp', { companyId, advisorId });
  }

  // 4. DISPATCHER: Correo Electrónico (SMTP / Nodemailer)
  if (advisorProfile.email && env.mailConfigured()) {
    try {
      const transporter = nodemailer.createTransport({
        host:   env.smtpHost(),
        port:   env.smtpPort(),
        secure: env.smtpSecure(),
        auth: {
          user: env.smtpUser(),
          pass: env.smtpPass(),
        },
      });

      const emailHtml = buildReminderEmailHtml({
        advisorName:   advisorProfile.displayName,
        leadName,
        leadPhone,
        project,
        nextAction,
        formattedDate,
        formattedTime,
        notes,
        leadUrl,
        cleanLeadPhone: leadPhone,
      });

      await transporter.sendMail({
        from:    env.mailFrom(),
        to:      advisorProfile.email,
        subject: `⏰ Recordatorio de Seguimiento: ${leadName} (${nextAction})`,
        html:    emailHtml,
        text: [
          `Hola ${advisorProfile.displayName},`,
          '',
          `Tienes un seguimiento comercial pendiente con el cliente ${leadName}.`,
          `Teléfono: ${leadPhone}`,
          `Proyecto: ${project}`,
          `Gestión: ${nextAction}`,
          `Fecha y hora: ${formattedDate} a las ${formattedTime}`,
          notes ? `Notas: ${notes}` : '',
          '',
          `Abrir en CRM: ${leadUrl}`,
        ].filter(Boolean).join('\n'),
      });

      emailSent = true;
      logger.info('[AdvisorReminder] Correo de recordatorio enviado al asesor exitosamente', {
        companyId, advisorId, email: advisorProfile.email,
      });
    } catch (mailErr) {
      logger.warn('[AdvisorReminder] No se pudo enviar correo de recordatorio (best-effort)', {
        companyId, advisorId, email: advisorProfile.email,
        error: mailErr instanceof Error ? mailErr.message : String(mailErr),
      });
    }
  } else {
    if (!advisorProfile.email) {
      logger.info('[AdvisorReminder] Asesor sin correo configurado', { companyId, advisorId });
    }
    if (!env.mailConfigured()) {
      logger.debug?.('[AdvisorReminder] SMTP no configurado en entorno');
    }
  }

  return { pushSent, whatsappSent, emailSent };
}
