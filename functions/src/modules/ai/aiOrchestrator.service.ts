import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getOpenAIClient } from '../../integrations/openai/openai.client';
import { env }             from '../../config/env';
import { db }              from '../../lib/admin';
import { leadsRepository } from '../leads/leads.repository';
import { assignLead } from '../leads/leadAssignment.service';
import type { Lead } from '../leads/leads.types';
import { messagesRepository } from '../messages/messages.repository';
import { sendTextToLeadChannel, sendMediaToLeadChannel } from '../messages/outboundText.service';
import { sendAdvisorPush } from '../messages/pushNotifications.service';
import { fetchPlanosIndex, matchPlano, planoFileName, planoLabel } from '../planos/planos.service';
import type { SendTextResult } from '../messages/outboundText.service';
import { followUpsRepository } from '../followups/followups.repository';
import { getAiConfig } from './aiConfig.repository';
import { buildOpenAiMessages, detectsTransferKeyword } from './aiContext.service';
import { bookAppointment, rescheduleAppointment, cancelActiveAppointment, findActiveAppointmentForLead } from '../appointments/appointments.service';
import { buildConfirmation, buildReschedule, buildCancellation } from '../appointments/appointmentMessages';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { getSchedulingConfig } from '../appointments/schedulingConfig';
import { AvailabilityError, findNearbyAvailableSlots, formatAvailabilityDate, formatSuggestions } from '../appointments/availability.service';
import { logger } from '../../utils/logger';
import type OpenAI from 'openai';
import type { Message } from '../messages/messages.types';
import type { AiConfig } from './ai.types';

export interface OrchestratorInput {
  companyId:   string;
  leadId:      string;
  messageId:   string;
  userMessage: string;
  mediaUrl?:   string;
  mediaType?:  string;
}

/**
 * Ventana de agrupación de ráfagas: si el lead escribe varios mensajes seguidos,
 * cada uno espera este tiempo; solo el ÚLTIMO responde (con toda la ráfaga en el
 * contexto), evitando respuestas múltiples y pisadas.
 */
const DEBOUNCE_MS = 6000;

/**
 * Guarda de costo / anti-loop: máximo de respuestas automáticas de la IA a un
 * mismo lead dentro de una ventana de 1 hora. Si se supera (spam o bucle entre
 * bots), se pausa la IA del lead para cortar el gasto y que un asesor lo revise.
 * El máximo es configurable con env.aiHourlyCap() (var AI_HOURLY_CAP, default 60).
 */
const AI_WINDOW_MS  = 60 * 60 * 1000;
const MEDIA_FOLLOWUP_DELAY_MS = 3500;
const MIN_FOLLOWUP_DELAY_MINUTES = 60;

/**
 * Aviso legal de bienvenida (Ley 1581 de 2012). Se envía de forma DETERMINISTA como
 * primer mensaje a todo lead nuevo de WhatsApp directo (una sola vez), en vez de
 * depender de que el modelo lo redacte. Debe coincidir con la sección 6 del prompt.
 */
const LEGAL_WELCOME =
  '🌳🌴 ¡Bienvenido a Grupo Constructor MERAKI! 🌴🌳\n\n' +
  'Este es nuestro canal oficial de ventas.\n\n' +
  'Al comunicarte por este medio, y conforme a la ' +
  'Ley 1581 de 2012, autorizas el tratamiento de tus datos personales para fines informativos, ' +
  'institucionales y comerciales.\n\n' +
  '✨ ¡Gracias por escribirnos! ¿Con quién tengo el gusto de hablar?';

const CUSTOMER_SERVICE_REDIRECT =
  'Gracias por escribirnos 😊 Para este tipo de solicitudes debes comunicarte con nuestro equipo de Servicio al Cliente.\n\n' +
  '📲 WhatsApp: 314 7868069\n\n' +
  '📧 Correo: servicioalclientegrupomeraki@gmail.com\n\n' +
  'Ellos podrán ayudarte de manera precisa con tu caso.';

const SENSITIVE_INQUIRY_ESCALATION =
  'Para darte información precisa y cuidar la disponibilidad actualizada, no manejamos listas completas de precios ni inventario por este canal. ' +
  'Te puedo ayudar con una opción concreta o te conecto con un asesor para revisar tu caso. 🙏';

const QUOTATION_LIMIT = 5;

/** Describe en una frase de dónde llegó el lead, para orientar a la IA sin inventar. */
function describeLeadOrigin(lead: Pick<Lead, 'source' | 'sourceMeta'>): string {
  switch (lead.source) {
    case 'meta_ads': {
      const h = lead.sourceMeta?.headline;
      return h
        ? `llegó desde un anuncio de Meta ("${h}")`
        : 'llegó desde un anuncio de Meta (Facebook/Instagram)';
    }
    case 'web':       return 'llegó desde la página web (formulario o botón de WhatsApp)';
    case 'facebook':  return 'llegó desde Facebook';
    case 'instagram': return 'llegó desde Instagram';
    case 'manual':    return 'fue cargado por un asesor';
    default:          return 'escribió directamente por WhatsApp';
  }
}

function isKnownLeadName(name: string | undefined): name is string {
  const clean = name?.trim() ?? '';
  return clean.length > 1 && !/^lead\b/i.test(clean) && !/^\+?\d/.test(clean);
}

function buildLegalWelcome(lead: Pick<Lead, 'name' | 'source'>): string {
  if (!isKnownLeadName(lead.name)) return LEGAL_WELCOME;
  const intro = lead.source === 'web' || lead.source === 'meta_ads' || lead.source === 'manual'
    ? `Hola, ${lead.name.trim()}. Gracias por dejarnos tus datos.`
    : `Hola, ${lead.name.trim()}. Gracias por escribirnos.`;
  return (
    '🌳🌴 ¡Bienvenido a Grupo Constructor MERAKI! 🌴🌳\n\n' +
    `${intro}\n\n` +
    'Este es nuestro canal oficial de ventas. Al comunicarte por este medio, y conforme a la Ley 1581 de 2012, ' +
    'autorizas el tratamiento de tus datos personales para fines informativos, institucionales y comerciales.\n\n' +
    'Actualmente tenemos clubes de campo en Alvarado, Melgar y Mariquita, Tolima.\n\n' +
    '¿En cuál de estos municipios te gustaría invertir?'
  );
}

function hasLegalWelcome(messages: Message[]): boolean {
  return messages.some((message) =>
    message.direction === 'outbound' &&
    /ley\s*1581|tratamiento de tus datos personales|canal oficial de ventas/i.test(message.content ?? '')
  );
}

function shouldRedirectToCustomerService(text: string): boolean {
  const t = normalizeText(text);
  const patterns = [
    /\b(pqrs?|pqr)\b/,
    /\bpaz\s+y\s+salvo\b/,
    /\bestado(s)?\s+de\s+cuenta\b/,
    /\b(servicio\s+al\s+cliente|posventa|postventa|cartera)\b/,
    /\b(mora|moroso|morosa|cobro\s+prejuridico)\b/,
    /\b(cliente\s+actual|ya\s+compre|ya\s+compre|soy\s+propietari[oa]|propietari[oa])\b/,
    /\b(mi|mis|consultar|revisar|pagar|debo|deuda|pendiente)\b.{0,40}\b(saldo|saldos|cuota|cuotas|pago|pagos)\b/,
    /\b(saldo|saldos|cuota|cuotas|pago|pagos)\b.{0,40}\b(pendiente|debo|deuda|vencid[oa]|mora|pagar)\b/,
    /\b(mi|mis|consultar|revisar|copia|firmar|firma|estado|proceso|tramite|tramites|tr[aá]mite|tr[aá]mites)\b.{0,40}\b(escritura|escrituras|escrituracion)\b/,
    /\b(escritura|escrituras|escrituracion)\b.{0,40}\b(mi|mis|copia|firmada|firmar|firma|estado|proceso|actual|cliente|tramite|tramites|tr[aá]mite|tr[aá]mites)\b/,
    /\b(mi|mis|copia|firmar|firma|estado|numero|n[uú]mero)\b.{0,40}\b(contrato|contratos|documento|documentos|tramite|tramites)\b/,
    /\b(contrato|contratos|documento|documentos|tramite|tramites)\b.{0,40}\b(firmado|copia|estado|actual|cliente|radicado)\b/,
  ];
  return patterns.some((pattern) => pattern.test(t));
}

function detectsSensitiveInquiry(text: string): boolean {
  const t = normalizeText(text);
  const patterns = [
    /\blista\s+(completa|total)\s+de\s+precios\b/,
    /\b(todos|todas)\s+los\s+(precios|terrenos|lotes|disponibles)\b/,
    /\binventario\s+(completo|total|por\s+sectores?)\b/,
    /\b(disponibilidad|precios)\s+(completa|total|por\s+sectores?)\b/,
    /\b(descuentos?\s+internos?|margenes?|comisiones?|nombres?\s+de\s+compradores?|datos\s+privados)\b/,
  ];
  return patterns.some((pattern) => pattern.test(t));
}

function aiHourlyPatch(
  freshLead: Lead,
  nowMs: number,
  windowActive: boolean,
  priorCount: number,
  increment: number
): Pick<Lead, 'aiHourlyCount' | 'aiHourlyWindowStart'> {
  return {
    aiHourlyCount: priorCount + increment,
    aiHourlyWindowStart: windowActive
      ? (freshLead.aiHourlyWindowStart ?? Timestamp.fromMillis(nowMs))
      : Timestamp.fromMillis(nowMs),
  };
}

function quoteKey(sector: string, terreno: string, pago: string, meses: number | undefined, bonoGanado: number): string {
  const base = `${normalizeText(sector)}:${normalizeText(terreno)}:${pago}`;
  return `${base}:${pago === 'cuotas' ? (meses ?? '') : 'contado'}:${bonoGanado || 'base'}`.slice(0, 180);
}

interface RecentQuotationContext {
  sector?: string;
  terreno: string;
  pago?: string;
  meses?: string;
}

interface RecentPlanoContext {
  planoId?: string;
  projectName?: string;
  stageName?: string | null;
  name?: string;
}

interface LibraryPortfolioItem {
  id: string;
  title?: string;
  project?: string;
  fileName?: string;
  storagePath?: string;
  downloadUrl?: string;
  contentType?: string;
  sizeBytes?: number;
  kind?: string;
  visibility?: string;
}

function normKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function portfolioSearchAliases(project: string): string[] {
  const p = normKey(project);
  if (!p || /\b(GENERAL|MERAKI|PORTAFOLIO GENERAL)\b/.test(p)) {
    return ['PORTAFOLIO GENERAL MERAKI', 'GENERAL MERAKI', 'GC MERAKI', 'MERAKI'];
  }
  if (/\b(CANON|CAÑON|ARIZONA)\b/.test(p)) return ['CANON DE ARIZONA', 'CAÑON DE ARIZONA', 'ARIZONA'];
  if (/\b(LAGUNA|MAR|SANTORINI|CANARIAS)\b/.test(p)) return ['LAGUNA MAR', 'MAR SANTORINI', 'MAR CANARIAS'];
  if (/\b(RIO|RÍO|CLARO|LAGUNILLA|MEDINA)\b/.test(p)) return ['RIO CLARO', 'RÍO CLARO', 'LAGUNILLA', 'MEDINA'];
  if (/\b(LLANO|GRANDE|SAN ANTONIO|ABURRA|ABURRÁ)\b/.test(p)) return ['LLANO GRANDE', 'SAN ANTONIO', 'VALLE DE ABURRA'];
  if (/\b(SOBRE|MONTAÑAS|MONTANAS)\b/.test(p)) return ['SOBRE MONTAÑAS', 'SOBRE MONTANAS'];
  return [project];
}

function portfolioScore(item: LibraryPortfolioItem, aliases: string[], wantsGeneral: boolean): number {
  const haystack = normKey(`${item.project ?? ''} ${item.title ?? ''} ${item.fileName ?? ''}`);
  let score = 0;
  if (item.kind && item.kind !== 'document') score -= 20;
  if (item.visibility && item.visibility !== 'general') score -= 20;
  if (item.contentType && !/pdf|image/i.test(item.contentType)) score -= 10;
  if (/\b(PORTAFOLIO|BROCHURE|BROUCHURE)\b/.test(haystack)) score += 8;
  if (wantsGeneral && /\b(GENERAL|GC MERAKI|MERAKI)\b/.test(haystack)) score += 12;
  if (!wantsGeneral && /\b(GENERAL)\b/.test(haystack)) score -= 12;
  for (const alias of aliases.map(normKey)) {
    if (!alias) continue;
    if (normKey(item.project) === alias) score += 30;
    if (haystack.includes(alias)) score += 12;
  }
  return score;
}

async function findPortfolioItem(companyId: string, project: string): Promise<LibraryPortfolioItem | null> {
  const snap = await db.collection('companies').doc(companyId).collection('library').get();
  const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LibraryPortfolioItem))
    .filter((item) => !!item.downloadUrl);
  if (items.length === 0) return null;
  const aliases = portfolioSearchAliases(project);
  const wantsGeneral = aliases.some((alias) => /\b(GENERAL|MERAKI|GC MERAKI)\b/.test(normKey(alias)));
  const ranked = items
    .map((item) => ({ item, score: portfolioScore(item, aliases, wantsGeneral) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.sizeBytes ?? 0) - (b.item.sizeBytes ?? 0));
  return ranked[0]?.item ?? null;
}

async function portfolioAlreadySent(companyId: string, leadId: string, itemId: string): Promise<boolean> {
  const recent = await messagesRepository.getRecent(companyId, leadId, 40);
  return recent.some((message) => {
    const meta = message.metadata as { origin?: string; portfolioItemId?: string } | undefined;
    return meta?.origin === 'ai_portafolio' && meta.portfolioItemId === itemId;
  });
}

function latestAiQuotation(history: Message[]): RecentQuotationContext | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const metadata = message.metadata;
    if (
      message.direction === 'outbound' &&
      message.senderType === 'ai' &&
      metadata?.origin === 'ai_cotizacion' &&
      typeof metadata.terreno === 'string'
    ) {
      return {
        sector: typeof metadata.sector === 'string' ? metadata.sector : undefined,
        terreno: metadata.terreno,
        pago: typeof metadata.pago === 'string' ? metadata.pago : undefined,
        meses: typeof metadata.meses === 'string' ? metadata.meses : undefined,
      };
    }
  }
  return null;
}

function latestAiPlano(history: Message[]): RecentPlanoContext | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const metadata = message.metadata;
    if (
      message.direction === 'outbound' &&
      message.senderType === 'ai' &&
      metadata?.origin === 'ai_plano'
    ) {
      return {
        planoId: typeof metadata.planoId === 'string' ? metadata.planoId : undefined,
        projectName: typeof metadata.projectName === 'string' ? metadata.projectName : undefined,
        stageName: typeof metadata.stageName === 'string' || metadata.stageName === null ? metadata.stageName : undefined,
        name: typeof metadata.name === 'string' ? metadata.name : undefined,
      };
    }
  }
  return null;
}

function formatQuotationPayment(quotation: RecentQuotationContext): string {
  if (quotation.pago === 'cuotas') {
    return quotation.meses ? `en ${quotation.meses} cuotas` : 'en cuotas';
  }
  return 'de contado';
}





async function reserveQuotationSlot(
  companyId: string,
  leadId: string,
  key: string
): Promise<{ ok: true; count: number } | { ok: false; count: number }> {
  const ref = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Lead | undefined;
    const count = data?.aiQuotationCount ?? 0;
    if (count >= QUOTATION_LIMIT) {
      tx.update(ref, {
        aiQuotationLimitReachedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return { ok: false, count };
    }
    tx.update(ref, {
      aiQuotationCount: count + 1,
      aiQuotedTerrenos: FieldValue.arrayUnion(key),
      updatedAt: Timestamp.now(),
    });
    return { ok: true, count: count + 1 };
  });
}

async function releaseQuotationSlot(companyId: string, leadId: string, key: string): Promise<void> {
  const ref = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Lead | undefined;
    const count = Math.max(0, (data?.aiQuotationCount ?? 0) - 1);
    tx.update(ref, {
      aiQuotationCount: count,
      aiQuotedTerrenos: FieldValue.arrayRemove(key),
      updatedAt: Timestamp.now(),
    });
  }).catch((err) => {
    logger.warn('[AI] No se pudo liberar cupo de cotización', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface AvailabilitySlotMetadata {
  index: number;
  iso:   string;
  label: string;
}

interface AiResponseMetadata {
  availabilitySlots?: AvailabilitySlotMetadata[];
}

/**
 * Orquestador principal de respuestas de IA.
 *
 * Flujo:
 * 1. Verifica que la IA sigue activa para el lead.
 * 2. Carga configuración de IA desde Firestore.
 * 3. Carga historial de mensajes (limitado a maxContextMessages).
 * 4. Detecta si el usuario pide transferir a humano.
 * 5. Genera respuesta con OpenAI.
 * 6. Guarda mensaje de IA en Firestore.
 * 7. Envía por el canal del lead (WhatsApp/YCloud, Messenger o Instagram).
 * 8. Actualiza lead.lastMessageText.
 */
export async function orchestrateAiResponse(
  input: OrchestratorInput
): Promise<void> {
  let { companyId, leadId, messageId, userMessage, mediaUrl, mediaType } = input;

  // 1. Verificar que la IA sigue activa (puede haber cambiado desde que llegó el mensaje)
  const lead = await leadsRepository.findById(companyId, leadId);
  if (!lead) {
    logger.warn('[AI] Lead no encontrado', { companyId, leadId });
    return;
  }
  if (!lead.aiEnabled) {
    logger.info('[AI] IA pausada para este lead — no se genera respuesta', { leadId });
    return;
  }

  // 1b. Verificación a nivel de empresa: hay que tener configurado al menos un
  //     canal de envío (YCloud para WhatsApp, o Meta para Messenger/Instagram).
  //     No es un check por lead — solo evita intentar responder si la empresa
  //     no tiene ningún proveedor de mensajería configurado.
  if (!env.useYcloud() && !env.metaConfigured()) {
    logger.warn('[AI] Ningún canal de mensajería configurado — se omite respuesta IA', { leadId });
    return;
  }

  // 2. Cargar config de IA
  const config = await getAiConfig(companyId);
  if (!config.enabled) {
    logger.info('[AI] IA deshabilitada para la empresa', { companyId });
    return;
  }

  // 2b. Debounce: agrupar ráfagas. Esperamos y, si ya llegó un mensaje más
  //     nuevo del lead, dejamos que ESE responda toda la ráfaga (incluye este
  //     mensaje en su historial). Así no contestamos 3 veces a 3 globos seguidos.
  await sleep(DEBOUNCE_MS);
  const latest = await messagesRepository.getLatest(companyId, leadId);
  if (latest && latest.id !== messageId && latest.direction === 'inbound' && latest.senderType === 'lead') {
    logger.info('[AI] Mensaje más nuevo durante el debounce — lo maneja ese', { leadId, messageId, latestId: latest.id });
    return;
  }

  // Revalidar que la IA no fue pausada durante la espera (asesor tomó el control).
  const freshLead = await leadsRepository.findById(companyId, leadId);
  if (!freshLead?.aiEnabled) {
    logger.info('[AI] IA pausada durante el debounce — no se responde', { leadId });
    return;
  }

  // 2b-bis. Guarda de costo / anti-loop: si la IA ya respondió demasiado en la
  //         última hora a este lead, se pausa y no se responde (spam o bucle).
  const nowMs        = Date.now();
  const windowActive = nowMs - (freshLead.aiHourlyWindowStart?.toMillis?.() ?? 0) < AI_WINDOW_MS;
  const priorCount   = windowActive ? (freshLead.aiHourlyCount ?? 0) : 0;
  if (priorCount >= env.aiHourlyCap()) {
    logger.warn('[AI] Tope horario de respuestas alcanzado — se pausa la IA (posible loop/spam)', {
      leadId, count: priorCount,
    });
    await leadsRepository.update(companyId, leadId, { aiEnabled: false });
    return;
  }

  // 2c. Procesar media (tras el debounce, para no gastar en mensajes descartados)
  if (mediaUrl && mediaType) {
    if (mediaType.startsWith('audio/')) {
      // Transcribir audio con Whisper
      try {
        logger.info('[AI] Transcribiendo audio con Whisper', { leadId });
        userMessage = await transcribeAudio(mediaUrl, mediaType);
        logger.info('[AI] Transcripción lista', { leadId, length: userMessage.length });
      } catch (err) {
        logger.error('[AI] Error transcribiendo audio', { error: String(err) });
        userMessage = '[El lead envió un audio que no se pudo transcribir]';
      }
      mediaUrl  = undefined; // ya está en texto, no enviar como imagen
      mediaType = undefined;
    } else if (!mediaType.startsWith('image/')) {
      // Documentos, video, stickers: la IA no puede abrirlos → darle contexto en texto.
      const kind =
        mediaType.startsWith('video/')                                  ? 'un video' :
        /(pdf|word|document|sheet|excel|presentation)/i.test(mediaType) ? 'un documento' :
        mediaType.includes('sticker')                                   ? 'un sticker' :
                                                                          'un archivo';
      if (!userMessage.trim()) {
        userMessage =
          `[El lead envió ${kind} que no puedo abrir. Reconócelo con naturalidad ` +
          `y pregúntale en qué puedes ayudarle o pídele que te lo cuente por texto.]`;
      }
      mediaUrl  = undefined;
      mediaType = undefined;
    }
    // Imágenes: se pasan a buildOpenAiMessages para usar vision.
  }

  // Mensaje de un tipo no soportado (sticker raro, "unsupported", etc.): el webhook lo
  // guardó con una etiqueta ⚠️. Le damos a la IA una instrucción limpia para que pida
  // reenviarlo, en lugar de que interprete la etiqueta como si fuera el texto del lead.
  if (/mensaje no compatible/i.test(userMessage)) {
    userMessage =
      '[El lead envió un mensaje de un tipo que no puedo procesar. Pídele con amabilidad y ' +
      'naturalidad que te lo reenvíe como texto, o como imagen, PDF o audio.]';
  }

  const customerServiceIntent = shouldRedirectToCustomerService(userMessage);
  const sensitiveInquiry      = detectsSensitiveInquiry(userMessage);

  // 2b-ter. PRIMER CONTACTO: aviso legal de bienvenida (Ley 1581) determinista.
  // Se envía aunque el lead venga de formulario/pauta si todavía no hay evidencia
  // de aviso legal previo. Si ya conocemos el nombre, no lo volvemos a pedir.
  if (!freshLead.legalWelcomeSent) {
    const previous = await messagesRepository.getRecent(companyId, leadId, 10);
    const legalAlreadySent = hasLegalWelcome(previous);
    if (!legalAlreadySent) {
      logger.info('[AI] Primer contacto — enviando aviso legal de bienvenida', {
        leadId,
        source: lead.source,
        knownName: isKnownLeadName(lead.name),
      });
      const sentAt = await saveAndSendAiResponse(companyId, leadId, lead, buildLegalWelcome(lead));
      const followUpPatch = aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 1);

      // Si desde el primer mensaje ya se ve que es Servicio al Cliente o una
      // solicitud sensible, enviamos el aviso legal primero y luego la ruta correcta.
      if (customerServiceIntent) {
        await saveAndSendAiResponse(companyId, leadId, lead, CUSTOMER_SERVICE_REDIRECT);
        await leadsRepository.update(companyId, leadId, {
          legalWelcomeSent: true,
          customerServiceRedirectedAt: Timestamp.now(),
          ...aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 2),
        });
        await messagesRepository.markAiProcessed(companyId, leadId, messageId);
        return;
      }
      if (sensitiveInquiry) {
        await saveAndSendAiResponse(companyId, leadId, lead, SENSITIVE_INQUIRY_ESCALATION);
        await leadsRepository.update(companyId, leadId, {
          legalWelcomeSent: true,
          aiEnabled: false,
          sensitiveInquiryEscalatedAt: Timestamp.now(),
          ...aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 2),
        });
        await sendAdvisorPush(companyId, lead.assignedTo, {
          title: `Solicitud sensible de ${lead.name?.trim() || lead.phone || 'un lead'}`,
          body:  'La IA limitó la información y pausó el chat para revisión humana.',
          url:   `/dashboard/inbox?lead=${leadId}`,
          type:  'lead-attention',
          leadId,
        }).catch(() => { /* best-effort */ });
        await messagesRepository.markAiProcessed(companyId, leadId, messageId);
        return;
      }

      await leadsRepository.update(companyId, leadId, {
        legalWelcomeSent: true,
        ...followUpPatch,
      });
      await messagesRepository.markAiProcessed(companyId, leadId, messageId);
      await scheduleFollowUps(companyId, leadId, sentAt, config);
      return;
    }
    await leadsRepository.update(companyId, leadId, { legalWelcomeSent: true });
  }

  if (customerServiceIntent) {
    logger.info('[AI] Derivación determinista a Servicio al Cliente', { leadId });
    await saveAndSendAiResponse(companyId, leadId, lead, CUSTOMER_SERVICE_REDIRECT);
    await leadsRepository.update(companyId, leadId, {
      customerServiceRedirectedAt: Timestamp.now(),
      ...aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 1),
    });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  if (sensitiveInquiry) {
    logger.info('[AI] Solicitud sensible/posible competencia — escalando a asesor', { leadId });
    await saveAndSendAiResponse(companyId, leadId, lead, SENSITIVE_INQUIRY_ESCALATION);
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      sensitiveInquiryEscalatedAt: Timestamp.now(),
      ...aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 1),
    });
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title: `Solicitud sensible de ${lead.name?.trim() || lead.phone || 'un lead'}`,
      body:  'La IA limitó la información y pausó el chat para revisión humana.',
      url:   `/dashboard/inbox?lead=${leadId}`,
      type:  'lead-attention',
      leadId,
    }).catch(() => { /* best-effort */ });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // 3. Detectar keyword de transferencia a humano
  if (detectsTransferKeyword(userMessage, config.transferKeywords)) {
    logger.info('[AI] Keyword de transferencia detectado', { leadId, userMessage });
    const transferMsg = '¡Claro! Te voy a conectar con uno de nuestros asesores. Por favor espera un momento. 🙏';
    await saveAndSendAiResponse(companyId, leadId, lead, transferMsg);
    // Pausar IA automáticamente
    await leadsRepository.update(companyId, leadId, { aiEnabled: false });
    return;
  }

  // 4. Cargar historial reciente
  const history: Message[] = await messagesRepository.getRecent(
    companyId,
    leadId,
    config.maxContextMessages
  );

  const selectedSlot = resolveAvailabilitySelection(userMessage, history, env.calendarTimeZone());
  if (selectedSlot) {
    logger.info('[AI] Horario elegido desde lista previa — agendando directo', {
      leadId,
      selectedSlot: selectedSlot.iso,
    });
    const result = await runAppointmentTool(companyId, leadId, {
      id:   `availability_${selectedSlot.index}`,
      type: 'function',
      function: {
        name:      'agendar_cita',
        arguments: JSON.stringify({ fecha_hora_iso: selectedSlot.iso, duracion_minutos: 30 }),
      },
    }, config.businessName);
    const confirmation = (result as { confirmationMessage?: string }).confirmationMessage;
    const fallback = (result as { mensaje?: string }).mensaje ?? config.fallbackMessage;
    const aiSentAt = await saveAndSendAiResponse(companyId, leadId, lead, confirmation ?? fallback);

    await leadsRepository.update(companyId, leadId, {
      aiHourlyCount:       priorCount + 1,
      aiHourlyWindowStart: windowActive
        ? (freshLead.aiHourlyWindowStart ?? Timestamp.fromMillis(nowMs))
        : Timestamp.fromMillis(nowMs),
    });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    if ((result as { scheduled?: boolean }).scheduled) {
      await followUpsRepository.cancelPendingForLead(companyId, leadId);
    } else {
      await scheduleFollowUps(companyId, leadId, aiSentAt, config);
    }
    return;
  }

  // 5. Construir mensajes para OpenAI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = buildOpenAiMessages(config, history, userMessage, mediaUrl, mediaType) as any[];

  // Inyectar fecha/hora actual para que la IA calcule correctamente fechas relativas
  const tz  = env.calendarTimeZone();
  const nowStr = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full', timeStyle: 'short', timeZone: tz,
  }).format(new Date());
  messages.push({
    role: 'system',
    content: `Contexto temporal: hoy es ${nowStr} (zona horaria ${tz}). ` +
      `Usa siempre fechas en formato ISO 8601 con offset -05:00. ` +
      `Antes de pedir fecha u hora para agendar, si el lead ya aceptó agendar y el número está confirmado, ` +
      `usa consultar_horarios para ofrecer opciones reales cercanas. Si el lead pregunta "qué hay disponible", ` +
      `usa consultar_horarios; nunca inventes una lista de horarios. ` +
      `Cuando el lead elija uno de los horarios devueltos por consultar_horarios, usa agendar_cita con ` +
      `ese ISO exacto. Si el lead propone un día/hora distinto, valida disponibilidad con agendar_cita ` +
      `y no confirmes hasta que la herramienta responda. ` +
      `NUNCA inventes, asumas ni propongas tú la fecha o la hora: las opciones deben salir de ` +
      `consultar_horarios o de una propuesta explícita del lead. ` +
      `Si el lead muestra interés en agendar pero aún no ha elegido horario, llama consultar_horarios ` +
      `primero. Solo pregunta qué día/hora quiere revisar cuando consultar_horarios no devuelva opciones ` +
      `o cuando el lead rechace los horarios ofrecidos. ` +
      `Usa reagendar_cita SOLO si el lead pide EXPLÍCITAMENTE cambiar/mover/reprogramar su cita Y da una ` +
      `nueva fecha Y hora concretas; nunca reagendes por un mensaje vago ni inventes la nueva fecha/hora. ` +
      `Usa cancelar_cita solo si el lead pide explícitamente cancelar o anular su cita. ` +
      `MUY IMPORTANTE: mensajes vagos o de interés como "me gusta", "me interesa", "me encanta", "genial", ` +
      `"perfecto", "buenísimo", "listo", "ok", "gracias", "dale", "de una" NO son solicitudes de agendar, ` +
      `reagendar ni cancelar. Si el lead dice "me gusta" (sobre un terreno o cotización) es INTERÉS: ` +
      `respóndele y, si no tiene cita, OFRÉCELE agendar (sin llamar herramientas hasta que él dé fecha y ` +
      `hora); si YA tiene cita, cierra corto y cordial SIN llamar ninguna herramienta. NO llames ` +
      `agendar_cita/reagendar_cita/cancelar_cita salvo que el lead lo pida con una acción clara y, para ` +
      `agendar o reagendar, con fecha y hora concretas dadas por él.`,
  });
  messages.push({
    role: 'system',
    content:
      `Datos internos del lead para esta conversación: nombre registrado: "${lead.name || ''}". ` +
      `Teléfono registrado: "${lead.phone || ''}". ` +
      `Si el teléfono registrado no está vacío y el lead quiere agendar, NO preguntes a qué número desea ` +
      `recibir la llamada de entrada: confirma ese número exacto. Si el lead dice "a este número", ` +
      `interpreta que se refiere al teléfono registrado. Si el teléfono está vacío, entonces sí debes pedirlo.`,
  });
  messages.push({
    role: 'system',
    content:
      `Si tu último mensaje preguntó si el lead quería conocer las amenidades y el lead responde "sí", ` +
      `NO llames enviar_plano todavía: primero enumera las amenidades del club elegido y luego pregunta si ` +
      `quiere ver el plano/disponibilidad. ` +
      `Cuando el lead ya conoció las amenidades de un club de campo y muestra interés en ver los ` +
      `terrenos, la disponibilidad o los precios (o pide el plano), usa la herramienta enviar_plano ` +
      `con el club (y la etapa si es Laguna Mar). No describas ni escribas el plano tú mismo: la ` +
      `herramienta ya lo envía y redacta el mensaje. Si el lead eligió Laguna Mar pero no dijo la ` +
      `etapa (Mar Santorini o Mar Canarias), pregúntasela antes de llamar la herramienta. ` +
      `IMPORTANTE: envía el plano de un club UNA SOLA VEZ por conversación. Tras enviarlo, ESPERA a ` +
      `que el lead responda; no pidas datos de contacto todavía. Si el lead menciona un terreno ` +
      `específico (p. ej. "me gusta el 71", "el lote amarillo"), NO vuelvas a llamar enviar_plano y NO ` +
      `saltes a pedir el número de contacto de golpe: primero, de forma natural, OFRÉCELE agendar una ` +
      `llamada con uno de nuestros agentes inmobiliarios para darle información personalizada y una ` +
      `cotización de ese terreno, y espera a que acepte. Solo cuando acepte, confirma el teléfono ` +
      `registrado si existe; si no existe, pídelo. Después de confirmar el número, NO preguntes qué día ` +
      `desea: llama consultar_horarios y ofrece opciones reales cercanas. Si ninguna opción le sirve, ` +
      `entonces pregúntale qué día y hora quiere revisar y valida disponibilidad antes de confirmar.`,
  });
  messages.push({
    role: 'system',
    content:
      `El saludo/aviso legal de bienvenida lo gestiona el sistema automáticamente: NO lo envíes tú ni ` +
      `vuelvas a pedir el consentimiento de datos. Origen del lead: ${describeLeadOrigin(lead)}. ` +
      `Un lead puede llegar de una pauta (incluso del exterior), de un formulario o de WhatsApp directo; ` +
      `ubícate con naturalidad según su origen y su mensaje. Responde SIEMPRE, y SOLO con la información ` +
      `de tus instrucciones: si te preguntan algo que no está ahí (o un dato que no tienes), dilo con ` +
      `transparencia y ofrece que un asesor lo confirme. Nunca inventes precios, áreas, fechas, estados ` +
      `de obra ni características.`,
  });
  messages.push({
    role: 'system',
    content:
      `Portafolios/Brochures: cuando el lead elija un club/proyecto concreto por primera vez ` +
      `(Cañón de Arizona, Laguna Mar, Río Claro, Llano Grande o Sobre Montañas), usa enviar_portafolio ` +
      `con ese proyecto para enviar el PDF aprobado, después de presentarlo brevemente y sin sonar insistente. ` +
      `NO envíes el portafolio general en el primer saludo. Si el lead pide información general, pregunta primero ` +
      `qué municipio o club le interesa y puedes ofrecer el portafolio general como apoyo opcional, por ejemplo: ` +
      `"Si quieres, también puedo enviarte el portafolio general para que veas todas las opciones." ` +
      `Usa enviar_portafolio con "PORTAFOLIO GENERAL MERAKI" solo si el lead lo pide o acepta verlo. ` +
      `No prometas ni reenvíes un portafolio si ya fue enviado. Después de enviar un portafolio, continúa ` +
      `con una pregunta útil sobre ubicación, amenidades, plano o terreno de interés.`,
  });

  const currentTurnHasImage = !!mediaUrl && !!mediaType?.startsWith('image/');
  const recentPlano = latestAiPlano(history);
  if (currentTurnHasImage) {
    const planoText = recentPlano?.projectName
      ? ` El último plano enviado fue ${recentPlano.projectName}${recentPlano.stageName ? ` - ${recentPlano.stageName}` : ''}.`
      : '';
    messages.push({
      role: 'system',
      content:
        `El lead adjuntó una imagen NUEVA en este turno. Esa imagen tiene prioridad sobre cualquier terreno ` +
        `o cotización anterior. Si la imagen trae un terreno señalado, encerrado o marcado, debes intentar leer ` +
        `ese número y su sector/color en la imagen.${planoText} Si la imagen viene de un plano con colores de sector ` +
        `y se ve el color del terreno marcado, usa el mapa de colores del proyecto para inferir el sector y NO preguntes ` +
        `el sector. Por ejemplo, en Cañón de Arizona: rojo/vino = Los Angeles, azul = Texas, azul oscuro = Colorado, ` +
        `naranja = Las Vegas, amarillo = Sn.FRANCISCO. NO respondas usando el último terreno cotizado salvo que el ` +
        `lead diga explícitamente "el mismo", "el anterior" o "el que ya me cotizaste". Si no puedes identificar ` +
        `con seguridad el número o el sector/etapa del terreno marcado, pregunta para confirmar; no inventes.`,
    });
  } else if (recentPlano?.projectName) {
    messages.push({
      role: 'system',
      content:
        `Contexto del plano reciente: el último plano enviado fue ${recentPlano.projectName}` +
        `${recentPlano.stageName ? ` - ${recentPlano.stageName}` : ''}. Si el lead responde con número + color ` +
        `(por ejemplo "59 rojo"), interpreta ese color según ese proyecto y cotiza si ya dio forma de pago. ` +
        `En Cañón de Arizona: rojo/vino = Los Angeles, azul = Texas, azul oscuro = Colorado, naranja = Las Vegas, amarillo = Sn.FRANCISCO.`,
    });
  }

  const recentQuotation = latestAiQuotation(history);
  if (recentQuotation && !currentTurnHasImage) {
    const sectorText = recentQuotation.sector ? ` del sector/etapa ${recentQuotation.sector}` : '';
    messages.push({
      role: 'system',
      content:
        `Contexto comercial reciente: ya enviaste una cotización del terreno ${recentQuotation.terreno}${sectorText} ` +
        `${formatQuotationPayment(recentQuotation)}. Si el lead dice "este", "ese", "el mismo", "ese terreno" o pregunta ` +
        `por condiciones de ese terreno, interpreta que habla de esa cotización reciente. NO vuelvas a preguntar si lo ` +
        `quiere de contado o en cuotas, ni a cuántos meses, salvo que el lead pida explícitamente cambiar la forma de ` +
        `pago, recotizar o aplicar un bono ganado. Responde la pregunta puntual y luego ofrece agendar/hablar con un asesor.`,
    });
  }

  if ((freshLead.aiQuotationCount ?? 0) >= QUOTATION_LIMIT) {
    messages.push({
      role: 'system',
      content:
        `Este lead ya alcanzó el límite interno de ${QUOTATION_LIMIT} cotizaciones. NO pidas otra vez contado/cuotas, ` +
        `NO pidas meses y NO llames enviar_cotizacion. Enfoca la conversación en elegir entre las opciones ya revisadas ` +
        `o en agendar una llamada con un asesor para validar disponibilidad en vivo.`,
    });
  }

  // Cotización de precios: la controla el admin con quoteMode (Config → Asistente IA).
  if (config.quoteMode !== 'off') {
    const proactivo = config.quoteMode === 'proactive';
    messages.push({
      role: 'system',
      content:
        `Si el lead envía una imagen del plano con un terreno marcado, encerrado en un círculo o señalado, analiza la imagen cuidadosamente para extraer el número del terreno que está resaltado y usa ese número. ` +
        `Si el lead escribe un número explícitamente en su mensaje (ej. "89 amarillo"), USA SIEMPRE el número que escribió (89), no inventes ni repitas números anteriores. ` +
        `Si el lead ya dio plazo o forma de pago en el mismo mensaje o en el mensaje inmediatamente anterior (ej. "a 12 meses", "24 meses", "contado"), y la imagen permite inferir número + sector/color, usa enviar_cotizacion directamente; NO preguntes sector ni repitas la pregunta de pago. ` +
        `Si el lead pregunta por "el más pequeño", "el más barato", "el menor área" o similares, NO respondas con rangos generales del proyecto ni asumas que el mínimo publicado sigue disponible. Debes pedir sector/terreno concreto o decir que esa disponibilidad debe validarse con el plano/cotizador o un asesor. ` +
        `Cuando el lead adjunta una imagen nueva y pregunta precio/cotización de "este", la imagen nueva manda: usa el terreno marcado en esa imagen, no el último terreno cotizado. ` +
        `IMPORTANTE (anula cualquier regla previa que prohíba dar precios exactos): tienes habilitado ` +
        `cotizar. Cuando el lead haya elegido un terreno concreto (número + sector/color), verifica primero si ya ` +
        `enviaste la cotización de ESE terreno en los mensajes anteriores. Si YA enviaste la cotización de ese terreno, ` +
        `NO vuelvas a preguntar por la forma de pago ni ofrezcas cotizarlo de nuevo; simplemente responde a su pregunta ` +
        `y ofrécele agendar una llamada con un asesor. ` +
        `Si aún no has enviado la cotización de ese terreno, NO inventes el ` +
        `precio: pregúntale si lo quiere de contado o en cuotas (y si es en cuotas, a cuántos meses), y ` +
        `luego usa la herramienta enviar_cotizacion — ella calcula el valor real y envía la imagen. ` +
        (proactivo
          ? `Ofrece la cotización de forma proactiva apenas el lead elija un terreno. `
          : `Cotiza cuando el lead pregunte por el precio de un terreno. `) +
        `El parámetro "sector" de enviar_cotizacion DEBE ser el SECTOR o ETAPA EXACTO, NUNCA el nombre general del club de campo. ` +
        `Mapa de sectores válidos: ` +
        `Cañón de Arizona → Texas (azul), Colorado (azul oscuro), Las Vegas (naranja), Los Angeles (rojo/vino), Sn.FRANCISCO (amarillo). ` +
        `Río Claro → Lagunilla (azul), Medina (verde). ` +
        `Llano Grande → San Antonio, Valle de Aburrá. ` +
        `Laguna Mar → Mar Santorini, Mar Canarias. ` +
        `Sobre Montañas → Sobre Montañas. ` +
        `¡MUY IMPORTANTE SOBRE LOS COLORES!: Si el lead pide un terreno por color (ej. "el 43 amarillo"), REVISA PRIMERO de qué club de campo están hablando. ` +
        `NUNCA asumas automáticamente que "amarillo" es San Francisco si están hablando de otro proyecto como Llano Grande. ` +
        `Si el cliente menciona Llano Grande, solo puedes usar San Antonio o Valle de Aburrá; si no sabes cuál corresponde al color de la imagen, pregunta antes de cotizar. ` +
        `Busca hacer coincidir el color ÚNICAMENTE con los sectores del club de campo del que vienen hablando. Si el lead pide un color en un proyecto del que no sabes sus colores, PREGÚNTALE a qué etapa pertenece ese color. NUNCA inventes cruces entre proyectos diferentes. ` +
        `Si no da el sector ni el color, pregúntale en qué sector está. ` +
        `BONOS: la cotización que envía la herramienta YA incluye un bono de descuento aplicado. Si el lead ` +
        `pregunta por bonos, descuentos o promociones, NO digas que no hay: dile que la cotización ya trae un ` +
        `bono y que además puede jugar por un bono ADICIONAL en ${env.puertabonoUrl()}. ` +
        `Si el lead dice que YA jugó y GANÓ un bono (p. ej. "gané 50 millones", "me gané el de 50"), vuelve a ` +
        `cotizar el MISMO terreno con enviar_cotizacion pasando bono_ganado = ese monto en pesos (50 millones = ` +
        `50000000). En ese caso NO lo invites a jugar otra vez y felicítalo por su bono. ` +
        `Después de enviar la cotización, ofrece agendar una llamada con un asesor. No repitas la misma ` +
        `cotización más de una vez seguida.`,
    });
  }

  // 6. Llamar a OpenAI con herramienta de agendamiento
  let aiReply: string;
  let appointmentScheduled = false; // true si en este turno se agendó/reagendó una cita
  let aiResponseMetadata: AiResponseMetadata | undefined;
  try {
    logger.info('[AI] Llamando a OpenAI', { leadId, historyLength: history.length, hasMedia: !!mediaUrl });

    const completion = await getOpenAIClient().chat.completions.create({
      model:       currentTurnHasImage ? 'gpt-4o' : 'gpt-4o-mini',
      messages,
      max_tokens:  350,
      temperature: 0.7,
      tools:       config.quoteMode !== 'off' ? [...APPOINTMENT_TOOLS, PORTAFOLIO_TOOL, COTIZACION_TOOL] : [...APPOINTMENT_TOOLS, PORTAFOLIO_TOOL],
      tool_choice: 'auto',
    });

    const choice = completion.choices[0]?.message;
    const toolCalls = choice?.tool_calls ?? [];

    if (toolCalls.length > 0) {
      // La IA decidió agendar — ejecutar la(s) herramienta(s)
      messages.push(choice);
      let directMessage: string | null = null;
      for (const call of toolCalls) {
        const toolName = call.type === 'function' ? call.function.name : '';
        const result = toolName === 'enviar_plano'
          ? await runPlanoTool(companyId, leadId, lead, call)
          : toolName === 'enviar_portafolio'
            ? await runPortfolioTool(companyId, leadId, lead, call)
          : toolName === 'enviar_cotizacion'
            ? await runCotizacionTool(companyId, leadId, lead, call)
          : toolName === 'consultar_horarios'
            ? await runAvailabilityTool(companyId, leadId, lead, call)
            : await runAppointmentTool(companyId, leadId, call, config.businessName, userMessage);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        const conf = (result as { confirmationMessage?: string }).confirmationMessage;
        if (conf) directMessage = conf;
        const availabilitySlots = (result as { slots?: AvailabilitySlotMetadata[] }).slots;
        if (availabilitySlots) aiResponseMetadata = { availabilitySlots };
        if ((result as { scheduled?: boolean }).scheduled) appointmentScheduled = true;
      }
      if (directMessage) {
        // Cita agendada con éxito → usar el mensaje lindo y consistente (no el del LLM)
        aiReply = directMessage;
      } else {
        // Errores / horario ocupado → dejar que el LLM redacte (propone alternativas)
        const followUp = await getOpenAIClient().chat.completions.create({
          model: 'gpt-4o-mini', messages, max_tokens: 350, temperature: 0.7,
        });
        aiReply = followUp.choices[0]?.message?.content?.trim() ?? config.fallbackMessage;
      }
    } else {
      aiReply = choice?.content?.trim() ?? config.fallbackMessage;
    }

    logger.info('[AI] Respuesta generada', {
      leadId, replyLength: aiReply.length, toolCalls: toolCalls.length,
      promptTokens: completion.usage?.prompt_tokens,
    });
  } catch (err) {
    logger.error('[AI] Error llamando a OpenAI', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    aiReply = config.fallbackMessage;
  }

  // 7. Guardar respuesta IA + enviar por el canal del lead
  const aiSentAt = await saveAndSendAiResponse(companyId, leadId, lead, aiReply, aiResponseMetadata);

  // 7b. Actualizar el contador de la guarda de costo (ventana horaria).
  await leadsRepository.update(companyId, leadId, {
    aiHourlyCount:       priorCount + 1,
    aiHourlyWindowStart: windowActive
      ? (freshLead.aiHourlyWindowStart ?? Timestamp.fromMillis(nowMs))
      : Timestamp.fromMillis(nowMs),
  });

  // 8. Marcar mensaje original como procesado (idempotencia)
  await messagesRepository.markAiProcessed(companyId, leadId, messageId);

  // 9. Follow-ups. Si en este turno se agendó/reagendó una cita, es un cierre
  //    positivo: cancelamos los follow-ups pendientes y NO programamos más
  //    (evita el "¿necesitas algo más?" redundante tras confirmar la cita).
  //    Los recordatorios de la cita los maneja processReminders por aparte.
  if (appointmentScheduled) {
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    logger.info('[AI] Cita agendada — follow-ups cancelados', { leadId });
  } else {
    await scheduleFollowUps(companyId, leadId, aiSentAt, config);
  }
}

// ─── Herramienta de agendamiento para la IA ─────────────────────────────────────

const APPOINTMENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agendar_cita',
      description:
        'Agenda una cita o reunión NUEVA con el lead. Úsala SOLO cuando el lead ya confirmó una fecha y hora concretas. ' +
        'Crea automáticamente un evento de Google Calendar con enlace de Google Meet.',
      parameters: {
        type: 'object',
        properties: {
          fecha_hora_iso: {
            type: 'string',
            description: 'Fecha y hora de inicio en ISO 8601 con offset de Colombia, ej: 2026-06-20T15:00:00-05:00',
          },
          duracion_minutos: { type: 'number', description: 'Duración en minutos (default 30).' },
        },
        required: ['fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reagendar_cita',
      description:
        'Reagenda (mueve/cambia) la cita existente del lead a una nueva fecha y hora. ' +
        'Úsala cuando el lead pida cambiar, mover o reprogramar su cita. ' +
        'Cancela la cita anterior (y su evento de Google) y crea una nueva en el nuevo horario.',
      parameters: {
        type: 'object',
        properties: {
          nueva_fecha_hora_iso: {
            type: 'string',
            description: 'Nueva fecha y hora de inicio en ISO 8601 con offset de Colombia, ej: 2026-06-21T10:00:00-05:00',
          },
          duracion_minutos: { type: 'number', description: 'Duración en minutos (si no se da, se conserva la de la cita anterior).' },
        },
        required: ['nueva_fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_cita',
      description:
        'Cancela la cita existente del lead. Úsala cuando el lead pida cancelar, anular o eliminar su cita. ' +
        'Borra el evento del Google Calendar del asesor.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_horarios',
      description:
        'Consulta horarios reales disponibles para una llamada con el asesor asignado al lead. ' +
        'Úsala después de confirmar el número de contacto, antes de ofrecer horarios, y también cuando el lead pregunte qué horarios hay disponibles. ' +
        'No inventes horarios: usa únicamente los horarios devueltos por esta herramienta.',
      parameters: {
        type: 'object',
        properties: {
          duracion_minutos: { type: 'number', description: 'Duración de la llamada en minutos (default 30).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enviar_plano',
      description:
        'Envía al lead, por WhatsApp, el PDF del plano de disponibilidad del club de campo (y etapa) que le interesa. ' +
        'Úsala cuando el lead, tras conocer las amenidades, muestre interés en ver los terrenos, la disponibilidad o los precios, ' +
        'o pida directamente el plano. No describas el plano tú mismo: esta herramienta ya lo envía y redacta el mensaje. ' +
        'Clubes válidos: Cañón de Arizona, Llano Grande, Sobre Montañas, Laguna Mar y Río Claro. ' +
        'Laguna Mar tiene DOS etapas (Mar Santorini y Mar Canarias): si el lead eligió Laguna Mar pero no dijo la etapa, ' +
        'pregúntale cuál etapa le interesa ANTES de llamar esta herramienta.',
      parameters: {
        type: 'object',
        properties: {
          club: {
            type: 'string',
            description: 'Club de campo de interés, p. ej. "Cañón de Arizona", "Laguna Mar", "Río Claro".',
          },
          etapa: {
            type: 'string',
            description: 'Solo para Laguna Mar: "Mar Santorini" o "Mar Canarias".',
          },
        },
        required: ['club'],
      },
    },
  },
];

const PORTAFOLIO_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'enviar_portafolio',
    description:
      'Envía al lead el portafolio/brochure PDF aprobado desde la biblioteca del CRM. ' +
      'Úsala cuando el lead elija o pregunte por un proyecto/club concreto. ' +
      'No inventes enlaces ni prometas archivos que no estén en la biblioteca.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Proyecto/club del portafolio: "PORTAFOLIO GENERAL MERAKI", "Cañón de Arizona", "Laguna Mar", "Río Claro", "Llano Grande" o "Sobre Montañas".',
        },
      },
      required: ['project'],
    },
  },
};

// Herramienta de cotización — solo se ofrece cuando quoteMode !== 'off' (ver más abajo).
const COTIZACION_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'enviar_cotizacion',
    description:
      'Envía al lead, por WhatsApp, la IMAGEN de una cotización de un terreno específico. ' +
      'Úsala cuando el lead ya eligió un terreno (número + sector) y quieres darle el precio. ' +
      'ANTES de llamarla, pregunta si el pago es de contado o en cuotas; si es en cuotas, pregunta a cuántos meses. ' +
      'Excepción: si ya enviaste cotización reciente de ese mismo terreno, NO vuelvas a preguntar forma de pago ni la llames otra vez, salvo que el lead pida recotizar/cambiar pago o aplicar un bono ganado. Si el lead adjunta una imagen nueva, la imagen nueva tiene prioridad sobre la cotización anterior. ' +
      'No inventes precios: esta herramienta calcula el valor real y envía la imagen.',
    parameters: {
      type: 'object',
      properties: {
        sector: {
          type: 'string',
          description:
            'El SECTOR o ETAPA exacto donde está el terreno. NO es el nombre del club de campo: un club ' +
            'tiene varios sectores. Mapa club → sectores válidos: ' +
            'Cañón de Arizona → Texas, Colorado, Las Vegas, Los Angeles, San Francisco. ' +
            'Río Claro → Lagunilla, Medina. Llano Grande → San Antonio, Valle de Aburrá. ' +
            'Laguna Mar → Mar Santorini, Mar Canarias. Sobre Montañas → Sobre Montañas. ' +
            'Pasa el sector tal como lo nombró el lead, p. ej. "Las Vegas", "Texas", "Mar Santorini".',
        },
        terreno: { type: 'string', description: 'Número del terreno/lote, p. ej. "21", "7", "216".' },
        tipo_pago: {
          type: 'string',
          enum: ['contado', 'cuotas'],
          description: 'Forma de pago elegida por el lead.',
        },
        meses: { type: 'number', description: 'Solo si tipo_pago = cuotas: número de meses (plazo).' },
        bono_ganado: {
          type: 'number',
          description:
            'Solo si el lead dice que YA jugó y GANÓ un bono en puertabono: el monto ganado en COP ' +
            '(p. ej. 50000000 si dijo "gané 50 millones"). Si viene, se usa ese bono en vez del bono base.',
        },
      },
      required: ['sector', 'terreno', 'tipo_pago'],
    },
  },
};

// Pregunta fija posterior al PDF del plano (en la voz de la asistente, sin decir "lote").
const PLANO_QUESTION = '¿En cuál terreno y sector está interesado? 😊';

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full', timeStyle: 'short', timeZone: env.calendarTimeZone(),
  }).format(d);

/**
 * Ejecuta la tool_call `enviar_cotizacion`: llama al endpoint cotizacionNow de
 * tour-meraki (Chrome headless) con sector/terreno/pago/meses, obtiene la URL de la
 * IMAGEN de cotización y la envía por WhatsApp; devuelve como confirmationMessage el
 * cierre que ofrece agendar. Si algo falla, ok:false con un `mensaje` para que el
 * modelo lo aclare con gracia (pedir meses, confirmar terreno, o disculparse).
 */
async function runCotizacionTool(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo' | 'whatsappUserId'>,
  call:      OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };

  let args: { sector?: string; terreno?: string; tipo_pago?: string; meses?: number; bono_ganado?: number };
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { ok: false, mensaje: 'No pude leer los datos de la cotización. Pídele al lead el terreno y la forma de pago.' };
  }
  let sector     = (args.sector ?? '').trim();
    if (sector.toUpperCase() === 'SAN FRANCISCO') sector = 'Sn.FRANCISCO';
  const terreno    = String(args.terreno ?? '').trim();
  const pago       = args.tipo_pago === 'cuotas' ? 'cuotas' : 'efectivo';
  const meses      = args.meses;
  const bonoGanado = Math.max(0, Number(args.bono_ganado) || 0);
  if (!sector || !terreno) {
    return { ok: false, mensaje: 'Falta el terreno o el sector. Pregúntale al lead el número de terreno y en qué sector (p. ej. Texas, Las Vegas, Mar Santorini).' };
  }
  if (pago === 'cuotas' && (!meses || meses < 1)) {
    return { ok: false, reason: 'falta_meses', mensaje: 'Para cotizar en cuotas necesito el número de meses. Pregúntale al lead a cuántos meses quiere el plan.' };
  }

  const quotationKey = quoteKey(sector, terreno, pago, meses, bonoGanado);
  const slot = await reserveQuotationSlot(companyId, leadId, quotationKey);
  if (!slot.ok) {
    logger.info('[AI] Límite de cotizaciones alcanzado — no se envía cotización', {
      leadId,
      sector,
      terreno,
      count: slot.count,
    });
    return {
      ok: false,
      reason: 'limite_cotizaciones',
      mensaje:
        'El lead ya alcanzó el límite de 5 cotizaciones. No envíes más cotizaciones ni listas de precios. ' +
        'Dile con naturalidad: "Ya revisamos varias opciones para ti. Para cuidarte información precisa y actualizada, ' +
        'mejor te ayudo a elegir entre esas alternativas o agendamos una llamada corta con un asesor para revisar disponibilidad en vivo."',
    };
  }

  // 1) Generar la imagen de cotización (endpoint headless de tour-meraki).
  //    El endpoint recibe el SECTOR en el parámetro `club` (así lo lee la ruta de impresión).
  let imageUrl: string;
  try {
    const qs = new URLSearchParams({ club: sector, terreno, pago });
    if (pago === 'cuotas' && meses) qs.set('meses', String(meses));
    // Bono: si el lead ganó uno en puertabono, usarlo (con tope); si no, el bono base.
    const bono = bonoGanado > 0 ? Math.min(bonoGanado, env.cotizadorBonoMax()) : env.cotizadorBonoBase();
    if (bono > 0) qs.set('bono', String(bono));
    const resp = await fetch(`${env.cotizadorUrl()}?${qs.toString()}`);
    const json = (await resp.json()) as { url?: string; error?: string; available?: boolean; status?: string };
    if (json?.available === false) {
      logger.info('[AI] Terreno no disponible — no se cotiza', { leadId, sector, terreno, status: json.status });
      await releaseQuotationSlot(companyId, leadId, quotationKey);
      return {
        ok: false,
        reason: 'no_disponible',
        mensaje: `El terreno ${terreno} del sector ${sector} NO está disponible (estado: ${json.status ?? 'no disponible'}). ` +
          `Explícale al lead con amabilidad que ese terreno no se puede cotizar porque ya no está disponible, ` +
          `e invítalo a elegir otro terreno del plano.`,
      };
    }
    if (!resp.ok || !json.url) {
      logger.warn('[AI] cotizacionNow no devolvió imagen', { leadId, sector, terreno, error: json.error });
      await releaseQuotationSlot(companyId, leadId, quotationKey);
      return {
        ok: false,
        reason: 'sin_cotizacion',
        mensaje: `No pude generar la cotización para el terreno ${terreno} en el sector "${sector}". ` +
          `(Error interno: ${json.error ?? 'No encontrado'}). ` +
          `Explícale al lead con naturalidad que no fue posible obtener la cotización de ese terreno en específico, ` +
          `tal vez porque el número no existe en ese sector, y pregúntale si quiere revisar otro o hablar con un asesor. ` +
          `NO le digas que el sector es incorrecto a menos que sea obvio.`,
      };
    }
    imageUrl = json.url;
  } catch (err) {
    logger.error('[AI] Error llamando a cotizacionNow', { leadId, error: err instanceof Error ? err.message : String(err) });
    await releaseQuotationSlot(companyId, leadId, quotationKey);
    return { ok: false, mensaje: 'No pude generar la cotización en este momento. Ofrécele que un asesor se la envíe y continúa.' };
  }

  // 2) Enviar la imagen por el canal del lead + registrar el mensaje.
  try {
    const fileName = `Cotizacion ${sector} ${terreno}.jpg`;
    const media = await sendMediaToLeadChannel({ ...lead, companyId }, imageUrl, 'image/jpeg', undefined, fileName);
    await messagesRepository.create({
      companyId,
      leadId,
      direction:        'outbound',
      senderType:       'ai',
      content:          '',
      channel:          lead.channel ?? 'whatsapp',
      status:           'sent',
      twilioMessageSid: media.externalMsgId,
      mediaUrl:         imageUrl,
      mediaType:        'image/jpeg',
      fileName,
      mediaKind:        'image',
      createdAt:        Timestamp.now(),
      metadata:         { provider: media.provider, origin: 'ai_cotizacion', sector, terreno, pago, ...(meses ? { meses: String(meses) } : {}) },
    });
    await sleep(MEDIA_FOLLOWUP_DELAY_MS);
  } catch (err) {
    logger.error('[AI] Error enviando cotización', { leadId, error: err instanceof Error ? err.message : String(err) });
    await releaseQuotationSlot(companyId, leadId, quotationKey);
    return { ok: false, mensaje: 'Generé la cotización pero no pude enviarla. Discúlpate brevemente y dile que un asesor se la hará llegar.' };
  }

  logger.info('[AI] Cotización enviada', {
    leadId,
    sector,
    terreno,
    pago,
    bonoGanado: bonoGanado || null,
    meses: meses ?? null,
    quotationCount: slot.count,
  });
  const plazo = pago === 'cuotas' ? `en ${meses} cuotas` : 'de contado';
  const terrenoLabel = `terreno ${terreno} del sector ${sector}`;
  const confirmationMessage = bonoGanado > 0
    // Ya jugó y ganó: aplicar su bono, felicitar y NO volver a invitar a jugar.
    ? `¡Felicidades! 🎉 Te compartí la cotización del ${terrenoLabel} ${plazo} con tu bono de ` +
      `$${Math.min(bonoGanado, env.cotizadorBonoMax()).toLocaleString('es-CO')} ya aplicado. ` +
      `El bono queda sujeto a validación. Para separarlo, lo mejor es una llamada con un asesor. ` +
      `¿Te gustaría que la agendemos?`
    // Bono base: invitar a jugar por más.
    : `Te compartí la cotización del ${terrenoLabel} ${plazo}. Ya incluye un bono de descuento 🎁. ` +
      `Y si quieres, puedes jugar por un bono ADICIONAL aquí: ${env.puertabonoUrl()} 🎟️ ` +
      `Para ver las opciones de pago y separarlo, lo mejor es una llamada con un asesor. ¿Te gustaría que la agendemos?`;
  return {
    ok: true,
    enviado: `${sector} ${terreno} (${plazo})`,
    confirmationMessage,
  };
}

/**
 * Ejecuta la tool_call `enviar_plano`: busca el PDF del club/etapa en el índice de
 * planos, envía primero el PDF, y devuelve como
 * confirmationMessage la pregunta de cierre ("¿En cuál terreno y sector…?"), que el
 * orquestador manda como respuesta final. Así el lead recibe, en orden:
 * 1) PDF del plano  2) la pregunta.
 *
 * Si el club no existe, falta la etapa (Laguna Mar) o falla el envío, devuelve
 * ok:false con un `mensaje` para que el modelo redacte la aclaración (pedir etapa,
 * confirmar club, o disculparse), sin enviar nada.
 */
async function runPlanoTool(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo' | 'whatsappUserId'>,
  call:      OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };

  let args: { club?: string; etapa?: string };
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { ok: false, mensaje: 'No pude leer el club solicitado. Pregúntale al lead cuál club de campo le interesa.' };
  }
  if (!args.club?.trim()) {
    return { ok: false, mensaje: 'Falta el club de campo. Pregúntale al lead cuál club le interesa.' };
  }

  let planos;
  try {
    planos = await fetchPlanosIndex();
  } catch (err) {
    logger.error('[AI] No se pudo leer el índice de planos', { leadId, error: String(err) });
    return { ok: false, mensaje: 'No pude obtener el plano en este momento. Ofrécele que un asesor se lo haga llegar y continúa la conversación.' };
  }

  const match = matchPlano(planos, args.club, args.etapa);
  if (match.status === 'need_stage') {
    return {
      ok: false,
      reason: 'falta_etapa',
      mensaje: `${match.projectName} tiene varias etapas: ${match.stages.join(' y ')}. ` +
        `Pregúntale al lead cuál etapa le interesa antes de enviar el plano.`,
    };
  }
  if (match.status === 'not_found') {
    return {
      ok: false,
      reason: 'club_no_encontrado',
      mensaje: `No encontré un plano para "${args.club}". Clubes disponibles: ${match.available.join(', ')}. ` +
        `Confirma con el lead cuál club de campo desea.`,
    };
  }

  const plano    = match.plano;
  const fileName = planoFileName(plano);

  // Candado anti-reenvío: si el plano de este club/etapa ya se envió en la
  // conversación reciente, NO lo repetimos. El lead que insiste ("me gusta el 71")
  // ya lo tiene: hay que avanzar al agendamiento, no reenviar el mismo PDF.
  const recent = await messagesRepository.getRecent(companyId, leadId, 30);
  const alreadySent = recent.some((m) => {
    const meta = m.metadata as { origin?: string; planoId?: string } | undefined;
    return meta?.origin === 'ai_plano' && meta?.planoId === plano.planoId;
  });
  if (alreadySent) {
    logger.info('[AI] Plano ya enviado antes — no se reenvía', { leadId, plano: planoLabel(plano) });
    return {
      ok: true,
      alreadySent: true,
      mensaje:
        `El plano de ${planoLabel(plano)} YA se le envió antes en esta conversación. NO lo reenvíes ni ` +
        `vuelvas a llamar enviar_plano, y NO digas "te envié el plano" otra vez. El lead ya lo tiene y ` +
        `muestra interés en un terreno. Ahora, de forma natural y cordial (nunca robótica), ofrécele ` +
        `agendar una llamada con uno de nuestros agentes inmobiliarios para darle información ` +
        `personalizada y una cotización de ese terreno; por ejemplo: "Para darte la información completa ` +
        `y una cotización de ese terreno, lo mejor es una llamada con uno de nuestros agentes. ¿Te ` +
        `gustaría que la agendemos?". NO le pidas datos todavía ni llames agendar_cita: espera a que ` +
        `acepte. Solo cuando acepte, confirma el teléfono registrado si existe; si no existe, pídelo. ` +
        `Después de confirmar el número, NO preguntes qué día desea: llama consultar_horarios y ofrece ` +
        `opciones reales cercanas. Si ninguna opción le sirve, entonces pregúntale qué día y hora quiere ` +
        `revisar y valida disponibilidad antes de confirmar.`,
    };
  }

  try {
    // 1) PDF del plano por el canal del lead.
    const media = await sendMediaToLeadChannel({ ...lead, companyId }, plano.url, 'application/pdf', undefined, fileName);

    // 2) Registrar el documento como mensaje de la IA (para que aparezca en la Bandeja).
    await messagesRepository.create({
      companyId,
      leadId,
      direction:        'outbound',
      senderType:       'ai',
      content:          '',
      channel:          lead.channel ?? 'whatsapp',
      status:           'sent',
      twilioMessageSid: media.externalMsgId,
      mediaUrl:         plano.url,
      mediaType:        'application/pdf',
      fileName,
      mediaKind:        'document',
      createdAt:        Timestamp.now(),
      metadata:         {
        provider: media.provider,
        origin: 'ai_plano',
        planoId: plano.planoId,
        projectName: plano.projectName,
        stageName: plano.stageName,
        name: plano.name,
      },
    });
    await sleep(MEDIA_FOLLOWUP_DELAY_MS);
  } catch (err) {
    logger.error('[AI] Error enviando plano', { leadId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, mensaje: 'No pude enviar el plano. Discúlpate brevemente y dile que un asesor se lo hará llegar.' };
  }

  logger.info('[AI] Plano enviado', { leadId, plano: planoLabel(plano) });
  return { ok: true, enviado: planoLabel(plano), confirmationMessage: PLANO_QUESTION };
}

async function sendPortfolioByProject(
  companyId: string,
  leadId: string,
  lead: Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo' | 'whatsappUserId'>,
  project: string
): Promise<{ sent: boolean; item?: LibraryPortfolioItem; alreadySent?: boolean }> {
  const item = await findPortfolioItem(companyId, project);
  if (!item?.downloadUrl) {
    logger.info('[AI] Portafolio no encontrado en biblioteca', { leadId, project });
    return { sent: false };
  }

  if (await portfolioAlreadySent(companyId, leadId, item.id)) {
    logger.info('[AI] Portafolio ya enviado recientemente; no se repite', { leadId, project, itemId: item.id });
    return { sent: false, item, alreadySent: true };
  }

  const mediaType = item.contentType || 'application/pdf';
  const fileName = item.fileName || `${item.title || project}.pdf`;
  const media = await sendMediaToLeadChannel({ ...lead, companyId }, item.downloadUrl, mediaType, undefined, fileName);
  await messagesRepository.create({
    companyId,
    leadId,
    direction:        'outbound',
    senderType:       'ai',
    content:          item.title || fileName,
    channel:          lead.channel ?? 'whatsapp',
    status:           'sent',
    twilioMessageSid: media.externalMsgId,
    mediaUrl:         item.downloadUrl,
    mediaType,
    fileName,
    mediaKind:        mediaType.startsWith('image/') ? 'image' : mediaType.startsWith('video/') ? 'video' : 'document',
    mediaStoragePath: item.storagePath,
    createdAt:        Timestamp.now(),
    metadata: {
      provider: media.provider,
      origin: 'ai_portafolio',
      portfolioItemId: item.id,
      project: item.project ?? project,
      title: item.title ?? '',
    },
  });
  await sleep(MEDIA_FOLLOWUP_DELAY_MS);
  logger.info('[AI] Portafolio enviado', { leadId, project, itemId: item.id, title: item.title });
  return { sent: true, item };
}

async function runPortfolioTool(
  companyId: string,
  leadId: string,
  lead: Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo' | 'whatsappUserId'>,
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };

  let args: { project?: string };
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { ok: false, mensaje: 'No pude leer qué portafolio enviar. Pregúntale al lead cuál proyecto le interesa.' };
  }

  const project = (args.project ?? '').trim();
  if (!project) {
    return { ok: false, mensaje: 'Falta el proyecto del portafolio. Pregúntale al lead cuál club de campo le interesa.' };
  }

  try {
    const result = await sendPortfolioByProject(companyId, leadId, lead, project);
    if (result.alreadySent) {
      return {
        ok: true,
        alreadySent: true,
        mensaje:
          `El portafolio de ${project} ya fue enviado en esta conversación. No lo repitas; continúa con una pregunta útil sobre el proyecto, plano o cotización.`,
      };
    }
    if (!result.sent) {
      return {
        ok: false,
        reason: 'portafolio_no_encontrado',
        mensaje:
          `No encontré un portafolio aprobado para "${project}" en la biblioteca. Dile al lead que por ahora puedes darle la información principal y que un asesor puede compartirle el material exacto.`,
      };
    }
    return {
      ok: true,
      enviado: result.item?.title ?? project,
      confirmationMessage:
        `Te compartí el portafolio de ${result.item?.project || project}. ` +
        `¿Quieres que revisemos amenidades, ubicación o el plano de disponibilidad?`,
    };
  } catch (err) {
    logger.error('[AI] Error enviando portafolio', {
      leadId,
      project,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      mensaje:
        'No pude enviar el portafolio en este momento. Discúlpate brevemente y ofrece que un asesor se lo comparta.',
    };
  }
}

/** Consulta horarios reales disponibles para que Victoria no invente opciones. */
async function runAvailabilityTool(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'assignedTo'>,
  call:      OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };

  let args: { duracion_minutos?: number };
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    args = {};
  }

  const durationMinutes = Number(args.duracion_minutos ?? 30) || 30;
  const advisorId = lead.assignedTo ?? (await assignLead(companyId, leadId)) ?? undefined;
  const conn = advisorId ? await googleConnectionRepository.getActive(companyId, advisorId) : null;
  const config = await getSchedulingConfig(companyId);

  const earliest = new Date(Date.now() + config.minAdvanceMinutes * 60_000);
  const end = new Date(earliest.getTime() + durationMinutes * 60_000);
  const slots = await findNearbyAvailableSlots(
    { companyId, advisorId, refreshToken: conn?.refreshToken ?? undefined, start: earliest, end },
    [],
    config,
    earliest
  );

  if (slots.length === 0) {
    return {
      ok: false,
      reason: 'sin_horarios',
      mensaje:
        'No encontré horarios disponibles cercanos. Pregúntale al lead qué día le gustaría revisar, ' +
        'y cuando proponga fecha y hora valida disponibilidad antes de agendar.',
    };
  }

  const formatted = slots.map((date, index) => ({
    index: index + 1,
    iso: date.toISOString(),
    label: formatAvailabilityDate(date),
  }));
  const lines = formatted.map((slot) => `${slot.index}. ${slot.label}`).join('\n');

  return {
    ok: true,
    advisorId,
    slots: formatted,
    confirmationMessage:
      `Tengo disponibles estos horarios para la llamada:\n\n${lines}\n\n¿Cuál de estos horarios te queda mejor?`,
  };
}

function resolveAvailabilitySelection(
  userMessage: string,
  history:     Message[],
  timeZone:    string
): AvailabilitySlotMetadata | null {
  const lastAvailability = [...history].reverse().find((message) =>
    message.direction === 'outbound' &&
    message.senderType === 'ai' &&
    (
      Array.isArray((message.metadata as { availabilitySlots?: unknown } | undefined)?.availabilitySlots) ||
      /tengo disponibles estos horarios/i.test(message.content ?? '')
    )
  );
  if (!lastAvailability) return null;

  const metadataSlots = (lastAvailability.metadata as { availabilitySlots?: AvailabilitySlotMetadata[] } | undefined)
    ?.availabilitySlots;
  const slots = Array.isArray(metadataSlots) && metadataSlots.length > 0
    ? metadataSlots
    : parseAvailabilitySlotsFromContent(lastAvailability.content ?? '');
  if (slots.length === 0) return null;

  const normalizedMessage = normalizeText(userMessage);

  // GUARDA: si el mensaje habla de un terreno/sector/color/cotización, NO es una
  // selección de horario. Evita que "el 9 azul de rio claro" (terreno 9, Lagunilla)
  // se interprete como las 9:00 y agende una cita por error.
  if (/\b(azul|verde|roj[oa]|amarill[oa]|naranja|dorad[oa]|terreno|lote|sector|cotiz|precio|cuesta|vale|contado|cuota|rio|claro|mar|santorini|canarias|canon|arizona|texas|colorado|vegas|angeles|francisco|lagunilla|medina|llano|grande|montan|sobre)\b/.test(normalizedMessage)) {
    return null;
  }

  const numericChoice = normalizedMessage.match(/(?:^|\s)(?:opcion\s*)?(\d{1,2})(?:\s|$)/);
  if (numericChoice) {
    const index = Number(numericChoice[1]);
    const slot = slots.find((item) => item.index === index);
    if (slot) return slot;
  }

  const requestedTime = extractRequestedLocalTime(normalizedMessage);
  if (!requestedTime) return null;

  const requestedDay = normalizedMessage.includes('manana')
    ? localYmd(new Date(Date.now() + 24 * 60 * 60 * 1000), timeZone)
    : normalizedMessage.includes('hoy')
      ? localYmd(new Date(), timeZone)
      : null;

  const matches = slots.filter((slot) => {
    const parts = localParts(new Date(slot.iso), timeZone);
    if (parts.hour !== requestedTime.hour || parts.minute !== requestedTime.minute) return false;
    return requestedDay ? parts.ymd === requestedDay : true;
  });

  return matches.length === 1 ? matches[0] : null;
}

function parseAvailabilitySlotsFromContent(content: string): AvailabilitySlotMetadata[] {
  const monthByName: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const slots: AvailabilitySlotMetadata[] = [];
  const pattern = /(\d{1,2})\.\s*[^,\n]*,\s*(\d{1,2})\s+de\s+([a-zÃ±]+)\s+de\s+(\d{4}),\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/gi;
  for (const match of content.matchAll(pattern)) {
    const index = Number(match[1]);
    const day = Number(match[2]);
    const month = monthByName[normalizeText(match[3])];
    const year = Number(match[4]);
    let hour = Number(match[5]);
    const minute = Number(match[6] ?? '0');
    const meridiem = match[7].toLowerCase();
    if (meridiem === 'p' && hour < 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
    if (!month) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T` +
      `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`;
    slots.push({ index, iso, label: match[0].replace(/^\d+\.\s*/, '').trim() });
  }
  return slots;
}

function extractRequestedLocalTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const marker = (match[3] ?? '').replace(/\s+/g, '');
  if (/^p/.test(marker) && hour < 12) hour += 12;
  if (/^a/.test(marker) && hour === 12) hour = 0;
  if (!marker && hour >= 1 && hour <= 7) hour += 12;
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function localParts(date: Date, timeZone: string): { ymd: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function localYmd(date: Date, timeZone: string): string {
  return localParts(date, timeZone).ymd;
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Ejecuta una tool_call de agenda (agendar/reagendar/cancelar) para la IA. */
/** ¿El mensaje del lead trae una fecha/hora real (día, "a las N", "N:NN", "N am/pm")? */
function mentionsDateOrTime(text: string): boolean {
  const t = normalizeText(text);
  return /\b(hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(t) ||
    /(a\s*las|las)\s*\d/.test(t) ||
    /\d{1,2}\s*:\s*\d{2}/.test(t) ||
    /\d{1,2}\s*(a\.?\s?m|p\.?\s?m|am|pm)\b/.test(t);
}

async function runAppointmentTool(
  companyId:    string,
  leadId:       string,
  call:         OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  businessName: string,
  userMessage:  string = ''
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };
  const name = call.function.name;

  try {
    const args = JSON.parse(call.function.arguments || '{}') as {
      fecha_hora_iso?: string; nueva_fecha_hora_iso?: string; duracion_minutos?: number;
    };

    // ── Agendar nueva ────────────────────────────────────────────────────────
    if (name === 'agendar_cita') {
      if (!args.fecha_hora_iso) return { ok: false, error: 'falta fecha_hora_iso' };
      const start = new Date(args.fecha_hora_iso);
      if (isNaN(start.getTime())) return { ok: false, error: 'fecha inválida' };

      // Anti-duplicados: si el lead YA tiene una cita activa, no crear una segunda.
      // Esto evita el bucle donde, tras confirmar (p. ej. "listo"), el modelo vuelve
      // a llamar agendar_cita: la cita recién creada se contaba como conflicto y
      // disparaba "horario ocupado" → alternativas → nueva cita → N citas duplicadas.
      const existing = await findActiveAppointmentForLead(companyId, leadId);
      if (existing) {
        const sameSlot = Math.abs(existing.startTime.toMillis() - start.getTime()) < 60_000;
        if (sameSlot) {
          // Ya estaba agendada a esa misma hora → no duplicar ni reenviar la
          // confirmación completa cuando el lead solo dice "ok/gracias".
          return {
            ok: true,
            alreadyScheduled: true,
            fecha: fmtDate(existing.startTime.toDate()),
            meet: existing.googleMeetLink ?? null,
            mensaje:
              'El lead ya tenía esta cita agendada en ese mismo horario. No se creó una nueva. ' +
              'Responde solo con un cierre corto y cordial, sin repetir la confirmación completa.',
          };
        }
        // Tiene una cita en otro horario → mover la existente en vez de duplicarla.
        const { appointment } = await rescheduleAppointment({
          companyId, leadId, startTime: start, durationMinutes: args.duracion_minutos,
        });
        return {
          ok: true,
          scheduled: true,
          fecha: fmtDate(start),
          meet: appointment.googleMeetLink ?? null,
          confirmationMessage: buildReschedule(businessName, appointment.leadName, start),
          mensaje: 'El lead ya tenía una cita; se movió al nuevo horario en vez de duplicarla.',
        };
      }

      const appt = await bookAppointment({
        companyId, leadId, startTime: start,
        durationMinutes: args.duracion_minutos, source: 'ai',
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appt.googleMeetLink ?? null,
        confirmationMessage: buildConfirmation(businessName, appt.leadName, start),
        mensaje: 'Cita agendada correctamente.',
      };
    }

    // ── Reagendar (mover) ──────────────────────────────────────────────────────
    if (name === 'reagendar_cita') {
      if (!args.nueva_fecha_hora_iso) return { ok: false, error: 'falta nueva_fecha_hora_iso' };
      // Candado: no reagendar si el lead NO dio una fecha/hora en su mensaje (evita
      // que un "me gusta" o confirmación vaga mueva la cita a una hora inventada).
      if (!mentionsDateOrTime(userMessage)) {
        return {
          ok: false,
          reason: 'sin_fecha_hora',
          mensaje: 'El lead no pidió cambiar la cita ni dio una nueva fecha y hora. NO reagendes. ' +
            'Si su mensaje es de interés (p. ej. "me gusta"), respóndele normal sin tocar la cita.',
        };
      }
      const start = new Date(args.nueva_fecha_hora_iso);
      if (isNaN(start.getTime())) return { ok: false, error: 'fecha inválida' };

      const { appointment, hadPrevious } = await rescheduleAppointment({
        companyId, leadId, startTime: start, durationMinutes: args.duracion_minutos,
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appointment.googleMeetLink ?? null,
        confirmationMessage: hadPrevious
          ? buildReschedule(businessName, appointment.leadName, start)
          : buildConfirmation(businessName, appointment.leadName, start),
        mensaje: hadPrevious ? 'Cita reprogramada correctamente.' : 'No tenía cita previa; se agendó una nueva.',
      };
    }

    // ── Cancelar ───────────────────────────────────────────────────────────────
    if (name === 'cancelar_cita') {
      const cancelled = await cancelActiveAppointment(companyId, leadId);
      if (!cancelled) {
        return {
          ok: false,
          reason: 'sin_cita',
          mensaje: 'El lead no tiene una cita activa para cancelar. Pregúntale en qué más puedes ayudarle.',
        };
      }
      return {
        ok: true,
        confirmationMessage: buildCancellation(businessName, cancelled.leadName),
        mensaje: 'Cita cancelada correctamente.',
      };
    }

    return { ok: false, error: 'herramienta desconocida' };
  } catch (err) {
    if (err instanceof AvailabilityError) {
      return {
        ok: false,
        error: err.message,
        reason: 'horario_ocupado',
        sugerencias: err.suggestions.map((date) => date.toISOString()),
        mensaje:
          err.suggestions.length > 0
            ? `Ese horario no está disponible (puede ser en el pasado, demasiado pronto, estar ocupado o fuera del horario de atención). Propón estas opciones cercanas: ${formatSuggestions(err.suggestions)}.`
            : 'Ese horario no está disponible. Pide al lead otra fecha u hora más adelante.',
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Guarda y envía la respuesta IA. Retorna el Timestamp del mensaje guardado. */
async function saveAndSendAiResponse(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo'>,
  content:   string,
  extraMetadata?: AiResponseMetadata
): Promise<Timestamp> {
  const now = Timestamp.now();
  let status: 'sent' | 'failed' = 'sent';
  let externalMsgId: string | undefined;
  let provider: SendTextResult['provider'] | undefined;
  let sendError: string | undefined;

  try {
    const result = await sendTextToLeadChannel({ ...lead, companyId }, content);
    provider = result.provider;
    externalMsgId = result.externalMsgId;
  } catch (err) {
    status = 'failed';
    sendError = err instanceof Error ? err.message : String(err);
    logger.error('[AI] Error enviando respuesta', {
      leadId,
      via:   lead.channel ?? 'whatsapp',
      error: sendError,
    });
    // Avisar al asesor asignado: el mensaje quedó como fallido y debe responder a mano.
    // (No reintentamos el envío para no arriesgar mensajes duplicados al cliente.)
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title:  `⚠️ Envío fallido a ${lead.name?.trim() || lead.phone || 'un lead'}`,
      body:   'La IA respondió pero WhatsApp rechazó el envío. Abre la conversación y responde manualmente.',
      url:    `/dashboard/inbox?lead=${leadId}`,
      type:   'send-failed',
      leadId,
    }).catch(() => { /* el aviso es best-effort */ });
  }

  await messagesRepository.create({
    companyId,
    leadId,
    direction:        'outbound',
    senderType:       'ai',
    content,
    channel:          lead.channel ?? 'whatsapp',
    status,
    twilioMessageSid: externalMsgId,
    createdAt:        now,
    metadata: {
      provider: provider ?? lead.inboxProvider ?? 'auto',
      ...extraMetadata,
      ...(sendError ? { sendError } : {}),
    },
  });

  await leadsRepository.update(companyId, leadId, {
    lastMessageText: content,
    lastMessageAt:   now,
  });

  return now;
}

/** Descarga y transcribe un audio con OpenAI Whisper. */
async function transcribeAudio(audioUrl: string, mimeType: string): Promise<string> {
  // Node 22 tiene fetch nativo con manejo de redirects
  const resp = await fetch(audioUrl, { headers: { 'X-API-Key': env.ycloudApiKey() } });
  if (!resp.ok) throw new Error(`Audio download failed: ${resp.status}`);

  const arrayBuffer = await resp.arrayBuffer();
  const buffer      = Buffer.from(arrayBuffer);

  // Determinar extensión para que Whisper identifique el formato
  const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg';
  const file = new File([buffer], `audio.${ext}`, { type: mimeType });

  const result = await getOpenAIClient().audio.transcriptions.create({
    file,
    model:    'whisper-1',
    language: 'es',
  });

  return result.text.trim();
}

/** Crea las tareas de follow-up en Firestore para los pasos habilitados. */
async function scheduleFollowUps(
  companyId:     string,
  leadId:        string,
  aiMessageSentAt: Timestamp,
  config:        AiConfig
): Promise<void> {
  const steps = config.followUpSequence?.filter((s) => s.enabled) ?? [];
  if (steps.length === 0) return;

  // Primero cancela cualquier follow-up pendiente previo de este lead
  await followUpsRepository.cancelPendingForLead(companyId, leadId);

  const now = aiMessageSentAt.toMillis();
  const tasks = steps.map((step, index) => ({
    companyId,
    leadId,
    stepIndex:       index,
    scheduledAt:     Timestamp.fromMillis(now + Math.max(step.delayMinutes, MIN_FOLLOWUP_DELAY_MINUTES) * 60_000),
    aiMessageSentAt,
    status:          'pending' as const,
    createdAt:       Timestamp.now(),
  }));

  await followUpsRepository.createBatch(tasks);
  logger.info('[AI] Follow-ups agendados', { leadId, count: tasks.length });
}
