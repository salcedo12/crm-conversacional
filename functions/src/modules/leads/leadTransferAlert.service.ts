import { db } from '../../lib/admin';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { advisorWhatsappBridgeClient } from '../../integrations/advisorWhatsapp/advisorWhatsappBridge.client';
import { getYcloudClientForCompany } from '../../integrations/ycloud/ycloud.client';

export interface LeadTransferAlertData {
  companyId: string;
  requestId: string;
  actionToken: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  project?: string | null;
  currentAdvisorName: string;
  requesterName: string;
  targetAdvisorName?: string | null;
  reason?: string | null;
  lastFollowUpSummary?: string | null;
  daysSinceFollowUp?: number | null;
}

/** Formatea número a estándar colombiano E.164 (+573XXXXXXXXX). */
export function formatToColombianE164(raw: string): string | null {
  const clean = raw.replace(/\D/g, '');
  if (!clean) return null;
  if (clean.length === 10 && clean.startsWith('3')) {
    return `+57${clean}`;
  }
  if (clean.length === 12 && clean.startsWith('573')) {
    return `+${clean}`;
  }
  if (clean.length >= 8 && clean.length <= 15) {
    return `+${clean}`;
  }
  return null;
}

/**
 * Obtiene los números telefónicos autorizados para recibir alertas de traslado
 * (Directores, Administradores y Managers con teléfono configurado).
 */
export async function getTransferAlertPhones(companyId: string): Promise<string[]> {
  const phonesSet = new Set<string>();

  // 1. Números prioritarios del administrador (Eduardo Salcedo / Alertas)
  const defaultEduardoPhones = ['+573148209662', '+573022911626'];
  defaultEduardoPhones.forEach((p) => {
    const norm = formatToColombianE164(p);
    if (norm) phonesSet.add(norm);
  });

  // 2. Variable de entorno opcional TRANSFER_ALERT_PHONES
  const envPhones = (process.env.TRANSFER_ALERT_PHONES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  envPhones.forEach((p) => {
    const norm = formatToColombianE164(p);
    if (norm) phonesSet.add(norm);
  });

  // 3. Teléfono de alerta del sistema (ERROR_ALERT_PHONE)
  const errPhone = env.errorAlertPhone();
  if (errPhone) {
    const norm = formatToColombianE164(errPhone);
    if (norm) phonesSet.add(norm);
  }

  // 4. Usuarios administradores y managers de la empresa
  try {
    const adminsSnap = await db
      .collection('companies')
      .doc(companyId)
      .collection('users')
      .where('role', 'in', ['admin', 'manager', 'director'])
      .get();

    adminsSnap.docs.forEach((doc) => {
      const data = doc.data();
      const candidates = [
        data.phone,
        data.personalPhone,
        ...(Array.isArray(data.additionalPhones) ? data.additionalPhones : []),
      ];
      candidates.forEach((c) => {
        if (typeof c === 'string' && c.trim()) {
          const norm = formatToColombianE164(c);
          if (norm) phonesSet.add(norm);
        }
      });
    });
  } catch (err) {
    logger.warn('[TransferAlert] Error leyendo teléfonos de administradores', {
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return Array.from(phonesSet);
}

/**
 * Envía la notificación de solicitud de traslado por WhatsApp a los administradores
 * con un enlace seguro de 1 toque para aprobar o rechazar rápido desde el celular.
 */
export async function sendTransferAlertWhatsapp(data: LeadTransferAlertData): Promise<{
  sentCount: number;
  phones: string[];
}> {
  const {
    companyId,
    requestId,
    actionToken,
    leadName,
    leadPhone,
    project,
    currentAdvisorName,
    requesterName,
    targetAdvisorName,
    reason,
    lastFollowUpSummary,
    daysSinceFollowUp,
  } = data;

  const phones = await getTransferAlertPhones(companyId);
  if (phones.length === 0) {
    logger.warn('[TransferAlert] No hay teléfonos configurados para enviar alerta de traslado', {
      companyId,
      requestId,
    });
    return { sentCount: 0, phones: [] };
  }

  const quickActionUrl = `https://us-central1-crm-conversacional.cloudfunctions.net/quickLeadTransferAction?companyId=${encodeURIComponent(
    companyId
  )}&id=${encodeURIComponent(requestId)}&token=${encodeURIComponent(actionToken)}`;

  let followUpText = 'Nunca ha registrado seguimiento ni bitácora (Sin gestión)';
  if (daysSinceFollowUp !== null && daysSinceFollowUp !== undefined) {
    if (daysSinceFollowUp === 0) {
      followUpText = 'Hoy (Seguimiento al día)';
    } else {
      followUpText = `Hace ${daysSinceFollowUp} días${lastFollowUpSummary ? ` (${lastFollowUpSummary})` : ''}`;
    }
  } else if (lastFollowUpSummary) {
    followUpText = lastFollowUpSummary;
  }

  const messageText =
    `🔄 *SOLICITUD DE TRASLADO DE PROSPECTO*\n\n` +
    `👤 *Prospecto:* ${leadName}\n` +
    `📱 *Teléfono:* ${leadPhone}\n` +
    (project ? `🏡 *Proyecto:* ${project}\n` : '') +
    `\n` +
    `👤 *Asesor Actual:* ${currentAdvisorName}\n` +
    `⏱️ *Último seguimiento:* ${followUpText}\n` +
    `\n` +
    `🙋‍♂️ *Solicita Traslado:* ${requesterName}\n` +
    (targetAdvisorName ? `🎯 *Para Asignar A:* ${targetAdvisorName}\n` : '') +
    `📝 *Motivo:* "${reason || 'Sin motivo especificado'}"\n` +
    `\n` +
    `⚡ *Para Aprobar o Rechazar rápido (1 toque desde tu celular):*\n` +
    `👉 ${quickActionUrl}\n` +
    `\n` +
    `💻 _O abre el CRM en PC:_ https://crm.grupoconstructormeraki.com.co`;

  let sentCount = 0;

  for (const phone of phones) {
    let sent = false;

    // 1. Intentar enviar vía puente WhatsApp de asesor (Alertas Meraki)
    if (advisorWhatsappBridgeClient.configured()) {
      try {
        await advisorWhatsappBridgeClient.sendMessage({
          companyId,
          advisorId: 'H69G8PsEzReNuU1yowJNnlCHgie2', // Sesión "Alertas Meraki"
          to: phone,
          content: messageText,
        });
        sent = true;
        sentCount++;
        logger.info('[TransferAlert] Alerta enviada exitosamente por puente Alertas Meraki', {
          companyId,
          requestId,
          to: phone,
        });
      } catch (err) {
        logger.warn('[TransferAlert] Falló envío por puente Alertas Meraki, probando YCloud', {
          to: phone,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Si falló el puente o no está configurado, intentar por YCloud
    if (!sent) {
      try {
        const client = await getYcloudClientForCompany(companyId);
        await client.sendText(phone, messageText);
        sent = true;
        sentCount++;
        logger.info('[TransferAlert] Alerta enviada por YCloud', {
          companyId,
          requestId,
          to: phone,
        });
      } catch (err) {
        logger.error('[TransferAlert] Error enviando alerta de traslado por WhatsApp a ' + phone, {
          companyId,
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { sentCount, phones };
}

/**
 * Envía confirmación por WhatsApp al administrador tras haber aprobado o rechazado
 * una solicitud de traslado (sea desde la web rápida o desde el CRM).
 */
export async function sendTransferResolutionConfirmationWhatsapp(params: {
  companyId: string;
  requestId: string;
  action: 'approve' | 'reject' | 'approved' | 'rejected';
  leadName: string;
  leadPhone?: string;
  newAdvisorName?: string;
  resolvedByName: string;
}): Promise<void> {
  const { companyId, action, leadName, leadPhone, newAdvisorName, resolvedByName } = params;
  const isApproved = action === 'approve' || action === 'approved';

  const phones = await getTransferAlertPhones(companyId);
  if (phones.length === 0) return;

  const text =
    isApproved
      ? `✅ *Traslado Aprobado Exitosamente*\n\n` +
        `👤 *Prospecto:* ${leadName} (${leadPhone || 's/n'})\n` +
        `🎯 *Nuevo Asesor Asignado:* ${newAdvisorName || 'Asesor'}\n` +
        `👮‍♂️ *Resuelto por:* ${resolvedByName}\n\n` +
        `El prospecto ya está en la bandeja del nuevo asesor y con bitácora registrada.`
      : `❌ *Traslado Rechazado*\n\n` +
        `👤 *Prospecto:* ${leadName} (${leadPhone || 's/n'})\n` +
        `👮‍♂️ *Resuelto por:* ${resolvedByName}\n\n` +
        `El prospecto permanece con el asesor actual.`;

  for (const phone of phones) {
    if (advisorWhatsappBridgeClient.configured()) {
      try {
        await advisorWhatsappBridgeClient.sendMessage({
          companyId,
          advisorId: 'H69G8PsEzReNuU1yowJNnlCHgie2',
          to: phone,
          content: text,
        });
        continue;
      } catch {}
    }

    try {
      const client = await getYcloudClientForCompany(companyId);
      await client.sendText(phone, text);
    } catch {}
  }
}
