import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { leadsRepository } from './leads.repository';
import { assignLead } from './leadAssignment.service';
import { messagesRepository } from '../messages/messages.repository';
import { templatesRepository } from '../templates/templates.repository';
import { sendTemplateToLead } from '../messages/templateSender.service';
import { toNormalizedPhone, phoneTail } from '../../utils/phone';
import { webAttributionToMetadata } from './webAttribution';
import type { Lead } from './leads.types';

export interface WebLeadInput {
  companyId:        string;
  name?:            string;
  /** Teléfono tal cual lo escribió el usuario (puede venir sin indicativo). */
  phone?:           string;
  email?:           string;
  message?:         string;
  /** Etiqueta de origen del formulario (proyecto/sección). Ej: "Laguna Mar". */
  source?:          string;
  /** Nombre de plantilla de bienvenida aprobada. Vacío = no enviar WhatsApp. */
  welcomeTemplate?: string;
  /** Atribución del tráfico: UTMs + fbclid/gclid + referrer, capturados en la web. */
  attribution?:     Record<string, string | undefined>;
}

export interface WebLeadResult {
  leadId:      string;
  created:     boolean;
  welcomeSent: boolean;
}

/**
 * Normaliza un teléfono colombiano a E.164 (+57XXXXXXXXXX). Si ya trae indicativo
 * (`+`) se respeta. Un celular de 10 dígitos que empieza por 3 se asume Colombia.
 * Devuelve '' si no hay dígitos suficientes.
 */
export function toE164Colombia(raw: string): string {
  const trimmed = (raw || '').trim();
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  // Fallback: si son 10-13 dígitos sin indicativo claro, anteponer +57.
  if (digits.length === 10) return `+57${digits}`;
  return `+${digits}`;
}

function firstName(name?: string): string {
  if (!name) return '';
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Resumen legible del formulario para dejarlo como mensaje de sistema en el chat. */
function formSummary(input: WebLeadInput, phone: string): string {
  const lines = [
    input.name    ? `• Nombre: ${input.name}`        : '',
    phone         ? `• Teléfono: ${phone}`           : '',
    input.email   ? `• Correo: ${input.email}`       : '',
    input.source  ? `• Origen: ${input.source}`      : '',
    input.message ? `• Mensaje: ${input.message}`    : '',
  ].filter(Boolean);
  return `🌐 *Nuevo lead del formulario web*\n${lines.join('\n')}`;
}

/**
 * Ingesta un lead que llegó por el formulario de la página web: crea (o asocia a
 * un lead existente por teléfono), lo asigna a un asesor, deja constancia del
 * formulario en el chat y —si el lead es nuevo y hay plantilla aprobada— abre la
 * conversación con una bienvenida por WhatsApp.
 *
 * La bienvenida solo se envía cuando el lead es NUEVO: si ya existía (p. ej. ya
 * había escrito por WhatsApp) no se reenvía la plantilla (evita costo y ruido).
 */
export async function ingestWebLead(input: WebLeadInput): Promise<WebLeadResult> {
  const { companyId } = input;
  const phone     = input.phone ? toE164Colombia(input.phone) : '';
  const normPhone = phone ? toNormalizedPhone(phone) : '';
  const now       = Timestamp.now();

  const metadata: Record<string, string> = {};
  if (input.email)   metadata.email      = input.email;
  if (input.message) metadata.webMessage = input.message;
  if (input.source)  metadata.webSource  = input.source;

  // Atribución del tráfico (de dónde vino el visitante a la web).
  Object.assign(metadata, webAttributionToMetadata(input.attribution ?? {}));

  // Buscar lead existente por teléfono; si no, crearlo.
  let lead: Lead | null = normPhone
    ? await leadsRepository.findByNormalizedPhone(companyId, normPhone)
    : null;
  let created = false;

  if (!lead) {
    lead = await leadsRepository.create(companyId, {
      companyId,
      phone,
      normalizedPhone: normPhone,
      ...(normPhone && phoneTail(normPhone) ? { phoneTail: phoneTail(normPhone) } : {}),
      name:            input.name || (phone ? `Lead ${phone}` : 'Lead de formulario web'),
      status:          'new',
      source:          'web',
      inboxProvider:   'ycloud',
      aiEnabled:       true,
      tags:            [],
      metadata,
      createdAt:       now,
      updatedAt:       now,
    });
    created = true;
    logger.info('[WebLead] Lead de formulario web creado', { companyId, leadId: lead.id, hasPhone: !!phone });
    lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
  } else {
    await leadsRepository.update(companyId, lead.id, {
      metadata: { ...lead.metadata, ...metadata },
      ...(input.name && (!lead.name || lead.name.startsWith('Lead ')) ? { name: input.name } : {}),
    });
    logger.info('[WebLead] Formulario web asociado a lead existente', { companyId, leadId: lead.id });
  }

  // Dejar constancia del formulario en el hilo del chat (mensaje de sistema, no dispara IA).
  await messagesRepository.create({
    companyId,
    leadId:      lead.id,
    direction:   'inbound',
    senderType:  'system',
    content:     formSummary(input, phone),
    channel:     'whatsapp',
    status:      'delivered',
    aiProcessed: true,
    createdAt:   now,
  });
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: '🌐 Lead del formulario web',
    lastMessageAt:   now,
  });

  // Bienvenida por WhatsApp: solo para leads NUEVOS y si hay plantilla + teléfono.
  let welcomeSent = false;
  if (created && phone && input.welcomeTemplate) {
    const template = await templatesRepository.findByName(companyId, input.welcomeTemplate);
    if (!template || template.status !== 'approved') {
      logger.warn('[WebLead] Plantilla de bienvenida no encontrada o no aprobada', {
        companyId, leadId: lead.id, tplName: input.welcomeTemplate,
      });
    } else {
      // Rellenar la primera variable del body con el nombre; el resto usa su ejemplo.
      const variables: Record<string, string> = { nombre: firstName(input.name) || 'Hola' };
      const firstVar = template.variables[0];
      if (firstVar) variables[firstVar.key] = firstName(input.name) || 'Hola';
      try {
        await sendTemplateToLead({ companyId, lead, template, variables });
        welcomeSent = true;
        logger.info('[WebLead] Bienvenida enviada por WhatsApp', { companyId, leadId: lead.id });
      } catch (err) {
        logger.warn('[WebLead] No se pudo enviar la bienvenida', {
          companyId, leadId: lead.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { leadId: lead.id, created, welcomeSent };
}
