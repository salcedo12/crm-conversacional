import { Timestamp } from 'firebase-admin/firestore';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { messagesRepository } from '../messages/messages.repository';
import { leadsRepository } from '../leads/leads.repository';
import { sendTextToLeadChannel } from '../messages/outboundText.service';
import { sendTemplateToLead } from '../messages/templateSender.service';
import { templatesRepository } from '../templates/templates.repository';
import {
  buildConfirmation, formatTime, formatLongDate, friendlyFirstName,
} from './appointmentMessages';
import type { Lead } from '../leads/leads.types';
import type { Appointment } from './appointments.types';

/** Ventana de sesión de WhatsApp: 24h desde el último mensaje entrante del lead. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type ConfirmationVia = 'text' | 'template' | 'none';
export interface ConfirmationResult {
  delivered: boolean;
  via:       ConfirmationVia;
  reason?:   string;
}

function isWindowOpen(lead: Pick<Lead, 'lastInboundAt'>): boolean {
  const t = lead.lastInboundAt?.toMillis?.();
  return !!t && Date.now() - t < WINDOW_MS;
}

/**
 * Envía al lead la confirmación de una cita, respetando la ventana de 24h de
 * WhatsApp:
 *   - Ventana ABIERTA  → texto libre (el mensaje de siempre).
 *   - Ventana CERRADA  → plantilla aprobada (APPOINTMENT_CONFIRMATION_TEMPLATE),
 *     que es la única forma que permite WhatsApp de escribir fuera de la ventana.
 *     Es el caso típico de una cita agendada en una llamada IA, donde el contacto
 *     puede no haber abierto conversación de WhatsApp.
 *
 * Si la ventana está cerrada y no hay plantilla configurada/aprobada, no se envía
 * nada (se registra la advertencia) y devuelve `delivered: false`.
 *
 * El path de texto del asistente conversacional NO usa esto: allí el lead acaba de
 * escribir, así que la ventana siempre está abierta y responde con su propio texto.
 */
export async function sendAppointmentConfirmationToLead(
  companyId:    string,
  lead:         Lead,
  appointment:  Appointment,
  businessName: string,
): Promise<ConfirmationResult> {
  const start = appointment.startTime.toDate();
  const name  = appointment.leadName ?? lead.name;

  // ── Ventana abierta → texto libre ──────────────────────────────────────────
  if (isWindowOpen(lead)) {
    const content = buildConfirmation(businessName, name, start);
    const { externalMsgId } = await sendTextToLeadChannel(lead, content);
    const now = Timestamp.now();
    await messagesRepository.create({
      companyId,
      leadId:           lead.id,
      direction:        'outbound',
      senderType:       'system',
      content,
      channel:          'whatsapp',
      status:           'sent',
      twilioMessageSid: externalMsgId,
      aiProcessed:      true,
      createdAt:        now,
    });
    await leadsRepository.update(companyId, lead.id, {
      lastMessageText: content.slice(0, 80),
      lastMessageAt:   now,
    });
    return { delivered: true, via: 'text' };
  }

  // ── Ventana cerrada → plantilla ────────────────────────────────────────────
  const templateName = env.appointmentConfirmationTemplate();
  if (!templateName) {
    logger.warn('[AppointmentNotifier] Ventana cerrada y sin plantilla de confirmación configurada — no se envía', {
      companyId, leadId: lead.id,
    });
    return { delivered: false, via: 'none', reason: 'sin_plantilla_configurada' };
  }

  const template = await templatesRepository.findByName(companyId, templateName);
  if (!template || template.status !== 'approved') {
    logger.warn('[AppointmentNotifier] Plantilla de confirmación no encontrada o no aprobada — no se envía', {
      companyId, leadId: lead.id, templateName, status: template?.status ?? 'inexistente',
    });
    return { delivered: false, via: 'none', reason: 'plantilla_no_disponible' };
  }

  // Valores disponibles para las variables de la plantilla. Se llenan por nombre
  // de variable ({{nombre}}, {{fecha}}, {{hora}}, …); las claves que la plantilla
  // no use se ignoran y las no cubiertas caen a su valor de ejemplo.
  const first = friendlyFirstName(name);
  const variables: Record<string, string> = {
    nombre:     first,
    cliente:    first,
    empresa:    businessName,
    negocio:    businessName,
    fecha:      formatLongDate(start),
    hora:       formatTime(start),
    fecha_hora: `${formatLongDate(start)} a las ${formatTime(start)}`,
  };

  await sendTemplateToLead({ companyId, lead, template, variables });
  logger.info('[AppointmentNotifier] Confirmación enviada por plantilla (ventana cerrada)', {
    companyId, leadId: lead.id, templateName,
  });
  return { delivered: true, via: 'template' };
}
