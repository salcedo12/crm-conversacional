import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getOpenAIClient } from '../../integrations/openai/openai.client';
import { env }             from '../../config/env';
import { db }              from '../../lib/admin';
import { leadsRepository } from '../leads/leads.repository';
import { assignLead } from '../leads/leadAssignment.service';
import type { Lead } from '../leads/leads.types';
import { messagesRepository } from '../messages/messages.repository';
import { sendTextToLeadChannel, sendMediaToLeadChannel, formatForWhatsApp } from '../messages/outboundText.service';
import { sendAdvisorPush } from '../messages/pushNotifications.service';
import { fetchPlanosIndex, matchPlano, planoFileName, planoLabel } from '../planos/planos.service';
import type { SendTextResult } from '../messages/outboundText.service';
import { followUpsRepository } from '../followups/followups.repository';
import { getAiConfig } from './aiConfig.repository';
import { detectsBudgetObjection, nextAppointmentLabel, recordAiFicha, refreshLeadAnalysis } from './aiFicha.service';
import { asksAboutConstruction, CLUB_PAGE_URLS, CLUBS_WITH_UPDATES, loadRecentConstructionUpdates, resolveConstructionClub, summarizeUpdate } from './constructionUpdates';
import { inventoryDb } from '../inventory/inventory.client';
import { bumpAiDaily, recordAiUsage, type ModelUsage } from './aiUsage.service';
import { sendAiFailureAlert } from './aiFailureAlert';
import { personFirstName } from './personName';
import { checkLotInInventory, deriveQuoteState, isShortFollowUp, lotCheckNote, type ChatTurn } from './quoteState';
import {
  inventoryAreasText, inventorySectorFor, isLlanoGrandeSector, loadProjectLots, lotStatus, namedLlanoGrandeSector, pickLlanoGrandeSector,
} from './quoteInventory';
import { humanHandoffPatch, isExistingBuyer, isLeadInAiRollout, isTestLead, isVoiceEnabled, usesConsultiveAgent } from './aiRollout';
import { buildOpenAiMessages, detectsTransferKeyword } from './aiContext.service';
import { bookAppointment, rescheduleAppointment, cancelActiveAppointment, changeAppointmentModality, findActiveAppointmentForLead, hasPendingAppointment } from '../appointments/appointments.service';
import type { AppointmentModality } from '../appointments/appointments.types';
import { buildConfirmation, buildReschedule, buildCancellation, modalityLabel } from '../appointments/appointmentMessages';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { getSchedulingConfig } from '../appointments/schedulingConfig';
import { AvailabilityError, findNearbyAvailableSlots, formatAvailabilityDate, formatSuggestions } from '../appointments/availability.service';
import { logger } from '../../utils/logger';
import { generateVictoriaVoiceNote } from './voiceSynthesis.service';
import type OpenAI from 'openai';
import { safeDownload, ycloudAuthHeaders } from '../../utils/safeDownload';
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
const DEBOUNCE_MS = 10000;

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
  'Al comunicarse por este medio, y conforme a la ' +
  'Ley 1581 de 2012, autoriza el tratamiento de sus datos personales para fines informativos, ' +
  'institucionales y comerciales.\n\n' +
  '✨ ¡Gracias por escribirnos! ¿Con quién tengo el gusto de hablar?';

const CUSTOMER_SERVICE_REDIRECT =
  'Gracias por escribirnos 😊 Para este tipo de solicitudes debe comunicarse con nuestro equipo de Servicio al Cliente.\n\n' +
  '📲 WhatsApp: 314 7868069\n\n' +
  '📧 Correo: servicioalcliente.grupomeraki@gmail.com\n\n' +
  'Ellos podrán ayudarle de manera precisa con su caso.';

const SENSITIVE_INQUIRY_ESCALATION =
  'Para darle información precisa y cuidar la disponibilidad actualizada, no manejamos listas completas de precios ni inventario por este canal. ' +
  'Le puedo ayudar con una opción concreta o le conecto con un asesor para revisar su caso. 🙏';

const QUOTATION_LIMIT = 5;

/** Describe en una frase de dónde llegó el lead, para orientar a la IA sin inventar. */
function describeLeadOrigin(lead: Pick<Lead, 'source' | 'sourceMeta'>): string {
  switch (lead.source) {
    case 'meta_ads': {
      const h = lead.sourceMeta?.headline;
      const body = String(lead.sourceMeta?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 450);
      const base = h
        ? `llegó desde un anuncio de Meta ("${h}")`
        : 'llegó desde un anuncio de Meta (Facebook/Instagram)';
      return body ? `${base}. Texto del anuncio: "${body}"` : base;
    }
    case 'google_ads': return 'llegó desde un anuncio de Google';
    case 'web':       return 'llegó desde la página web (formulario o botón de WhatsApp)';
    case 'facebook':  return 'llegó desde Facebook';
    case 'instagram': return 'llegó desde Instagram';
    case 'manual':    return 'fue cargado por un asesor';
    default:          return 'escribió directamente por WhatsApp';
  }
}

const COUNTRY_BY_PREFIX: Array<[string, string | null]> = [
  ['507', 'Panamá'], ['506', 'Costa Rica'], ['593', 'Ecuador'], ['353', 'Irlanda'],
  ['34', 'España'], ['52', 'México'], ['56', 'Chile'], ['51', 'Perú'], ['58', 'Venezuela'], ['54', 'Argentina'],
  ['55', 'Brasil'], ['44', 'el Reino Unido'], ['39', 'Italia'], ['49', 'Alemania'], ['33', 'Francia'],
  ['41', 'Suiza'], ['31', 'los Países Bajos'], ['61', 'Australia'],
  ['1', null], // Estados Unidos o Canadá: no se sabe cuál
];

/** ¿El número es de fuera de Colombia? Ante la duda, no. */
export function isForeignPhone(phone: string | undefined): boolean {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return false;
  if (raw.startsWith('+')) return !digits.startsWith('57');
  return false;
}

/** "desde España" o "desde el exterior" cuando el código no dice el país con certeza. */
export function abroadPhrase(phone: string | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const hit = COUNTRY_BY_PREFIX.find(([prefix]) => digits.startsWith(prefix));
  return hit?.[1] ? `desde ${hit[1]}` : 'desde el exterior';
}

function isKnownLeadName(name: string | undefined): name is string {
  const clean = name?.trim() ?? '';
  return clean.length > 1 && !/^lead\b/i.test(clean) && !/^\+?\d/.test(clean);
}

function buildLegalWelcome(lead: Pick<Lead, 'name' | 'source'>): string {
  if (!isKnownLeadName(lead.name)) return LEGAL_WELCOME;
  const intro = lead.source === 'web' || lead.source === 'meta_ads' || lead.source === 'manual'
    ? `Hola, ${lead.name.trim()}. Gracias por dejarnos sus datos.`
    : `Hola, ${lead.name.trim()}. Gracias por escribirnos.`;
  return (
    '🌳🌴 ¡Bienvenido a Grupo Constructor MERAKI! 🌴🌳\n\n' +
    `${intro}\n\n` +
    'Este es nuestro canal oficial de ventas. Al comunicarse por este medio, y conforme a la Ley 1581 de 2012, ' +
    'autoriza el tratamiento de sus datos personales para fines informativos, institucionales y comerciales.\n\n' +
    'Actualmente tenemos clubes de campo en Alvarado, Melgar y Mariquita, Tolima.\n\n' +
    '¿En cuál de estos municipios le gustaría invertir?'
  );
}

const NOT_A_PERSON_NAME = /\b(GRUPO|CONSTRUCTOR|CONTABILIDAD|INMOBILIARIA|INVERSIONES|EMPRESA|ASESOR|ASESORA|SAS|LTDA|TIENDA|VENTAS)\b/;

/**
 * Nombre para saludar. El perfil de WhatsApp puede ser una marca, un apodo o tener
 * números y emojis, así que solo se usa el nombre de formularios y registros.
 */
export function safeGreetingName(lead: Pick<Lead, 'name' | 'source'>): string {
  if (!isKnownLeadName(lead.name) || !lead.source) return '';
  if (['whatsapp', 'facebook', 'instagram'].includes(String(lead.source))) return '';
  if (NOT_A_PERSON_NAME.test(normKey(lead.name))) return '';
  // En anuncios de WhatsApp el nombre es el del perfil: solo se usa si es un nombre de persona conocido.
  return personFirstName(lead.name);
}

/**
 * Rechazo definitivo: pide que no lo contacten más o dice solo que ya no le interesa.
 * "No me interesa Río Claro" no cuenta: puede interesarle otro club.
 */
export function detectsFinalRejection(text: string): boolean {
  return detectsOptOut(text) || detectsPlainNoInterest(text);
}

const COURTESY_WORDS = new Set((
  'GRACIAS MUCHAS MIL MUY OK OKEY OKAY OKI LISTO VALE DALE PERFECTO BUENO ENTENDIDO DE ACUERDO CLARO SUPER EXCELENTE ' +
  'GENIAL BIEN AH VOY A LO LA REVISO REVISAR REVISARLO REVISARLA REVISO QUE AMABLE BENDICIONES DIOS LE PAGUE SENORITA ' +
  'VICTORIA UN SALUDO SALUDOS FELIZ BUEN BUENA DIA DIAS TARDE NOCHE IGUALMENTE TAMBIEN ESTOY PENDIENTE QUEDO ATENTO ATENTA ' +
  'TI USTED IGUAL BENDIGA BENDIGAN BENDICION MUCHO GUSTO SENOR SENORA EXITOS'
).split(' '));

/** Solo agradece o confirma que lo va a revisar ("Muchas gracias", "Ok, voy a revisarlo", "👍"). */
export function isCourtesyOnly(text: string): boolean {
  const raw = String(text ?? '').trim();
  if (!raw || /\?/.test(raw)) return false;
  const words = normKey(raw).split(/\s+/).filter(Boolean);
  if (!words.length) return /\p{Extended_Pictographic}/u.test(raw); // solo emojis
  return words.length <= 8 && words.every((w) => COURTESY_WORDS.has(w));
}

/** Respuesta corta a la plantilla "¿quiere que un asesor lo contacte? responda SÍ / NO". */
export function templateYesNo(text: string): 'si' | 'no' | null {
  const t = normKey(text);
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  if (/^NO( GRACIAS| YA| LA NECESITO| ME INTERESA| POR AHORA| MAS)*$/.test(t)) return 'no';
  if (/^(SI|SII|SIII|CLARO|DALE|OK SI|BUENO SI)( SENOR| SENORA| POR FAVOR| GRACIAS| CLARO| ME INTERESA| QUIERO)*$/.test(t)) return 'si';
  return null;
}

/**
 * ¿Es el texto automático del botón del anuncio que pide precios? ("Hola, quiero conocer precios
 * de los lotes. Ref. USA-LEE"). No lo escribió el cliente: solo tocó el botón.
 */
export function isAdPrefilledPriceRequest(text: string): boolean {
  const t = normKey(text);
  return /^HOLA QUIERO CONOCER (LOS )?PRECIOS DE LOS (LOTES|TERRENOS)( REF [A-Z0-9 ]{1,30})?$/.test(t) ||
    (/\bREF\b/.test(t) && /\bPRECIOS?\b/.test(t) && t.split(/\s+/).length <= 14);
}

export const PRICE_HOLD_MARK = 'Con mucho gusto le comparto los precios';

/** Primera respuesta al texto automático de precios: cálida y con una sola pregunta fácil, sin cifras. */
export function buildPriceHoldReply(name: string, abroad: string | null): string {
  const opener = abroad
    ? `Qué bueno que nos escriba ${abroad}${name ? `, ${name}` : ''} 😊 ${PRICE_HOLD_MARK}.`
    : `${PRICE_HOLD_MARK}${name ? `, ${name}` : ''} 😊`;
  const question = name
    ? '¿me cuenta desde qué ciudad nos escribe?'
    : '¿me cuenta con quién tengo el gusto y desde qué ciudad nos escribe?';
  return `${opener} Para recomendarle el terreno que mejor se ajuste a lo que busca, ${question}`;
}

/** Señales de que el lead no quiere avanzar ("no gracias", "no quiero para este lado", "muy caro", "ya compré"). */
export function detectsDeclineCue(text: string): boolean {
  const t = normKey(text);
  return /\b(NO GRACIAS|NO QUIERO|NO ME INTERESA|NO ESTOY INTERESAD[OA]|NO ME QUEDA|NO ME SIRVE|NO ME CONVIENE|YA COMPRE|NO TENGO (DINERO|PLATA|PRESUPUESTO|COMO)|(MUY|DEMASIADO|SUPER) CAR[OA]|NO ME ALCANZA|POR AHORA NO|AHORA NO|NO POR AHORA|NO POR EL MOMENTO|LO VOY A PENSAR|LO PENSARE|NO ESTOY BUSCANDO)\b/.test(t) ||
    /^NO( SENOR| SENORA| GRACIAS)?$/.test(t);
}

/** ¿Tu último mensaje ofrecía agendar una cita o llamada con el asesor? */
export function lastAiOfferedCita(text: string): boolean {
  const t = normKey(text);
  return /\?/.test(text) && /\b(AGEND\w*|CITA|LLAMADA CON (UN|EL|NUESTRO) ASESOR|VIDEOLLAMADA)\b/.test(t);
}

/** La respuesta de la IA es una despedida (deja la puerta abierta y no pregunta nada). */
export function isFarewellReply(text: string): boolean {
  const t = normKey(text);
  return !/\?/.test(text) && /\b(SI MAS ADELANTE|CUANDO (QUIERA|DESEE|GUSTE) RETOMAR|GRACIAS POR SU TIEMPO|AQUI ESTAREMOS|CON GUSTO LE ATENDERE|QUEDO ATENTA|DEJO LA PUERTA ABIERTA)\b/.test(t);
}

/** Categoría probable del motivo, para cuando el modelo no la registró. */
export function inferNoInterestCategory(texts: string[]): string {
  const t = normKey(texts.join(' '));
  if (/\b(CAR[OA]|PLATA|DINERO|PRESUPUESTO|ALCANZA|COSTOS?O?)\b/.test(t)) return 'precio';
  if (/\b(LEJOS|LADO|ZONA|UBICACION|TOLIMA|CLIMA|DISTANCIA|OTRA PARTE|OTRO SITIO)\b/.test(t)) return 'ubicacion';
  if (/\b(YA COMPRE|OTRO PROYECTO|OTRA CONSTRUCTORA|COMPRE)\b/.test(t)) return 'competencia';
  if (/\b(AHORA NO|POR AHORA|MAS ADELANTE|DESPUES|PENSAR|PENSARE|MOMENTO|TIEMPO)\b/.test(t)) return 'tiempo';
  return 'otro';
}

/**
 * ¿Es un proveedor ofreciendo servicios a la constructora (no un comprador)? Pide dos señales:
 * que ofrezca algo y que hable de empresa/servicios, para no confundir "le escribo de Bogotá".
 */
export function detectsVendorPitch(text: string): boolean {
  const t = normKey(text);
  const offers = /\b(OFRECEMOS|OFRECERLE|OFRECERLES|LE OFREZCO|LES OFREZCO|APOYAMOS A|AYUDAMOS A (LAS )?(CONSTRUCTORAS|EMPRESAS)|SOMOS UNA EMPRESA|NUESTRA EMPRESA|NUESTROS SERVICIOS|NUESTRA PLATAFORMA|PORTAFOLIO DE SERVICIOS|PROPUESTA COMERCIAL|ALIANZA COMERCIAL|SOY PROVEEDOR|SOMOS PROVEEDORES)\b/.test(t);
  const business = /\b(CONSTRUCTORAS?|SU EMPRESA|SUS PROYECTOS|PARA GRUPO CONSTRUCTOR|SERVICIOS|PLATAFORMA|SOFTWARE|MARKETING|PUBLICIDAD|SOLUCIONES|PROPIEDAD HORIZONTAL|ASAMBLEA)\b/.test(t);
  return offers && business && t.split(/\s+/).length >= 10;
}

export const VENDOR_REPLY =
  'Gracias por escribirnos. Este canal es exclusivo para la venta de terrenos en nuestros clubes de campo, así que por aquí no ' +
  'gestionamos propuestas de proveedores. Le deseamos un excelente día.';

/**
 * ¿El lead nombró ese terreno? El modelo llegó a inventarlo: a "Y precios" respondió cotizando el
 * terreno 21 (copiado del ejemplo de la herramienta) y le dijo al cliente que estaba vendido.
 * Un número seguido de m², metros, millones, meses… es un área o una cifra, no un terreno.
 */
export function leadNamedLot(terreno: string, leadTexts: string[]): boolean {
  const t = normKey(leadTexts.join(' '));
  const digits = terreno.replace(/\D/g, '');
  if (digits) {
    const n = String(Number(digits));
    const re = new RegExp(`(^|\\s)0*${n}(?!\\s*(M2|M|MTS|MT|METROS?|MILLONES?|MILL|MESES|MES|CUOTAS|ANOS|MINUTOS|HORAS|KM)\\b)(\\s|$)`);
    return re.test(t);
  }
  const name = normKey(terreno);
  return !!name && t.includes(name);
}

/** "un terreno de 471 metros", "uno de 400 o 500": habla de un ÁREA, no de un número de terreno. */
export function mentionsAreaNotLot(text: string): boolean {
  const t = normKey(text);
  return /\b\d{3,5} ?(M2|M|MTS|MT|METROS?( CUADRADOS)?)\b/.test(t) ||
    /\bUNO DE \d{3,4}\b/.test(t) || /\bDE \d{3,4} O \d{3,4}\b/.test(t);
}

/** Cualquier enlace a un dominio de Meraki que no sea el oficial se corrige (pasó con ".co.uk"). */
export function fixMerakiLinks(text: string): string {
  return text.replace(/(grupoconstructormeraki)\.(?!com\.co\b)[a-z]{2,3}(\.[a-z]{2})?/gi, '$1.com.co');
}

/** Pide que no lo contacten más o que borren sus datos: se respeta de inmediato. */
export function detectsOptOut(text: string): boolean {
  const t = normKey(text);
  if (/\bNO (ME |NOS )?(VUELVAN A |SIGAN )?(ESCRIBAN|ESCRIBIR|ESCRIBIENDO|CONTACTEN|CONTACTAR|LLAMEN|LLAMAR|MOLESTEN)\b/.test(t)) return true;
  if (/\b(DEJEN|DEJA) DE (ESCRIBIR|ESCRIBIRME|LLAMAR|LLAMARME|CONTACTARME|MOLESTAR|MOLESTARME)\b/.test(t)) return true;
  return /\b(BORREN|ELIMINEN|QUITEN) MI (NUMERO|DATO|DATOS|CONTACTO)\b/.test(t);
}

/** Solo dice que no le interesa, sin dar el motivo. */
export function detectsPlainNoInterest(text: string): boolean {
  return /^(NO GRACIAS )?(YA )?(NO ME INTERESA|NO ESTOY INTERESAD[OA])( YA| MAS)?( GRACIAS)?$/.test(normKey(text));
}

/** Pregunta del motivo de no interés (una sola vez). */
export function noInterestReasonQuestion(name: string): string {
  return `Entiendo${name ? `, ${name}` : ''}, gracias por contarme. ¿Me podría decir el motivo? Por ejemplo el precio, la ubicación o que no es el momento. ` +
    'Así reviso si tengo una opción que le sirva mejor.';
}

export const NO_INTEREST_LABELS: Record<string, string> = {
  precio: 'Precio', ubicacion: 'Ubicación', competencia: 'Compró o prefiere otra opción', tiempo: 'No es el momento',
  no_califica: 'No califica', atencion: 'Atención recibida', otro: 'Otro motivo',
};

/** Aldeas de Sobre Montañas en orden (posición + 1 = número de aldea). */
const ALDEA_NAMES = ['Gavilán', 'Golondrina', 'Carpintero', 'Guacamayas', 'Canario', 'Águila Real', 'Colibrí', 'Avestruz', 'Carbonero', 'Halcón', 'Azulejo', 'Gorrión', 'Guacharaca', 'Tucanes', 'Aveja Cacatúa', 'Cóndor', 'Loro'];
const ALDEA_PATTERNS = ['GAVILAN', 'GOLONDRINA', 'CARPINTERO', 'GUACAMAYAS?', 'CANARIO', 'AGUILA REAL', 'COLIBRI', 'AVESTRUZ', 'CARBONERO', 'HALCON', 'AZULEJO', 'GORRION', 'GUACHARACA', 'TUCAN(ES)?', '(AVEJA )?CACATUA', 'CONDOR', 'LORO'];
const SOBRE_MONTANAS_ALDEAS = new RegExp(`\\b(SOBRE MONTANAS|MONTANAS|ALDEA|${ALDEA_PATTERNS.join('|')})\\b`);

/**
 * Número de aldea pedido: null si no es Sobre Montañas, 0 si es Sobre Montañas pero
 * no se sabe cuál aldea (o no existe), 1–17 si se identificó.
 */
export function sobreMontanasAldea(sector: string, terreno: string): number | null {
  if (!isSobreMontanasQuote(sector, terreno)) return null;
  const text = normKey(`${sector} ${terreno}`);
  const byName = ALDEA_PATTERNS.findIndex((pattern) => new RegExp(`\\b${pattern}\\b`).test(text));
  if (byName >= 0) return byName + 1;
  const digits = normKey(terreno).match(/\d+/);
  const num = digits ? Number(digits[0]) : 0;
  return num >= 1 && num <= ALDEA_NAMES.length ? num : 0;
}

export function aldeaName(num: number): string {
  return ALDEA_NAMES[num - 1] ?? `Aldea ${num}`;
}

function sobreMontanasRule(config: Pick<AiConfig, 'sobreMontanasQuotes'>): string {
  const base =
    `Sobre Montañas son 17 aldeas de glamping de 30.000 m² (${ALDEA_NAMES.map((n, i) => `${i + 1} ${n}`).join(', ')}) ` +
    'que se pagan de contado o a plazos de 12, 18 o 24 meses (NO 20, 30 ni 40).';
  return config.sobreMontanasQuotes
    ? `${base} Para cotizar una aldea usa enviar_cotizacion con sector "Sobre Montañas" y terreno = número o nombre de la aldea, después de preguntar si prefiere contado o 12, 18 o 24 meses. Si aún no eligió aldea, pregúntale cuál le interesa o ofrécele el plano.`
    : `${base} Todavía no se cotizan por chat: NO llames enviar_cotizacion para este club. Explica esas modalidades y ofrece una llamada con un asesor para el valor exacto de la aldea.`;
}

async function sobreMontanasAldeaStatus(aldea: number): Promise<string | null> {
  try {
    const snap = await inventoryDb().collection('proyectos_resumen').doc('sobre-montañas').get();
    const lots = (snap.data()?.lots ?? {}) as Record<string, { n?: unknown; s?: unknown }>;
    const lot = Object.values(lots).find((l) => Number(String(l.n ?? '').trim()) === aldea);
    return lot ? String(lot.s ?? '').trim().toUpperCase() : null;
  } catch (err) {
    logger.warn('[AI] No se pudo verificar la disponibilidad de la aldea', { aldea, error: String(err) });
    return null;
  }
}

/**
 * Sobre Montañas no se cotiza: su lista de precios va a contado/12/18/24 meses y el
 * cotizador la lee corrida una columna (el "contado" sale con el precio de 12 meses).
 */
export function isSobreMontanasQuote(sector: string, terreno: string): boolean {
  return SOBRE_MONTANAS_ALDEAS.test(normKey(`${sector} ${terreno}`));
}

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const DEFAULT_ADVERTISED_PRICE = 129_990_000;
export const quoteBonusBase = (config: Pick<AiConfig, 'quoteBonusBase'>) => config.quoteBonusBase ?? env.cotizadorBonoBase();
export const quoteBonusMax = (config: Pick<AiConfig, 'quoteBonusMax'>) => config.quoteBonusMax ?? env.cotizadorBonoMax();
export const advertisedPriceText = (config: Pick<AiConfig, 'advertisedPrice'>) => cop(config.advertisedPrice ?? DEFAULT_ADVERTISED_PRICE);

/** "145 millones" cuando es un valor redondo; si no, "$6.990.000". */
const millones = (n: number) => (n % 1_000_000 === 0 ? `${(n / 1_000_000).toLocaleString('es-CO')} millones` : cop(n));

/**
 * Cifras de referencia para responder "¿cuánto valen?" como los asesores (precio promedio,
 * lo que puede quedar con los bonos del mes, separación y un ejemplo de cuotas). Se editan
 * en Asistente IA → Precios; los campos vacíos no se mencionan.
 */
export function pricePitchText(config: Pick<AiConfig,
  'priceReference' | 'priceReferenceArea' | 'priceWithBonusFrom' | 'bonusRangeMin' | 'separationAmount' |
  'paymentPlanExample' | 'quoteBonusBase' | 'quoteBonusMax' | 'advertisedPrice'>): string {
  const parts: string[] = [];
  if (config.priceReference) {
    const area = config.priceReferenceArea ? ` de ${config.priceReferenceArea} m²` : '';
    parts.push(`a) En promedio los terrenos${area} están en ${millones(config.priceReference)}.`);
  } else {
    parts.push(`a) Hay terrenos desde ${advertisedPriceText(config)}.`);
  }
  const bonusMin = config.bonusRangeMin ?? quoteBonusBase(config);
  const bonusMax = quoteBonusMax(config);
  const withBonus = config.priceWithBonusFrom ? `, así que algunos pueden quedar en unos ${millones(config.priceWithBonusFrom)}` : '';
  parts.push(`b) Pero hay bonos de descuento vigentes de ${millones(bonusMin)} a ${millones(bonusMax)}${withBonus}.`);
  parts.push(config.separationAmount
    ? `c) Se separan con ${cop(config.separationAmount)} y el saldo se paga directo con la constructora a 20, 30 o 40 meses.`
    : 'c) El saldo se paga directo con la constructora a 20, 30 o 40 meses.');
  if (config.paymentPlanExample?.trim()) parts.push(`d) Ejemplo de plan (dilo tal cual, sin cambiar cifras): "${config.paymentPlanExample.trim()}"`);
  return parts.join(' ');
}


/**
 * Si tu último mensaje preguntó la forma de pago, interpreta respuestas cortas como "30",
 * "a 30 meses", "si 30" o "de contado". Devuelve null si no es una respuesta de pago.
 */
export function detectPaymentAnswer(lastAiText: string, leadText: string): { pago: 'contado' | 'cuotas'; meses?: number } | null {
  const asked = normKey(lastAiText);
  if (!/\b(CONTADO|PLAZOS|CUOTAS)\b/.test(asked) || !/\b(20 30 O 40|12 18 O 24) MESES\b/.test(asked)) return null;
  const t = normKey(leadText);
  if (/\b(CONTADO|EFECTIVO|UN SOLO PAGO)\b/.test(t)) return { pago: 'contado' };
  const allowed = /\b12 18 O 24\b/.test(asked) ? [12, 18, 24] : [20, 30, 40];
  const bare = t.match(/^(?:(?:SI|SII|OK|DALE|A|EN|DE|POR FAVOR|MEJOR|PLAZOS?|CUOTAS?)\s+)*(\d{2})(?:\s+(?:MESES|MESAS|MES|CUOTAS))?(?:\s+(?:POR FAVOR|GRACIAS))?$/);
  const explicit = t.match(/\b(\d{2})\s+(?:MESES|MESAS|CUOTAS)\b/);
  const n = Number((explicit ?? bare)?.[1]);
  return allowed.includes(n) ? { pago: 'cuotas', meses: n } : null;
}

/**
 * Club cuyo brochure corresponde a lo que eligió el lead ("Mariquita" → Río Claro).
 * Alvarado no (hay que preguntar el club) y Sobre Montañas no tiene brochure.
 */
export function brochureClubChoice(text: string): string | null {
  const t = normKey(text);
  if (/\b(CANON|ARIZONA)\b/.test(t)) return 'Cañón de Arizona';
  if (/\bLLANO GRANDE\b|\bLLANO\b/.test(t)) return 'Llano Grande';
  if (/\b(LAGUNA MAR|LAGUNA|SANTORINI|CANARIAS|MELGAR|RICAURTE)\b/.test(t)) return 'Laguna Mar';
  if (/\b(RIO CLARO|MARIQUITA)\b/.test(t)) return 'Río Claro';
  return null;
}

/** Sector como lo espera enviar_cotizacion a partir del sector del inventario. */
export function quoteSectorArg(inventorySector: string): string {
  const map: Record<string, string> = {
    'TEXAS': 'Texas', 'COLORADO': 'Colorado', 'LAS VEGAS': 'Las Vegas', 'LOS ANGELES': 'Los Angeles',
    'SAN FRANCISCO': 'Sn.FRANCISCO', 'RIO LAGUNILLA': 'Lagunilla', 'RIO MEDINA': 'Medina',
    'MAR SANTORINI': 'Mar Santorini', 'MAR CANARIAS': 'Mar Canarias',
    'VALLE DE ABURRA': 'Valle de Aburrá', 'SAN ANTONIO': 'San Antonio',
  };
  return map[inventorySector] ?? inventorySector;
}

/** La respuesta promete generar/enviar la cotización (sin haberla enviado). */
export function promisesQuote(text: string): boolean {
  const t = normKey(text);
  const promise = '(GENERARE|PROCEDERE|PROCEDO|VOY A GENERAR|VOY A ENVIAR|VOY A COMPARTIR|LE ENVIO|TE ENVIO|LE COMPARTO|TE COMPARTO|QUEDO CONFIRMADA|ENSEGUIDA LE|YA LE ENVIO|EN UN MOMENTO LE)';
  return new RegExp(`\\b${promise}\\b.{0,80}\\bCOTIZACION\\b|\\bCOTIZACION\\b.{0,80}\\b${promise}\\b`).test(t);
}

/** Modalidad de cita que pidió el lead en el texto (null si no dijo). */
export function detectAppointmentModality(text: string): AppointmentModality | null {
  const t = normKey(text);
  if (/\b(VIDEO ?LLAMADA|VIDEOCONFERENCIA|MEET|GOOGLE MEET|VIDEO|ZOOM|VIRTUAL|POR CAMARA)\b/.test(t)) return 'videollamada';
  if (/\b(LLAMADA TELEFONICA|POR TELEFONO|TELEFONICAMENTE|ME LLAMEN|QUE ME LLAME|LLAMEME|LLAMAME|POR LLAMADA|UNA LLAMADA)\b/.test(t)) return 'llamada';
  return null;
}

/** Última modalidad que pidió el lead en sus mensajes recientes. */
export function leadPreferredModality(leadTexts: string[]): AppointmentModality | null {
  for (let i = leadTexts.length - 1; i >= 0; i -= 1) {
    const found = detectAppointmentModality(leadTexts[i]);
    if (found) return found;
  }
  return null;
}

/** Cuántas veces preguntó la IA la forma de pago en sus últimos mensajes. */
export function countPaymentQuestions(aiTexts: string[]): number {
  return aiTexts.filter((text) => /\b(20 30 O 40|12 18 O 24) MESES\b/.test(normKey(text))).length;
}

/**
 * Tras la nota de voz de bienvenida (que ya saluda y pregunta el municipio), solo se
 * responde si el lead dijo algo concreto: un club o municipio, una pregunta, precio,
 * ubicación, un número… Si solo pidió "información", la nota de voz ya le respondió.
 */
export function shouldAnswerAfterVoiceWelcome(text: string): boolean {
  const t = normKey(text);
  if (/\?/.test(text) || /\d/.test(t)) return true;
  return /\b(ALVARADO|MELGAR|MARIQUITA|IBAGUE|GIRARDOT|CANON|ARIZONA|LLANO|LAGUNA|RIO CLARO|SOBRE MONTANAS|PRECIO|PRECIOS|VALOR|COSTO|CUANTO|CUOTA|CUOTAS|FINANCIA\w*|CREDITO|CONTADO|UBICACION|DONDE|VISITA|VISITAR|PLANO|BROCHURE|CITA|LLAMADA|ASESOR|ESCRITURA\w*|ENTREGA|CASA|CASAS|INVERSION|SERVICIO)\b/.test(t);
}

/** Tras la bienvenida se responde de una vez, salvo que el lead solo haya saludado. */
export function shouldAnswerAfterWelcome(text: string): boolean {
  const remaining = normKey(text)
    .replace(/\b(HOLA|HOLI|BUENAS|BUENOS|BUEN|DIA|DIAS|TARDE|TARDES|NOCHE|NOCHES|SALUDOS|SI|OK|VALE|GRACIAS|INFO|INFORMACION)\b/g, ' ')
    .trim();
  return remaining.split(/\s+/).filter(Boolean).length >= 2;
}

export function buildVictoriaWelcomeSpeech(lead: Pick<Lead, 'name' | 'source'>, short = false): string {
  const cleanName = safeGreetingName(lead);
  const greeting = cleanName
    ? `¡Hola, ${cleanName}! Qué gusto saludarle. Soy Victoria Sarmiento, asistente virtual de Grupo Constructor Meraki.`
    : `¡Hola! Qué gusto saludarle. Soy Victoria Sarmiento, asistente virtual de Grupo Constructor Meraki.`;

  // Si el lead ya preguntó algo, la nota de voz solo saluda: la respuesta llega enseguida por escrito
  // (antes la voz preguntaba el municipio y el texto lo volvía a preguntar).
  if (short) {
    return `${greeting} En Meraki llevamos más de 26 años y más de dos mil quince familias han confiado en nosotros. ` +
      'Con mucho gusto le ayudo: ya mismo le respondo por aquí.';
  }

  return (
    `${greeting} En Meraki contamos con más de 26 años de experiencia haciendo realidad el sueño de inversión y descanso de más de dos mil quince familias. ` +
    `Actualmente tenemos exclusivos clubes de campo en Alvarado, Melgar y Mariquita, en el Tolima. ` +
    `Cuénteme, ¿en cuál de estos municipios le gustaría invertir o qué tiene en mente para su descanso familiar?`
  );
}

export function buildVictoriaWelcomeText(lead: Pick<Lead, 'name' | 'source'>): string {
  const cleanName = safeGreetingName(lead);
  const greeting = cleanName
    ? `¡Hola, ${cleanName}! ☀️ Qué gusto saludarle. Soy Victoria Sarmiento, asistente virtual de Grupo Constructor Meraki. 🌿`
    : `¡Hola! ☀️ Qué gusto saludarle. Soy Victoria Sarmiento, asistente virtual de Grupo Constructor Meraki. 🌿`;

  return (
    `${greeting}\n\n` +
    `Al comunicarse por este canal oficial de ventas, autoriza el tratamiento de sus datos personales para fines informativos y comerciales conforme a la Ley 1581 de 2012.`
  );
}

/** Aviso de datos que va después de la nota de voz: ya se saludó, no se repite. */
export const VICTORIA_DATA_NOTICE =
  'Al comunicarse por este canal oficial de ventas, autoriza el tratamiento de sus datos personales para fines informativos y comerciales conforme a la Ley 1581 de 2012. 🌿';

export function buildLegalWelcomeForCompany(
  config: Pick<AiConfig, 'agentProfile'>,
  lead: Pick<Lead, 'name' | 'source'>
): string {
  return usesConsultiveAgent(config) ? buildVictoriaWelcomeText(lead) : buildLegalWelcome(lead);
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

export function quoteKey(sector: string, terreno: string | number, pago: string, meses?: number, bonoGanado?: number): string {
  const base = `${normalizeText(String(sector || ''))}:${normalizeText(String(terreno || ''))}:${pago}`;
  return `${base}:${pago === 'cuotas' ? (meses ?? '') : 'contado'}:${bonoGanado || 'base'}`.slice(0, 180);
}

interface RecentQuotationContext {
  sector?: string;
  terreno: string;
  pago?: string;
  meses?: string;
}

/** Mensajes que se revisan para deducir el plano activo y el estado de la cotización. */
const QUOTE_STATE_WINDOW = 60;

interface RecentPlanoContext {
  planoId?: string;
  projectName?: string;
  stageName?: string | null;
  name?: string;
}

export interface LibraryPortfolioItem {
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

const LAGUNA_MAR_ALIASES = ['LAGUNA MAR', 'MAR SANTORINI', 'MAR CANARIAS'];
const RIO_CLARO_ALIASES = ['RIO CLARO', 'LAGUNILLA', 'MEDINA'];
const GENERAL_PORTFOLIO_ALIASES = ['PORTAFOLIO GENERAL', 'GENERAL MERAKI', 'GC MERAKI'];

export type PortfolioRequest =
  | { kind: 'lookup'; aliases: string[] }
  | { kind: 'ask_club'; municipality: string; options: string[] };

/**
 * Traduce lo que pidió la IA (club o municipio) a qué brochure buscar.
 * Los clubes van primero para que "Laguna Mar, Melgar" no se trate como municipio, y
 * no se usa la palabra suelta "SOBRE": aparece en frases como "brochure sobre Melgar".
 */
export function resolvePortfolioRequest(project: string): PortfolioRequest {
  const p = normKey(project);
  if (/\b(CANON|ARIZONA)\b/.test(p)) return { kind: 'lookup', aliases: ['CANON DE ARIZONA', 'ARIZONA'] };
  if (/\b(LAGUNA|MAR|SANTORINI|CANARIAS)\b/.test(p)) return { kind: 'lookup', aliases: LAGUNA_MAR_ALIASES };
  if (/\b(RIO|CLARO|LAGUNILLA|MEDINA)\b/.test(p)) return { kind: 'lookup', aliases: RIO_CLARO_ALIASES };
  if (/\b(LLANO|GRANDE|SAN ANTONIO|ABURRA)\b/.test(p)) return { kind: 'lookup', aliases: ['LLANO GRANDE', 'SAN ANTONIO', 'VALLE DE ABURRA'] };
  if (/\b(SOBRE MONTANAS|MONTANAS)\b/.test(p)) return { kind: 'lookup', aliases: ['SOBRE MONTANAS'] };
  if (/\b(MELGAR|RICAURTE)\b/.test(p)) return { kind: 'lookup', aliases: LAGUNA_MAR_ALIASES };
  if (/\bMARIQUITA\b/.test(p)) return { kind: 'lookup', aliases: RIO_CLARO_ALIASES };
  if (/\bALVARADO\b/.test(p)) {
    return { kind: 'ask_club', municipality: 'Alvarado', options: ['Cañón de Arizona', 'Llano Grande'] };
  }
  if (/\b(GENERAL|MERAKI)\b/.test(p)) return { kind: 'lookup', aliases: GENERAL_PORTFOLIO_ALIASES };
  return { kind: 'lookup', aliases: [p] };
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

/**
 * Elige el brochure del club pedido. Solo vale un documento marcado como brochure o
 * portafolio que mencione ese club: si no existe, devuelve null y NUNCA se reemplaza
 * por el de otro club.
 */
export function selectPortfolioItem(
  items: LibraryPortfolioItem[],
  project: string
): LibraryPortfolioItem | null {
  const request = resolvePortfolioRequest(project);
  if (request.kind !== 'lookup') return null;
  const aliases = request.aliases.filter(Boolean);
  const wantsGeneral = aliases === GENERAL_PORTFOLIO_ALIASES;
  const ranked = items
    .filter((item) => {
      const haystack = normKey(`${item.project ?? ''} ${item.title ?? ''} ${item.fileName ?? ''}`);
      return /\b(PORTAFOLIO|BROCHURE|BROUCHURE)\b/.test(haystack)
        && aliases.some((alias) => haystack.includes(alias));
    })
    .map((item) => ({ item, score: portfolioScore(item, aliases, wantsGeneral) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.sizeBytes ?? 0) - (b.item.sizeBytes ?? 0));
  return ranked[0]?.item ?? null;
}

async function findPortfolioItem(companyId: string, project: string): Promise<LibraryPortfolioItem | null> {
  const snap = await db.collection('companies').doc(companyId).collection('library').get();
  const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LibraryPortfolioItem))
    .filter((item) => !!item.downloadUrl);
  return selectPortfolioItem(items, project);
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

export type ClubKey = 'cañon-arizona' | 'llano-grande' | 'rio-claro' | 'laguna-mar' | 'sobre-montañas';

const CLUB_LABELS: Record<ClubKey, string> = {
  'cañon-arizona':  'Cañón de Arizona',
  'llano-grande':   'Llano Grande',
  'rio-claro':      'Río Claro',
  'laguna-mar':     'Laguna Mar',
  'sobre-montañas': 'Sobre Montañas',
};

const CLUB_NAME_PATTERNS: Record<ClubKey, RegExp> = {
  'cañon-arizona':  /\b(CANON|ARIZONA)\b/,
  'llano-grande':   /\bLLANO\b/,
  'rio-claro':      /\b(RIO CLARO|MARIQUITA)\b/,
  'laguna-mar':     /\b(LAGUNA|SANTORINI|CANARIAS|MELGAR)\b/,
  'sobre-montañas': /\b(SOBRE MONTANAS|MONTANAS|ALDEA)\b/,
};

/** Club al que pertenece un nombre de club o de proyecto del plano. */
export function clubKeyOf(name: string | null | undefined): ClubKey | null {
  const n = normKey(name);
  return (Object.keys(CLUB_NAME_PATTERNS) as ClubKey[]).find((k) => CLUB_NAME_PATTERNS[k].test(n)) ?? null;
}

/** Cómo leer número + color en el plano de ese club. */
export function planoColorGuide(club: ClubKey, stageName?: string | null): string {
  switch (club) {
    case 'cañon-arizona':
      return 'colores: rojo/vino = Los Angeles, azul = Texas, azul oscuro = Colorado, naranja = Las Vegas, amarillo = Sn.FRANCISCO.';
    case 'llano-grande':
      return 'usa sector="Llano Grande" con el número, sin importar el color: el sistema identifica si es Valle de Aburrá o San Antonio y te avisa si debes preguntar.';
    case 'rio-claro':
      return 'colores: azul = Lagunilla, verde = Medina.';
    case 'laguna-mar':
      return `el sector es la etapa del plano enviado${stageName ? ` (${stageName})` : ' (Mar Santorini o Mar Canarias)'}; el color no cambia la etapa.`;
    case 'sobre-montañas':
      return 'son aldeas: usa sector="Sobre Montañas" con el número o el nombre de la aldea.';
  }
}

/**
 * Si el último plano enviado es de un club y la IA intenta cotizar un sector de OTRO club
 * sin que el lead lo haya nombrado, devuelve el club del plano (el error a corregir).
 */
export function planoClubMismatch(
  planoClub: ClubKey | null,
  sectorClub: ClubKey | null,
  leadTexts: string[],
  sector: string
): ClubKey | null {
  if (!planoClub || !sectorClub || planoClub === sectorClub) return null;
  const text = normKey(leadTexts.join(' '));
  if (CLUB_NAME_PATTERNS[sectorClub].test(text)) return null;
  const sectorWords = normKey(sector).replace(/\bSN\b/, 'SAN');
  if (sectorWords && text.includes(sectorWords)) return null;
  return planoClub;
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
): Promise<{ ok: true; count: number; alreadySent?: boolean } | { ok: false; count: number }> {
  const ref = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Lead | undefined;
    const count = data?.aiQuotationCount ?? 0;
    const quoted = (data?.aiQuotedTerrenos ?? []) as string[];
    if (quoted.includes(key)) {
      return { ok: true, count, alreadySent: true };
    }
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
  if (!isLeadInAiRollout(config, lead)) {
    logger.info('[AI] Lead fuera del piloto — lo atiende el asesor', { companyId, leadId });
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
    await leadsRepository.update(companyId, leadId, { aiEnabled: false, ...humanHandoffPatch(freshLead) });
    return;
  }

  // 2b-quater. Un comprador actual no recibe el flujo de ventas: lo atiende su asesor.
  if (!isTestLead(freshLead) && await isExistingBuyer(companyId, freshLead)) {
    logger.info('[AI] El teléfono es de un comprador — se pasa al asesor', { leadId });
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      ...humanHandoffPatch(freshLead),
    });
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title: `Comprador escribió: ${lead.name?.trim() || lead.phone || 'un cliente'}`,
      body:  'Este número ya compró en Meraki. La IA no responde este chat.',
      url:   `/dashboard/inbox?lead=${leadId}`,
      type:  'lead-attention',
      leadId,
    }).catch(() => { /* best-effort */ });
    await recordAiFicha(companyId, leadId, {
      kind: 'comprador',
      result: 'El número corresponde a un comprador; la IA no respondió y avisó al asesor',
      nextAction: 'El asesor atiende al cliente',
      dedupeKey: 'comprador',
    });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // 2c. Procesar media (tras el debounce, para no gastar en mensajes descartados)
  const wasVoiceInbound = !!mediaType?.startsWith('audio/');
  if (mediaUrl && mediaType) {
    if (mediaType.startsWith('audio/')) {
      // Transcribir audio con Whisper
      try {
        logger.info('[AI] Transcribiendo audio con Whisper', { leadId });
        userMessage = await transcribeAudio(mediaUrl, mediaType);
        logger.info('[AI] Transcripción lista', { leadId, length: userMessage.length });
        await db.collection('companies').doc(companyId).collection('leads').doc(leadId).collection('messages').doc(messageId)
          .update({ 'metadata.transcription': userMessage.slice(0, 2000) })
          .catch(() => { /* best-effort */ });
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

  // 2b-bis2. Proveedor ofreciendo servicios: no es un comprador. Se responde una vez, se califica
  //          como "no es cliente" y se pausa la IA (antes recibía bienvenida y seguimientos).
  if (usesConsultiveAgent(config) && detectsVendorPitch(userMessage)) {
    logger.info('[AI] Proveedor ofreciendo servicios — se califica y se pausa la IA', { leadId });
    await saveAndSendAiResponse(companyId, leadId, lead, VENDOR_REPLY);
    await recordAiFicha(companyId, leadId, {
      kind: 'proveedor',
      result: 'Proveedor ofreciendo servicios a la constructora; no es un comprador',
      nextAction: 'Sin seguimiento comercial',
      notes: `Mensaje: "${userMessage.replace(/\s+/g, ' ').slice(0, 200)}"`,
      dedupeKey: 'proveedor',
    });
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    await leadsRepository.update(companyId, leadId, {
      legalWelcomeSent: true,
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      aiNoInterest: { category: 'no_califica', reason: 'Proveedor ofreciendo servicios', definitive: true, at: Timestamp.now() },
    });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // 2b-ter. PRIMER CONTACTO: aviso legal de bienvenida (Ley 1581) determinista.
  // Se envía aunque el lead venga de formulario/pauta si todavía no hay evidencia
  // de aviso legal previo. Si ya conocemos el nombre, no lo volvemos a pedir.
  let justWelcomed = false;
  let welcomeDoneAtMs = 0;          // para dejar una pausa natural antes de la respuesta
  let welcomeAskedMunicipio = false; // la bienvenida larga ya preguntó el municipio
  if (!freshLead.legalWelcomeSent) {
    const previous = await messagesRepository.getRecent(companyId, leadId, 10);
    const legalAlreadySent = hasLegalWelcome(previous);
    if (!legalAlreadySent) {
      logger.info('[AI] Primer contacto — enviando aviso legal de bienvenida', {
        leadId,
        source: lead.source,
        knownName: isKnownLeadName(lead.name),
      });
      let sentAt: Timestamp;
      let voiceWelcomeSent = false;
      if (isVoiceEnabled(config) && (!lead.channel || lead.channel === 'whatsapp')) {
        // Enviar nota de voz de bienvenida de Victoria Sarmiento (reutiliza audio cacheado si no tiene nombre específico)
        // ¿Se va a responder de una vez lo que preguntó? Entonces la voz solo saluda.
        const answersRightAway = usesConsultiveAgent(config) && !customerServiceIntent && !sensitiveInquiry &&
          shouldAnswerAfterVoiceWelcome(userMessage);
        const speechText = buildVictoriaWelcomeSpeech(lead, answersRightAway);
        welcomeAskedMunicipio = !answersRightAway;
        const cacheKey = safeGreetingName(lead) ? undefined : (answersRightAway ? 'welcome_short_v1_usted' : 'welcome_general_v5_usted');
        try {
          const voiceRes = await generateVictoriaVoiceNote(companyId, leadId, speechText, cacheKey);
          if (voiceRes?.audioUrl && await aiStillInControl(companyId, leadId)) {
            const voiceSent = await sendMediaToLeadChannel({ ...lead, companyId }, voiceRes.audioUrl, voiceRes.mimeType);
            voiceWelcomeSent = true;
            await messagesRepository.create({
              companyId,
              leadId,
              direction: 'outbound',
              senderType: 'ai',
              content: speechText,
              channel: 'whatsapp',
              status: 'sent',
              ...(voiceSent?.externalMsgId ? { twilioMessageSid: voiceSent.externalMsgId } : {}),
              createdAt: Timestamp.now(),
              metadata: {
                provider: lead.inboxProvider ?? 'auto',
                isVoiceNote: true,
                mediaUrl: voiceRes.audioUrl,
                mediaType: 'audio/ogg; codecs=opus',
              },
            });
          }
        } catch (vErr) {
          logger.warn('[AI] No se pudo enviar audio de bienvenida, se enviará texto', { vErr });
        }
        // Tras la nota de voz va solo el aviso de datos (sin repetir el saludo), con una pausa
        // para que no lleguen los mensajes de golpe y el audio llegue primero.
        if (voiceWelcomeSent && usesConsultiveAgent(config)) {
          await sleep(2500);
          sentAt = await saveAndSendAiResponse(companyId, leadId, lead, welcomeAskedMunicipio
            ? `${VICTORIA_DATA_NOTICE}\n\n¿En qué municipio le gustaría invertir: Alvarado, Melgar o Mariquita?`
            : VICTORIA_DATA_NOTICE);
        } else {
          welcomeAskedMunicipio = false;
          sentAt = await saveAndSendAiResponse(companyId, leadId, lead, buildLegalWelcomeForCompany(config, lead));
        }
      } else {
        sentAt = await saveAndSendAiResponse(companyId, leadId, lead, buildLegalWelcomeForCompany(config, lead));
      }
      const followUpPatch = aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 1);

      // Si desde el primer mensaje ya se ve que es Servicio al Cliente o una
      // solicitud sensible, enviamos el aviso legal primero y luego la ruta correcta.
      if (customerServiceIntent) {
        await saveAndSendAiResponse(companyId, leadId, lead, CUSTOMER_SERVICE_REDIRECT);
    await recordAiFicha(companyId, leadId, {
      kind: 'servicio_cliente',
      result: 'Cliente actual: se remitió a Servicio al Cliente',
      nextAction: 'Atención por Servicio al Cliente',
      notes: `Mensaje del cliente: "${userMessage.slice(0, 200)}"`,
      dedupeKey: 'servicio_cliente',
    });
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
          ...humanHandoffPatch(freshLead),
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
      const answerNow = voiceWelcomeSent ? shouldAnswerAfterVoiceWelcome(userMessage) : shouldAnswerAfterWelcome(userMessage);
      justWelcomed = true;
      welcomeDoneAtMs = Date.now();
      if (!(await aiStillInControl(companyId, leadId))) {
        await messagesRepository.markAiProcessed(companyId, leadId, messageId);
        return;
      }
      if (!usesConsultiveAgent(config) || !answerNow) {
        await messagesRepository.markAiProcessed(companyId, leadId, messageId);
        await scheduleFollowUps(companyId, leadId, sentAt, config);
        return;
      }
      // Texto automático del anuncio pidiendo precios: los asesores obtenían respuesta del 61 %
      // saludando y preguntando con quién hablan y desde dónde escribe; con el precio de entrada, nadie
      // respondía. Primero conversación; el precio va en el siguiente mensaje.
      if (isAdPrefilledPriceRequest(userMessage)) {
        await sleep(Math.max(0, 4000 - (Date.now() - welcomeDoneAtMs)));
        const holdAt = await saveAndSendAiResponse(companyId, leadId, lead,
          buildPriceHoldReply(safeGreetingName(lead), isForeignPhone(lead.phone) ? abroadPhrase(lead.phone) : null));
        await leadsRepository.update(companyId, leadId, aiHourlyPatch(freshLead, nowMs, windowActive, priorCount, 2));
        await messagesRepository.markAiProcessed(companyId, leadId, messageId);
        await scheduleFollowUps(companyId, leadId, holdAt, config);
        logger.info('[AI] Texto automático de precios — primero se pregunta nombre y ciudad', { leadId });
        return;
      }
    }
    await leadsRepository.update(companyId, leadId, { legalWelcomeSent: true });
  }

  // "No me interesa" sin motivo: la primera vez se le pregunta el motivo (una sola vez),
  // para ofrecerle una alternativa y saber por qué se pierden los leads.
  if (usesConsultiveAgent(config) && !detectsOptOut(userMessage) && detectsPlainNoInterest(userMessage) &&
      !freshLead.aiNoInterestAskedAt) {
    logger.info('[AI] El lead dijo que no le interesa — se le pregunta el motivo', { leadId });
    await saveAndSendAiResponse(companyId, leadId, lead, noInterestReasonQuestion(safeGreetingName(freshLead)));
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    await leadsRepository.update(companyId, leadId, { aiNoInterestAskedAt: Timestamp.now() });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // Rechazo definitivo: se despide, sin más seguimientos, y queda para el asesor.
  if (usesConsultiveAgent(config) && detectsFinalRejection(userMessage)) {
    logger.info('[AI] El lead rechazó el contacto — se pausa la IA sin seguimientos', { leadId });
    const optOut = detectsOptOut(userMessage);
    await recordAiFicha(companyId, leadId, {
      kind: 'desistimiento',
      result: optOut ? 'El cliente pidió no ser contactado' : 'El cliente dijo que no le interesa y no dio el motivo',
      nextAction: 'Sin seguimiento; el asesor decide si retoma',
      notes: `Mensaje del cliente: "${userMessage.slice(0, 200)}"`,
      dedupeKey: 'desistimiento',
    });
    await saveAndSendAiResponse(companyId, leadId, lead, 'Le entiendo, gracias por escribirnos. Cuando quiera retomarlo, aquí estaremos. 🌿');
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      aiRejectedAt: Timestamp.now(),
      ...humanHandoffPatch(freshLead),
    });
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title: `${lead.name?.trim() || lead.phone || 'Un lead'} no quiere continuar`,
      body:  'Dijo que no le interesa o pidió no ser contactado. La IA se pausó.',
      url:   `/dashboard/inbox?lead=${leadId}`,
      type:  'lead-attention',
      leadId,
    }).catch(() => { /* best-effort */ });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  if (customerServiceIntent) {
    logger.info('[AI] Derivación determinista a Servicio al Cliente', { leadId });
    await saveAndSendAiResponse(companyId, leadId, lead, CUSTOMER_SERVICE_REDIRECT);
    await recordAiFicha(companyId, leadId, {
      kind: 'servicio_cliente',
      result: 'Cliente actual: se remitió a Servicio al Cliente',
      nextAction: 'Atención por Servicio al Cliente',
      notes: `Mensaje del cliente: "${userMessage.slice(0, 200)}"`,
      dedupeKey: 'servicio_cliente',
    });
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
      aiDisabledAt: Timestamp.now(),
      aiTakeoverSlaStatus: 'pending',
      sensitiveInquiryEscalatedAt: Timestamp.now(),
      ...humanHandoffPatch(freshLead),
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

  // 2b-quater. Respuesta SÍ / NO a la plantilla de seguimiento que pregunta si quiere un asesor.
  let wantsAdvisorFromTemplate = false;
  const yesNo = usesConsultiveAgent(config) ? templateYesNo(userMessage) : null;
  if (yesNo) {
    const recentForTemplate = await messagesRepository.getRecent(companyId, leadId, 6);
    const lastAiMsg = [...recentForTemplate].reverse().find((m) => m.direction === 'outbound' && m.senderType === 'ai');
    const lastTemplate = String(lastAiMsg?.metadata?.templateName ?? '');
    const askedYesNo = !!lastTemplate && /RESPONDE SI\b.*RESPONDE NO\b/.test(normKey(lastAiMsg?.content ?? ''));
    if (askedYesNo && yesNo === 'no') {
      logger.info('[AI] Respondió NO a la plantilla de seguimiento — se cierra la solicitud', { leadId, lastTemplate });
      await leadsRepository.update(companyId, leadId, {
        aiNoInterest: { category: 'otro', reason: 'Respondió NO al mensaje de seguimiento', definitive: true, at: Timestamp.now() },
      });
      await recordAiFicha(companyId, leadId, {
        kind: 'desistimiento',
        result: 'Respondió NO al seguimiento: cerró su solicitud de información',
        nextAction: 'Sin seguimiento; el asesor decide si retoma',
        dedupeKey: 'desistimiento',
      });
      await saveAndSendAiResponse(companyId, leadId, lead, 'Entendido, gracias por avisarnos. Cerramos su solicitud; si más adelante quiere retomarla, aquí estaremos. 🌿');
      await followUpsRepository.cancelPendingForLead(companyId, leadId);
      await leadsRepository.update(companyId, leadId, {
        aiEnabled: false,
        aiDisabledAt: Timestamp.now(),
        aiRejectedAt: Timestamp.now(),
        ...humanHandoffPatch(freshLead),
      });
      await messagesRepository.markAiProcessed(companyId, leadId, messageId);
      return;
    }
    if (askedYesNo && yesNo === 'si') wantsAdvisorFromTemplate = true;
  }

  // 2c. Solo agradece y Victoria ya cerró sin pregunta pendiente: no se repite el cierre.
  //     Se reprograma el seguimiento desde este mensaje para retomarlo después.
  if (usesConsultiveAgent(config) && isCourtesyOnly(userMessage)) {
    const recent = await messagesRepository.getRecent(companyId, leadId, 12);
    const lastAi = [...recent].reverse().find((m) =>
      m.direction === 'outbound' && m.senderType === 'ai' && !!m.content?.trim() &&
      !/ley\s*1581/i.test(m.content ?? '') && !m.metadata?.origin);
    // Solo si TODO lo que escribió desde la última respuesta es agradecimiento: si antes preguntó
    // algo (y esa respuesta se descartó por llegar este mensaje), la pregunta se responde.
    const sinceLastAi = recent.filter((m) => m.direction === 'inbound' && m.senderType === 'lead' &&
      (!lastAi || m.createdAt.toMillis() > lastAi.createdAt.toMillis()));
    const onlyCourtesy = sinceLastAi.every((m) => m.id === messageId || isCourtesyOnly(m.content ?? ''));
    if (lastAi && onlyCourtesy && !/\?/.test(lastAi.content ?? '')) {
      logger.info('[AI] El lead solo agradeció tras el cierre — no se responde de nuevo', { leadId });
      await messagesRepository.markAiProcessed(companyId, leadId, messageId);
      await scheduleFollowUps(companyId, leadId, Timestamp.now(), config);
      return;
    }
  }

  // 3. Detectar keyword de transferencia a humano
  if (detectsTransferKeyword(userMessage, config.transferKeywords)) {
    logger.info('[AI] Keyword de transferencia detectado', { leadId, userMessage });
    await bumpAiDaily(companyId, { traspasos: 1 });
    await recordAiFicha(companyId, leadId, {
      kind: 'pidio_asesor',
      result: 'El cliente pidió hablar con un asesor; la IA se pausó',
      nextAction: 'El asesor contacta al cliente',
      notes: `Mensaje del cliente: "${userMessage.slice(0, 200)}"`,
    });
    const transferMsg = '¡Claro! Le voy a conectar con uno de nuestros asesores. Por favor espere un momento. 🙏';
    await saveAndSendAiResponse(companyId, leadId, lead, transferMsg);
    // Pausar IA automáticamente e iniciar SLA de 24h para el asesor
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      aiTakeoverSlaStatus: 'pending',
      ...humanHandoffPatch(freshLead),
    });
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title: `${lead.name?.trim() || lead.phone || 'Un lead'} pidió hablar con un asesor`,
      body:  'La IA se pausó. Abre la conversación y responde.',
      url:   `/dashboard/inbox?lead=${leadId}`,
      type:  'lead-attention',
      leadId,
    }).catch(() => { /* best-effort */ });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // 4. Cargar historial reciente
  const history: Message[] = await messagesRepository.getRecent(
    companyId,
    leadId,
    config.maxContextMessages
  );
  // Historial largo solo para deducir plano y cotización (no se envía al modelo): en chats
  // largos el plano queda fuera de los últimos mensajes y la cotización dejaba de funcionar.
  const longHistory: Message[] = history.length >= config.maxContextMessages
    ? await messagesRepository.getRecent(companyId, leadId, QUOTE_STATE_WINDOW)
    : history;

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
        arguments: JSON.stringify({
          fecha_hora_iso: selectedSlot.iso,
          duracion_minutos: 30,
          modalidad: leadPreferredModality([
            ...history.filter((m) => m.direction === 'inbound' && m.senderType === 'lead').slice(-6).map((m) => m.content ?? ''),
            userMessage,
          ]) ?? (isForeignPhone(lead.phone) ? 'videollamada' : 'llamada'),
        }),
      },
    }, config.businessName, userMessage);
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
      const when = await nextAppointmentLabel(companyId, leadId, env.calendarTimeZone());
      if (await recordAiFicha(companyId, leadId, {
        kind: 'cita',
        result: `La IA agendó una cita con el asesor${when ? ` para el ${when}` : ''}`,
        nextAction: 'Cita comercial con el asesor (ver modalidad en la cita)',
        dedupeKey: `cita:${when}`,
      })) await refreshLeadAnalysis(companyId, leadId);
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
      `agendar o reagendar, con fecha y hora concretas dadas por él. ` +
      `CITAS VS VISITAS AL TERRENO: Las citas que agenda la IA son con un asesor comercial, por llamada telefónica ` +
      `o por videollamada de Google Meet, como prefiera el lead (si no lo dice, es llamada). Si el lead solicita una visita presencial ` +
      `al terreno o ir a conocer el club de campo en persona (ej. "quiero ir el domingo", "puedo ir a conocer los lotes"): ` +
      `NO uses agendar_cita para la visita en campo. Explica con calidez que toda visita a terreno se coordina ` +
      `directamente con un asesor comercial para autorizar el ingreso en portería y asignar acompañamiento en el club, ` +
      `y ofrécele agendar una cita previa con el asesor para coordinar todos los detalles de su visita.`,
  });
  messages.push({
    role: 'system',
    content:
      `Datos internos del lead para esta conversación: nombre registrado: "${lead.name || ''}". ` +
      (safeGreetingName(lead)
        ? `Si lo nombras, dile solo "${safeGreetingName(lead)}". `
        : 'Ese nombre es el de su perfil y no parece un nombre de persona: NO lo uses para dirigirte al lead (háblale sin nombre hasta que te lo diga). ') +
      `Teléfono registrado: "${lead.phone || ''}". ` +
      `Si el teléfono registrado no está vacío y el lead quiere agendar, NO preguntes a qué número desea ` +
      `recibir la llamada de entrada: confirma ese número exacto. Si el lead dice "a este número", ` +
      `interpreta que se refiere al teléfono registrado. Si el teléfono está vacío, entonces sí debes pedirlo.`,
  });

  const activeAppt = await findActiveAppointmentForLead(companyId, leadId);
  if (activeAppt) {
    const apptDateStr = fmtDate(activeAppt.startTime.toDate());
    messages.push({
      role: 'system',
      content:
        `ESTADO DE CITAS EN EL CRM: El lead TIENE una cita ACTIVA y CONFIRMADA para el ${apptDateStr}. ` +
        `Si el lead pregunta si ya quedó agendado o pide detalles, recuérdale esa fecha y hora. ` +
        `Si no pide reprogramar ni cancelar, NO llames agendar_cita ni consultar_horarios.`,
    });
  } else {
    messages.push({
      role: 'system',
      content:
        `ESTADO DE CITAS EN EL CRM: El lead NO tiene ninguna cita agendada en el sistema todavía. ` +
        `PROHIBIDO AFIRMAR QUE UNA CITA YA ESTÁ AGENDADA O PROGRAMADA (ej. "ya programamos tu llamada", "quedó lista") ` +
        `si la herramienta agendar_cita no fue ejecutada con éxito en esta conversación. ` +
        `Si el lead pregunta "¿ya agendamos?", "¿quedó programada?", o asume que ya quedó agendada, ` +
        `y ya dio fecha/hora, LLAMA la herramienta agendar_cita con esa fecha/hora. ` +
        `Si no ha dado horario o falta confirmarlo, llama consultar_horarios o pídele que elija un horario.`,
    });
  }
  messages.push({
    role: 'system',
    content:
      `PROHIBICIÓN ESTRICTA DE ENVIAR EL PLANO PRECIPITADAMENTE: Si el lead pregunta de forma general por un club ` +
      `(ej. "¿Qué tal Cañón?", "Cuéntame de Cañón", "Cómo es Llano Grande", etc.) o apenas muestra interés inicial por él, ` +
      `ESTÁ TOTALMENTE PROHIBIDO llamar enviar_plano y ESTÁ PROHIBIDO llamar enviar_plano junto con enviar_portafolio en el mismo turno. ` +
      `En ese momento primero presenta el club (ubicación, metrajes de terrenos, concepto y amenidades), envía ÚNICAMENTE el brochure con enviar_portafolio y pregúntale si desea profundizar en las amenidades o si le gustaría ver el plano de disponibilidad. ` +
      `La herramienta enviar_plano SOLO se debe usar cuando el lead pida explícitamente ver el plano ("envíame el plano", "quiero ver los planos", "tienes el plano") o cuando acepte verlo tras la presentación. ` +
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
      `saltes a pedir el número de contacto de golpe: ` +
      (config.quoteMode !== 'off'
        ? `sigue el flujo de cotización (enviar_cotizacion; si no dio forma de pago, el sistema cotiza a 40 meses) y después ofrece la cita. `
        : `primero, de forma natural, OFRÉCELE agendar una cita con un asesor para darle información personalizada y una cotización de ese terreno, y espera a que acepte. `) +
      `Cuando acepte la cita, confirma el teléfono ` +
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
      `ubícate con naturalidad según su origen y su mensaje. Si el anuncio promete algo (por ejemplo un recorrido por videollamada ` +
      `o que Meraki se encarga de construir), conéctalo en tu respuesta. Los precios y áreas válidos son SOLO los de tus instrucciones ` +
      `y del sistema, aunque el anuncio diga otro valor: no menciones esa diferencia. Responde SIEMPRE, y SOLO con la información ` +
      `de tus instrucciones: si te preguntan algo que no está ahí (o un dato que no tienes), dilo con ` +
      `transparencia y ofrece que un asesor lo confirme. Nunca inventes precios, áreas, fechas, estados ` +
      `de obra ni características.`,
  });
  messages.push({
    role: 'system',
    content:
      `Avances de obra: SOLO si el lead pregunta cómo va la obra, el avance o la construcción, usa consultar_avance_obra (club = "todos" si pregunta por los proyectos en general). Con lo que te devuelva, responde con un resumen breve y el enlace. En ese turno NO envíes brochure ni plano. Si solo pregunta por un club, NO hables del avance de obra. NO inventes porcentajes ni fechas de entrega. ` +
      `Portafolios/Brochures: cuando el lead elija un club concreto por primera vez o pregunte por él ` +
      `(Cañón de Arizona, Laguna Mar, Río Claro, Llano Grande o Sobre Montañas), usa enviar_portafolio ` +
      `con ese club para enviar el PDF aprobado, acompañándolo de una presentación clara y cálida del club (ubicación, clima, tamaños de terrenos y amenidades clave) sin sonar insistente. ` +
      `Si la herramienta responde que un club no tiene brochure, NO envíes otro en su lugar. ` +
      `Si el lead solo nombra un municipio: Melgar es Laguna Mar y Mariquita es Río Claro, envía ese brochure. ` +
      `Si dice Alvarado, NO envíes nada todavía: pregúntale si le interesa Cañón de Arizona o Llano Grande. ` +
      `NUNCA llames enviar_plano en el mismo turno que enviar_portafolio. ` +
      `NO envíes el portafolio general en el primer saludo. Si el lead pide información general, pregunta primero ` +
      `qué municipio o club le interesa y puedes ofrecer el portafolio general como apoyo opcional. ` +
      `Usa enviar_portafolio con "PORTAFOLIO GENERAL MERAKI" solo si el lead lo pide o acepta verlo. ` +
      `No prometas ni reenvíes un portafolio si ya fue enviado. Después de presentar el club y enviar el portafolio, ` +
      `cierra con una pregunta consultiva: indaga si le gustaría conocer más sobre las amenidades o si prefiere revisar el plano de disponibilidad.`,
  });

  const areasText = await inventoryAreasText().catch(() => '');
  if (areasText) {
    messages.push({
      role: 'system',
      content:
        `ÁREAS DISPONIBLES HOY según el inventario real (se actualiza a medida que se vende): ${areasText}. ` +
        'Usa SOLO estos rangos cuando hables de tamaños de terrenos; ignora cualquier otro rango de áreas de tus instrucciones. No digas cuántos terrenos quedan.',
    });
  }

  const currentTurnHasImage = !!mediaUrl && !!mediaType?.startsWith('image/');
  const recentPlano = latestAiPlano(longHistory);
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
        `naranja = Las Vegas, amarillo = Sn.FRANCISCO. En Llano Grande usa sector "Llano Grande" con el número: el sistema identifica si es Valle de Aburrá o San Antonio. En Río Claro: azul = Lagunilla, verde = Medina. NO respondas usando el último terreno cotizado salvo que el ` +
        `lead diga explícitamente "el mismo", "el anterior" o "el que ya me cotizaste". Si no puedes identificar ` +
        `con seguridad el número o el sector/etapa del terreno marcado, pregunta para confirmar; no inventes.`,
    });
  } else if (recentPlano?.projectName) {
    const planoClub = clubKeyOf(recentPlano.projectName);
    messages.push({
      role: 'system',
      content:
        `Contexto del plano reciente: el último plano enviado fue ${recentPlano.projectName}` +
        `${recentPlano.stageName ? ` - ${recentPlano.stageName}` : ''}. Si el lead responde con número + color ` +
        `(por ejemplo "59 rojo"), es un terreno de ese club y cotiza si ya dio forma de pago. ` +
        (planoClub ? `En ${CLUB_LABELS[planoClub]}, ${planoColorGuide(planoClub, recentPlano.stageName)}` : ''),
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
        `pago, recotizar o aplicar un bono ganado. ` +
        `REGLA ESTRICTA DE AGENDAMIENTO TRAS COTIZAR: si tu mensaje anterior ofreció agendar una llamada ` +
        `(ej. "¿Te gustaría que la agendemos?") y el lead responde afirmativamente ("sí", "si eso", "agendemos", "dale", "claro", "por favor", "me gustaría") ` +
        `o propone fecha/hora, el lead ESTÁ ACEPTANDO O PIDIENDO AGENDAR, NO solicitando que le envíes la cotización otra vez. ` +
        `En ese caso está PROHIBIDO llamar enviar_cotizacion: debes llamar consultar_horarios (o agendar_cita si ya dio fecha y hora) para avanzar con el agendamiento. ` +
        `NUNCA vuelvas a enviar la cotización del mismo terreno.`,
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
        (usesConsultiveAgent(config)
          ? `Si el lead eligió un terreno pero NO ha dicho cómo desea pagar, NO le preguntes la forma de pago: llama enviar_cotizacion SIN tipo_pago y el sistema lo cotiza a 40 meses (la cuota más cómoda) y le explica que de contado o a menos meses el valor total es menor. ` +
            `NUNCA cotices de contado por defecto. Si el lead ya eligió contado o 20, 30 o 40 meses, cotiza con esa modalidad. ` +
            `NUNCA hagas preguntas abiertas sin nombrar los 20, 30 o 40 meses. NUNCA uses la palabra "financiación". `
          : `Si aún no has enviado la cotización de ese terreno, NO inventes el ` +
            `precio: pregúntale si lo quiere de contado o en cuotas (y si es en cuotas, a cuántos meses), y ` +
            `luego usa la herramienta enviar_cotizacion — ella calcula el valor real y envía la imagen. `) +
        (proactivo
          ? `Ofrece la cotización de forma proactiva apenas el lead elija un terreno (sin preguntar la forma de pago: si no la dio, se cotiza a 40 meses). `
          : `Cotiza cuando el lead pregunte por el precio de un terreno. `) +
        `El parámetro "sector" de enviar_cotizacion DEBE ser el SECTOR o ETAPA EXACTO, NUNCA el nombre general del club de campo (única excepción: Llano Grande, ver abajo). ` +
        `Mapa de sectores válidos: ` +
        `Cañón de Arizona → Texas (azul), Colorado (azul oscuro), Las Vegas (naranja), Los Angeles (rojo/vino), Sn.FRANCISCO (amarillo). ` +
        `Río Claro → Lagunilla (azul), Medina (verde). ` +
        `Llano Grande → Valle de Aburrá y San Antonio (los dos tienen terrenos desde unos 300 m²). ` +
        `Laguna Mar → Mar Santorini, Mar Canarias. ` +
        `Sobre Montañas → ${config.sobreMontanasQuotes ? 'sector "Sobre Montañas" y terreno = número o nombre de la aldea (1 a 17)' : 'NO se cotiza'}. ` +
        `SOBRE LLANO GRANDE: no supongas el sector ni se lo preguntes de entrada. Usa sector="Llano Grande" con el número del terreno: el sistema identifica si es Valle de Aburrá o San Antonio. Solo si la herramienta te pide aclarar, pregúntale al lead en cuál de los dos sectores está el terreno que marcó. ` +
        `¡MUY IMPORTANTE SOBRE LOS COLORES!: Si el lead pide un terreno por color (ej. "el 43 amarillo"), REVISA PRIMERO de qué club de campo están hablando. ` +
        `NUNCA asumas automáticamente que "amarillo" es San Francisco si están hablando de otro proyecto como Llano Grande. ` +
        `Busca hacer coincidir el color ÚNICAMENTE con los sectores del club de campo del que vienen hablando. Si el lead pide un color en un proyecto del que no sabes sus colores, PREGÚNTALE a qué etapa pertenece ese color. NUNCA inventes cruces entre proyectos diferentes. ` +
        `Si no da el sector ni el color, pregúntale en qué sector está. ` +
        `BONOS: la cotización que envía la herramienta YA incluye un bono de descuento de ${cop(quoteBonusBase(config))} aplicado. Si el lead ` +
        `pregunta por bonos, descuentos o promociones, NO digas que no hay: dile que la cotización ya trae un ` +
        `bono de ${cop(quoteBonusBase(config))} y que si quiere probar suerte jugando por un bono mayor, puede ingresar a ${env.puertabonoUrl()} ` +
        `(aclarando que el bono ganado en el juego se cambia por el bono inicial; NO se suman ni son acumulables, y queda sujeto a validación de un asesor). ` +
        `Si el lead dice que YA jugó y GANÓ un bono (p. ej. "gané 50 millones", "me gané el de 50"), vuelve a ` +
        `cotizar el MISMO terreno con enviar_cotizacion pasando bono_ganado = ese monto en pesos (50 millones = ` +
        `50000000). En ese caso NO lo invites a jugar otra vez y felicítalo por su bono. ` +
        `Después de enviar la cotización, ofrece agendar una llamada con un asesor. No repitas la misma ` +
        `cotización más de una vez seguida.`,
    });

    if (usesConsultiveAgent(config)) {
      messages.push({
        role: 'system',
        content:
          `DIRECTRICES DE ASESORÍA COMERCIAL CONSULTIVA:\n` +
          `1. VOCABULARIO OBLIGATORIO Y CERO REDUNDANCIAS: ` +
          `PROHIBIDO utilizar las palabras "financiación", "financiar" o "financiado". Usa exclusivamente términos como "formas de pago", "pago a plazos", "planes de pago" o "pago en cuotas". ` +
          `PROHIBIDO redundar palabras sinónimas como "clubes de campo campestres" (campo y campestre son lo mismo; usa simplemente "clubes de campo" o "condominios campestres"). ` +
          `PROHIBIDO usar la palabra "proyecto", en Meraki se dice siempre "club de campo". ` +
          `Cuida que la redacción sea elegante, concisa y sin repetir palabras innecesarias en la misma frase.\n` +
          `2. CUANDO PREGUNTAN PRECIOS ("¿Cuánto valen?", "precios de los lotes", "¿Desde cuánto?") y todavía no ha elegido un terreno: responde como lo hacen nuestros asesores, mostrando que el terreno es alcanzable, no con el precio total en seco. ` +
          `En UN mensaje corto (3 a 5 líneas, sin viñetas), en este orden y usando SOLO estas cifras: ${pricePitchText(config)} ` +
          `Cierra con UNA pregunta para mostrarle el plano y cotizarle un terreno real (en qué municipio le gustaría: Alvarado, Melgar o Mariquita, o si ya tiene uno en mente). ` +
          `Tono cercano y seguro, como un asesor que conversa ("Claro que sí…"), redactado con tus palabras y no como lista. ` +
          `No inventes otras cifras, no calcules cuotas para otros plazos ni para otros valores, y no digas "de contado" junto a esos precios. El valor exacto de un terreno sale de la cotización oficial cuando lo elija. ` +
          `PROHIBIDO activar automáticamente la herramienta enviar_cotizacion ante preguntas generales de precios.\n` +
          `3. PRESENTACIÓN DE CLUBES Y ENVÍO DE MATERIAL (FLUJO NO PRECIPITADO):\n` +
          `- Si el cliente pregunta qué tal es un club o pide información de él (ej. "¿Qué tal Cañón?", "Cuéntame de Cañón", "Cómo es Llano Grande", etc.):\n` +
          `  * DEBES contarle lo más atractivo del club: ubicación (ej. Cañón de Arizona está en Alvarado, Tolima, a 15 min de Ibagué, clima cálido de 26 °C), concepto (Bungalow Luxury Club para descanso familiar o rentas vacacionales), terrenos amplios (usa las áreas disponibles del inventario que te indica el sistema) y amenidades principales (piscinas con playa en arena, pool bar, senderos, zonas deportivas y bienestar).\n` +
          `  * Envía el brochure oficial con enviar_portafolio para que lo explore visualmente.\n` +
          `  * ESTRICTAMENTE PROHIBIDO enviar el plano (enviar_plano) en este momento ni enviar plano y brochure juntos en el mismo turno. El plano solo se envía cuando el cliente pida explícitamente ver el plano o acepte verlo.\n` +
          `  * Cierra con una pregunta consultiva: pregúntale si desea profundizar en alguna amenidad o si le gustaría pasar a revisar el plano de disponibilidad y los terrenos.\n` +
          `4. CLUBES, UBICACIONES EXACTAS Y ENLACES OFICIALES DE GOOGLE MAPS:\n` +
          `- Los únicos clubes de campo de Grupo Constructor Meraki y sus enlaces oficiales en Google Maps son:\n` +
          `  * Cañón de Arizona Bungalow Luxury Club: ubicado en Alvarado, Tolima (KM 26.80 Vía Alvarado-Ibagué, a 15 min de Ibagué y ~3 h de Bogotá). Enlace Google Maps: https://maps.app.goo.gl/T6bfeune2pJFmbod8\n` +
          `  * Ciudad Country Laguna Mar (Melgar / Ricaurte, Tolima/Cundinamarca): Etapas Mar Santorini (300 m²) y Mar Canarias (300 a 2.500 m²). A solo 2 h de Bogotá y 10 min de Girardot. La sala de ventas está en el mismo club. Enlace Google Maps: https://maps.app.goo.gl/w6wHG4Quzkz8oHwi9\n` +
          `  * Llano Grande Luxury Living Club: ubicado en Alvarado, Tolima (a 15 min de Ibagué). Enlace Google Maps: https://maps.app.goo.gl/YvuimUVd2kE9XXJW8\n` +
          `  * Sobre Montañas: ubicado en sector montañoso de Alvarado, Tolima (ideal para glamping y descanso en naturaleza). Enlace Google Maps: https://maps.app.goo.gl/yeMfadmE8cgjYjwS9\n` +
          `  * Río Claro Luxury Living Club: ubicado en Mariquita, Tolima (a 3 h de Bogotá). La sala de ventas está en el mismo club. Enlace Google Maps: https://maps.app.goo.gl/mswWohUEY4C3LbVb7\n` +
          `- SALAS DE VENTAS OFICIALES MERAKI:\n` +
          `  * Sala de Ventas Ibagué (Oficina principal): Carrera 3 # 42–92 Barrio Casa Club, Ibagué – Tolima. Enlace Google Maps: https://maps.app.goo.gl/WxzdfCpUo3GN8KVX9\n` +
          `  * Salas de Ventas Melgar y Mariquita: ubicadas directamente dentro de cada club de campo (Laguna Mar y Río Claro).\n` +
          `- REGLA ESTRICTA DE UBICACIÓN Y MAPAS: Si el cliente pregunta dónde queda un club o sala de ventas, cómo llegar, pide la ubicación exacta, mapa o Waze, dale una explicación clara del acceso/tiempo y COMPARTE SIEMPRE EL ENLACE EXACTO de Google Maps correspondiente para que el cliente pueda abrirlo y guiarse en su GPS con un solo toque.\n` +
          `- PROHIBIDO inventar clubes o ubicaciones inexistentes (como Tubará, Barranquilla u otras ajenas a Meraki).\n` +
          `- PROHIBIDO inventar amenidades, áreas o prometer rentabilidades o valorización fija sin soporte.\n` +
          `5. PROPUESTA DE VALOR Y MOTIVACIÓN DEL COMPRADOR:\n` +
          `- Indaga de manera cálida y natural su motivación de compra: ¿descanso familiar de fin de semana, segunda vivienda o inversión para rentas vacacionales?\n` +
          `- Selecciona amenidades relevantes según su motivación y explica sus beneficios (sin listas excesivas tipo catálogo).\n` +
          `6. PLANO Y COTIZACIÓN (FLUJO COMERCIAL CORRECTO):\n` +
          `- Si el cliente pide directamente el plano, envíalo de inmediato con enviar_plano.\n` +
          `- Si el cliente elige un terreno o pide cotización pero NO ha indicado la forma de pago: NO le preguntes la forma de pago. Llama enviar_cotizacion sin tipo_pago y el sistema lo cotiza a 40 meses.\n` +
          `  Si después pide contado o 20 o 30 meses, cotiza esa modalidad (el valor total es menor).\n` +
          `7. MEMORIA Y CERO PREGUNTAS REDUNDANTES:\n` +
          `- Victoria NUNCA debe volver a preguntar información que el cliente ya proporcionó.\n` +
          `- Si el cliente YA indicó que quiere cuotas/plazos (o mencionó meses), NO preguntes si prefiere contado o cuotas.\n` +
          `- Si el cliente solicita un plazo no autorizado (p. ej. 24 meses), indícale amablemente que las opciones son 20, 30 o 40 meses y pregúntale directamente cuál de esos tres plazos prefiere.\n` +
          `- Si el cliente elige un terreno y aún no ha indicado forma de pago: cotízalo de una vez (enviar_cotizacion sin tipo_pago, el sistema usa 40 meses). No preguntes contado o cuotas.\n` +
          `8. PROHIBICIÓN TOTAL DE PREGUNTAS ABIERTAS DE PLAZO (ANTI-BUCLE):\n` +
          `NUNCA preguntes "¿a cuántos meses le gustaría financiar?" ni dejes el plazo abierto.\n` +
          `9. MODALIDADES AUTORIZADAS: Exclusivamente contado, 20 meses, 30 meses y 40 meses.\n` +
          `10. PROTECCIÓN CONTRA DUPLICADOS Y CAMBIO DE MODALIDAD: Si el cliente ya recibió una cotización y solo dice "sí", "ese", "me gusta" o "listo", continúa la conversación hacia agendar llamada sin repetir la cotización. Si solicita cambiar de modalidad (ej. de contado a 20, 30 o 40 meses, o viceversa) o pide reenvío explícito, genera la nueva cotización con enviar_cotizacion.\n` +
          `11. MANEJO DE VISITAS AL TERRENO VS CITAS: Las citas automáticas de Victoria son con un asesor comercial, por llamada telefónica o por videollamada de Google Meet, como prefiera el cliente (si no dice, es llamada). Pasa la modalidad en agendar_cita; si después pide cambiarla, usa cambiar_modalidad_cita. Nunca digas "videollamada" si la cita es llamada, ni al revés. ` +
          `Si el cliente expresa que desea ir a visitar el club de campo, conocer los terrenos o ir el fin de semana: ` +
          `recíbelo con entusiasmo, pero aclara que las visitas en terreno las coordina directamente un asesor comercial para autorizar el ingreso en portería y acompañarlo en el recorrido; ` +
          `invítalo a agendar una llamada telefónica previa con el asesor para cuadrar la fecha y hora de su visita presencial.\n` +
          `12. MANEJO BLINDADO DE OBJECIONES JURÍDICAS (ESCRITURAS, LICENCIAS, FORMAS DE PAGO):\n` +
          `- Respuestas breves, directas, tranquilizadoras y SIN enviar enlaces de páginas web ni archivos de documentos por el chat.\n` +
          `- Si el cliente pregunta por escrituras:\n` +
          `  * Cañón de Arizona y Llano Grande: cuentan con escrituración individualizada; el cliente puede escriturar su terreno en cuanto termine de pagar la totalidad (Cañón de Arizona está actualmente con obras en construcción; Llano Grande ya está construido).\n` +
          `  * Laguna Mar y Río Claro: todavía no se pueden escriturar. Cuentan con predio mayor con certificado de tradición al día y licencia de parcelación aprobada; la escritura individual se firma en el plazo pactado en la promesa de compraventa, una vez el cliente termine de pagar y el terreno quede individualizado por desenglobe bajo el régimen de propiedad horizontal.\n` +
          `- Si el cliente pregunta por licencias o fiducia:\n` +
          `  * Todos nuestros clubes de campo cuentan con licencia de parcelación y urbanismo oficial aprobada.\n` +
          `  * La compra es directa con la constructora (contado o a plazos a 20, 30 o 40 meses) mediante promesa de compraventa formal. NO hables de intereses.\n` +
          `- Si el cliente pide ver los documentos o certificados:\n` +
          `  * PROHIBIDO enviar enlaces web o documentos por chat. Responde de forma concisa y profesional: dile que toda la documentación legal y licencias están al día y que en la llamada el asesor comercial se las comparte y revisa con él en detalle, e invítalo a agendar la llamada.\n` +
          `13. PROHIBICIÓN ESTRICTA DE BOMBARDERO DE PORTAFOLIOS (MÁXIMO 1 BROCHURE POR TURNO):\n` +
          `- Si el cliente pregunta de forma general o dice que quiere conocer varios o todos los clubes (ej. "quiero conocer los 3", "cuéntame de todos", "qué opciones hay"):\n` +
          `  * ESTÁ TOTALMENTE PROHIBIDO llamar enviar_portafolio múltiples veces en la misma respuesta para mandar una ráfaga de 4 o 5 PDFs.\n` +
          `  * En ese caso, debes HABLAR, explicar y resumir en audio o texto las diferencias principales de cada municipio o club de campo (Alvarado, Melgar y Mariquita), y como apoyo enviar ÚNICAMENTE el "PORTAFOLIO GENERAL MERAKI" (máximo 1 PDF).\n` +
          `  * NUNCA envíes los brochures individuales de todos los clubes al mismo tiempo; satura el chat y abruma al cliente.\n` +
          `14. ESTADO REAL DE LLANO GRANDE Y SERVICIOS PÚBLICOS:\n` +
          `- PROHIBIDO decir que Llano Grande tiene servicios "proyectados" o que "dependen del avance de las obras y condiciones de cada etapa".\n` +
          `- LLANO GRANDE YA ESTÁ CONSTRUIDO y terminado: el cliente puede escriturar y recibir su terreno en cuanto termine de pagar la totalidad.\n` +
          `- SERVICIOS PÚBLICOS DE NUESTROS CLUBES: cuentan con acueducto, planta de tratamiento de aguas residuales (PTAR) y energía eléctrica. NO digas alcantarillado. Si el cliente desea conocer detalles técnicos o documentales más específicos de la acometida o conexión, ofrécele agendar una llamada con un asesor comercial para revisarlo en detalle.\n` +
          `15. FORMATO DE TEXTO EN WHATSAPP (SIN DOBLE ASTERISCO):\n` +
          `- WhatsApp NO utiliza Markdown tradicional con doble asterisco (**texto**).\n` +
          `- Si vas a resaltar una palabra o nombre en negrilla, usa ÚNICAMENTE un solo asterisco por lado (*texto*).\n` +
          `- PROHIBIDO usar doble asterisco (**texto**), ya que en WhatsApp se rompe el formato y muestra asteriscos visibles desagradables por fuera.\n` +
          `16. IDENTIDAD: Eres la asistente virtual de Grupo Constructor Meraki. Nunca digas que eres asesora, una persona o parte del equipo humano. Si te preguntan, acláralo con naturalidad.\n` +
          `17. ALCANCE: Solo atiendes consultas de compra de terrenos. NUNCA te comprometas a reuniones presenciales, gestiones internas, firmas ni acciones de otras personas, y no des soporte de sistemas o de la plataforma. Si te piden algo de eso, di que un asesor le ayudará y ofrece la llamada.\n` +
          `20. NO RECONFIRMES: si el terreno ya quedó identificado (número y club o etapa), no vuelvas a preguntar "¿confirma que se refiere al terreno…?". Haz una sola pregunta por mensaje.\n` +
          `21. PREGUNTAS DE SÍ O NO: no cierres con preguntas de dos opciones ("¿prefiere A o B?"); haz una pregunta que se responda con sí o no. Si el lead responde "sí" a una pregunta de dos opciones, avanza con la que acerca a la cotización (enviar el plano o cotizar), y NUNCA repitas una descripción que ya diste.\n` +
          `18. VARIAS MODALIDADES: Si el lead pide cotizar el mismo terreno en dos modalidades (ej. contado y 30 meses), llama enviar_cotizacion una vez por cada modalidad.\n` +
          `19. SOBRE MONTAÑAS: ${sobreMontanasRule(config)} Para este club NO menciones 20, 30 ni 40 meses.`,
      });
    }
  }

  const aiTexts = history.filter((m) => m.direction === 'outbound' && m.senderType === 'ai').map((m) => m.content ?? '');
  const paymentAnswer = detectPaymentAnswer(aiTexts[aiTexts.length - 1] ?? '', userMessage);
  if (paymentAnswer) {
    messages.push({
      role: 'system',
      content:
        `El lead acaba de responder tu pregunta de forma de pago: eligió ${paymentAnswer.pago === 'contado' ? 'pago de contado' : `pago a plazos a ${paymentAnswer.meses} meses`}. ` +
        'Su mensaje es la forma de pago, NO un número de terreno. El terreno ya lo identificaste antes en la conversación: llama enviar_cotizacion ahora con ese terreno y esta forma de pago, sin volver a confirmar nada.',
    });
  } else if (countPaymentQuestions(aiTexts.slice(-4)) >= 2) {
    messages.push({
      role: 'system',
      content:
        'ANTI-BUCLE: ya preguntaste la forma de pago varias veces seguidas. NO repitas la misma pregunta ni vuelvas a pedir confirmación del terreno. ' +
        'Si con lo que dijo el lead ya sabes el terreno y la modalidad, cotiza; si de verdad falta algo, pregunta UNA sola cosa distinta y concreta, o ofrece que un asesor le envíe la cotización.',
    });
  }

  const activePlanoClub = clubKeyOf(recentPlano?.projectName);
  if (activePlanoClub) {
    messages.push({
      role: 'system',
      content:
        `PLANO ACTIVO: el último plano que le enviaste al lead es de ${CLUB_LABELS[activePlanoClub]}` +
        `${recentPlano?.stageName ? ` (${recentPlano.stageName})` : ''}. Si el lead menciona un número o un color, es un terreno de ` +
        `${CLUB_LABELS[activePlanoClub]}: ${planoColorGuide(activePlanoClub, recentPlano?.stageName)} ` +
        `NUNCA lo asignes a otro club ni le digas que pertenece a otro club, aunque ese color exista en otro club, salvo que el lead nombre otro club.`,
    });
  }

  if (freshLead.aiNoInterestAskedAt && !freshLead.aiNoInterest) {
    messages.push({
      role: 'system',
      content: 'Antes le preguntaste al cliente por qué no le interesa. Si en este mensaje da el motivo, llama registrar_no_interes ' +
        'con la categoría y el motivo en sus palabras, y sigue lo que te indique la herramienta. Si cambia de tema o vuelve a mostrar interés, ' +
        'responde normal. No vuelvas a preguntar el motivo.',
    });
  }

  if (justWelcomed) {
    messages.push({
      role: 'system',
      content: welcomeAskedMunicipio
        ? 'Acabas de enviar la bienvenida: ya te presentaste y preguntaste en qué municipio le gustaría invertir. NO vuelvas a saludar, a presentarte ni a repetir esa pregunta: responde directo a lo que pidió el lead y cierra con otra pregunta distinta.'
        : 'Acabas de saludar y presentarte por nota de voz, y le dijiste que ya le respondes por aquí. NO vuelvas a saludar ni a presentarte: empieza respondiendo directo y con calidez lo que preguntó el lead.',
    });
  }

  // Si en el mensaje anterior se le prometieron los precios, ahora se le dan.
  const lastAiForPrice = [...longHistory].reverse().find((m) => m.direction === 'outbound' && m.senderType === 'ai');
  if (lastAiForPrice?.content?.includes(PRICE_HOLD_MARK)) {
    messages.push({
      role: 'system',
      content: 'En tu mensaje anterior le dijiste al lead que con gusto le compartías los precios y le preguntaste su nombre y su ciudad. ' +
        'Ahora agradécele con su nombre si lo dio, dale los precios como indican tus instrucciones (precio desde, bonos y pago directo a 20, 30 o 40 meses) ' +
        'y, según la ciudad que diga, recomiéndale la zona más cercana. Cierra con una sola pregunta sobre el municipio o club que le interesa.',
    });
  }

  // "No gracias" a la cita no es un no al terreno: la primera vez se sigue conversando.
  //  Si vuelve a decir que no, o si el "no" es al club, se le pregunta el motivo una vez.
  const declineNow = usesConsultiveAgent(config) && detectsDeclineCue(userMessage);
  if (declineNow) {
    const lastAiText = [...longHistory].reverse().find((m) => m.direction === 'outbound' && m.senderType === 'ai' && !!m.content?.trim())?.content ?? '';
    if (lastAiOfferedCita(lastAiText) && !freshLead.aiCitaDeclinedAt && !freshLead.aiNoInterestAskedAt) {
      await leadsRepository.update(companyId, leadId, { aiCitaDeclinedAt: Timestamp.now() });
      messages.push({
        role: 'system',
        content: 'El lead le dijo que no a la CITA, no al terreno. NO te despidas ni registres no interés. Dile con amabilidad que no hay problema, ' +
          'sin compromiso, y hazle UNA sola pregunta para seguir asesorándolo: qué le pareció la cotización o el club, o si prefiere otro plazo, ' +
          'pago de contado u otro terreno. No vuelvas a ofrecer la cita en este mensaje.',
      });
    } else if (!/^NO( SENOR| SENORA)?$/.test(normKey(userMessage))) {
      // (un "no" suelto a otra pregunta, como ver el plano, lo maneja el modelo sin forzar el motivo)
      messages.push({
        role: 'system',
        content: inferNoInterestCategory([userMessage]) !== 'otro'
          ? `El lead ya dijo el motivo (${NO_INTEREST_LABELS[inferNoInterestCategory([userMessage])]}): NO se lo preguntes. Llama registrar_no_interes ` +
            'con esa categoría y sus palabras (definitivo=false) y ofrécele en el mismo mensaje UNA alternativa que resuelva ese motivo ' +
            '(si es precio o tamaño: terrenos de menor área de Mar Canarias o Sobre Montañas; si es ubicación: el club más cercano a su ciudad).'
          : freshLead.aiNoInterestAskedAt
          ? 'El lead está diciendo que no le interesa y ya le preguntaste el motivo. Llama registrar_no_interes con la categoría y el motivo en sus palabras (definitivo=true si no quiere continuar) y sigue lo que te indique la herramienta.'
          : 'El lead está diciendo que no le interesa o no quiere avanzar. Si no te ha dicho el motivo, pregúntaselo UNA sola vez, con amabilidad, antes de despedirte (sección 8b). ' +
            'Si ya dijo el motivo, llama registrar_no_interes. Nunca te despidas sin hacer una de las dos cosas.',
      });
      if (!freshLead.aiNoInterestAskedAt) await leadsRepository.update(companyId, leadId, { aiNoInterestAskedAt: Timestamp.now() });
    }
  }

  if (mentionsAreaNotLot(userMessage)) {
    messages.push({
      role: 'system',
      content: 'El lead habla de un ÁREA en metros cuadrados, no de un número de terreno: NO llames enviar_cotizacion con ese número. ' +
        'Dile qué club o etapa tiene terrenos de ese tamaño (según las áreas disponibles hoy) y ofrécele el plano para que elija uno de esa área y se lo cotices.',
    });
  }

  if (isForeignPhone(lead.phone)) {
    messages.push({
      role: 'system',
      content:
        `El lead escribe ${abroadPhrase(lead.phone)} (número de fuera de Colombia). En tu primera respuesta reconócelo con calidez ` +
        `(por ejemplo: "Qué bueno que nos escriba ${abroadPhrase(lead.phone)}"), sin preguntarle dónde vive. Cuando venga al caso, cuéntale que ` +
        'puede comprar desde allá: la firma de los documentos es electrónica, el pago es directo con la constructora y puede conocer el club ' +
        'sin viajar, con un recorrido por videollamada con un asesor. Su cita es por videollamada de Google Meet (salvo que pida una llamada).',
    });
  }

  // Cotización determinista: si ya se sabe el terreno (del plano) y la forma de pago y
  // aún no se cotizó, se cotiza sin depender del modelo. Antes la IA se quedaba
  // reconfirmando, decía "no aparece disponible" sin consultar o prometía enviarla.
  let forcedToolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall | null = null;
  if (config.quoteMode !== 'off' && activePlanoClub && activePlanoClub !== 'sobre-montañas') {
    const turns: ChatTurn[] = longHistory
      .filter((m) => (m.direction === 'inbound' && m.senderType === 'lead') || (m.direction === 'outbound' && m.senderType === 'ai'))
      .map((m) => ({
        from: (m.senderType === 'lead' ? 'lead' : 'ai') as ChatTurn['from'],
        text: m.content ?? '',
        origin: typeof m.metadata?.origin === 'string' ? m.metadata.origin : undefined,
        hasImage: String((m as { mediaType?: string }).mediaType ?? m.metadata?.mediaType ?? '').startsWith('image/'),
      }));
    const lastLead = [...longHistory].reverse().find((m) => m.direction === 'inbound' && m.senderType === 'lead');
    if (!lastLead || lastLead.id !== messageId) turns.push({ from: 'lead', text: userMessage });
    const quoteState = deriveQuoteState(turns);
    if (quoteState.terreno) {
      const lots = await loadProjectLots(activePlanoClub);
      const check = lots
        ? checkLotInInventory(lots, activePlanoClub, recentPlano?.stageName, quoteState.terreno, quoteState.color, quoteState.sectorHint)
        : null;
      if (check && quoteState.lotThisTurn) {
        messages.push({ role: 'system', content: lotCheckNote(check, quoteState.terreno, CLUB_LABELS[activePlanoClub]) });
      }
      const ready = !!quoteState.pago && !quoteState.quoted &&
        (quoteState.lotThisTurn || quoteState.paymentThisTurn || isShortFollowUp(userMessage));
      // Sin forma de pago: se cotiza igual (a 40 meses) apenas elige el terreno.
      const readyDefault = !quoteState.pago && !quoteState.quoted && quoteState.lotThisTurn && usesConsultiveAgent(config);
      if ((ready || readyDefault) && check?.kind === 'found' && check.available) {
        const sectorArg = activePlanoClub === 'llano-grande' ? 'Llano Grande' : quoteSectorArg(check.sector);
        forcedToolCall = {
          id: `forced_quote_${messageId}`,
          type: 'function',
          function: {
            name: 'enviar_cotizacion',
            arguments: JSON.stringify({
              sector: sectorArg,
              terreno: quoteState.terreno,
              ...(quoteState.pago ? { tipo_pago: quoteState.pago } : {}),
              ...(quoteState.pago === 'cuotas' && quoteState.meses ? { meses: quoteState.meses } : {}),
            }),
          },
        };
        logger.info('[AI] Terreno y forma de pago conocidos — se cotiza directo', {
          leadId, terreno: quoteState.terreno, sector: sectorArg, pago: quoteState.pago, meses: quoteState.meses,
        });
      }
    }
  }

  // Brochure determinista: la primera vez que el lead elige un municipio o club con
  // brochure, se envía (antes quedaba a criterio del modelo y a veces no lo mandaba).
  if (!forcedToolCall && !currentTurnHasImage && !asksAboutConstruction([userMessage])) {
    const club = brochureClubChoice(userMessage);
    const clubKey = clubKeyOf(club);
    const alreadyShown = longHistory.some((m) =>
      m.direction === 'outbound' && m.senderType === 'ai' &&
      (m.metadata?.origin === 'ai_portafolio' || m.metadata?.origin === 'ai_plano') &&
      clubKeyOf(String(m.metadata?.project ?? m.metadata?.projectName ?? m.metadata?.title ?? m.content ?? '')) === clubKey);
    if (club && clubKey && !alreadyShown) {
      forcedToolCall = {
        id: `forced_brochure_${messageId}`,
        type: 'function',
        function: { name: 'enviar_portafolio', arguments: JSON.stringify({ project: club }) },
      };
      logger.info('[AI] Club elegido por primera vez — se envía su brochure', { leadId, club });
    }
  }

  // SÍ a la plantilla de seguimiento: se le ofrecen de una vez los horarios con el asesor.
  if (!forcedToolCall && wantsAdvisorFromTemplate) {
    forcedToolCall = {
      id: `forced_horarios_${messageId}`,
      type: 'function',
      function: { name: 'consultar_horarios', arguments: '{}' },
    };
    logger.info('[AI] Respondió SÍ a la plantilla de seguimiento — se ofrecen horarios', { leadId });
  }

  // 6. Llamar a OpenAI con herramienta de agendamiento
  let aiReply: string;
  let appointmentScheduled = false; // true si en este turno se agendó/reagendó una cita
  let leadDeclined = false;         // true si el lead dijo que definitivamente no le interesa
  let fichasThisTurn = 0;
  if (detectsBudgetObjection(userMessage) && await recordAiFicha(companyId, leadId, {
    kind: 'objecion_presupuesto',
    result: 'El cliente planteó una objeción de precio o presupuesto',
    nextAction: 'Ofrecer plan de pagos, bono y terrenos de menor valor',
    notes: `Mensaje del cliente: "${userMessage.slice(0, 200)}"`,
    dedupeKey: 'objecion_presupuesto',
  })) fichasThisTurn += 1;
  let aiResponseMetadata: AiResponseMetadata | undefined;
  let aiFailed = false;
  let aiFailError = '';
  const usages: Array<ModelUsage | null | undefined> = [];
  try {
    logger.info('[AI] Llamando a OpenAI', { leadId, historyLength: history.length, hasMedia: !!mediaUrl });

    const toolsToUse = config.quoteMode !== 'off'
      ? [...APPOINTMENT_TOOLS, PORTAFOLIO_TOOL, AVANCE_OBRA_TOOL, NO_INTERES_TOOL, getCotizacionToolForCompany(config)]
      : [...APPOINTMENT_TOOLS, PORTAFOLIO_TOOL, AVANCE_OBRA_TOOL, NO_INTERES_TOOL];

    const runCompletion = async (forceQuote: boolean) => {
      const params = buildCompletionParamsForCompany(config, currentTurnHasImage, messages, toolsToUse);
      if (forceQuote) params.tool_choice = { type: 'function', function: { name: 'enviar_cotizacion' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getOpenAIClient().chat.completions.create(params as any);
    };
    // Si la IA acaba de preguntar la forma de pago de un terreno ya nombrado y el lead
    // respondió (p. ej. "30" o "de contado"), se fuerza la cotización: evita el bucle de
    // volver a preguntar. Las guardas de enviar_cotizacion siguen aplicando.
    const lastAiText = aiTexts[aiTexts.length - 1] ?? '';
    const forceByPayment = !forcedToolCall && !!paymentAnswer && config.quoteMode !== 'off' &&
      /\bterreno\s+(?:n[uú]mero\s+)?\d+/i.test(lastAiText);
    if (forceByPayment) {
      logger.info('[AI] Forma de pago respondida — se fuerza la cotización', { leadId, pago: paymentAnswer?.pago, meses: paymentAnswer?.meses });
    }

    let completion = forcedToolCall ? null : await runCompletion(forceByPayment);
    usages.push(completion?.usage);

    // Mientras el modelo respondía pudo llegar otro mensaje o tomar el chat un asesor.
    const [newest, currentLead] = await Promise.all([
      messagesRepository.getLatest(companyId, leadId),
      leadsRepository.findById(companyId, leadId),
    ]);
    const newerInbound = !!newest && newest.id !== messageId && newest.direction === 'inbound' && newest.senderType === 'lead';
    if (newerInbound || !currentLead?.aiEnabled) {
      logger.info('[AI] Respuesta descartada: mensaje más nuevo o asesor al mando', { leadId, messageId, newerInbound });
      await messagesRepository.markAiProcessed(companyId, leadId, messageId);
      return;
    }

    let choice = forcedToolCall
      ? ({ role: 'assistant', content: null, tool_calls: [forcedToolCall] } as unknown as OpenAI.Chat.Completions.ChatCompletionMessage)
      : completion?.choices[0]?.message;
    // La IA dijo que generaría/enviaría la cotización pero no llamó la herramienta: se fuerza una vez.
    if (!forcedToolCall && config.quoteMode !== 'off' && !(choice?.tool_calls?.length) && promisesQuote(choice?.content ?? '')) {
      logger.info('[AI] La IA prometió la cotización sin enviarla — se fuerza la herramienta', { leadId });
      completion = await runCompletion(true);
      usages.push(completion.usage);
      choice = completion.choices[0]?.message;
    }
    const toolCalls = choice?.tool_calls ?? [];
    if (completion?.choices[0]?.finish_reason === 'length') {
      logger.warn('[AI] ADVERTENCIA: Respuesta truncada por límite de tokens (finish_reason=length)', {
        companyId,
        leadId,
        completionTokens: completion?.usage?.completion_tokens,
      });
    }

    if (toolCalls.length > 0) {
      // La IA decidió agendar — ejecutar la(s) herramienta(s)
      messages.push(choice);
      let portfolioSentCount = 0;
      let directMessage: string | null = null;
      const asksConstructionThisTurn = toolCalls.some((c) => c.type === 'function' && c.function.name === 'consultar_avance_obra');
      for (const call of toolCalls) {
        // Si el asesor tomó el chat mientras la IA pensaba, no se envía nada más.
        if (!(await aiStillInControl(companyId, leadId))) {
          logger.info('[AI] El asesor tomó el chat durante el turno — se cancela la respuesta', { leadId });
          await messagesRepository.markAiProcessed(companyId, leadId, messageId);
          return;
        }
        const toolName = call.type === 'function' ? call.function.name : '';
        let result: unknown;
        if (toolName === 'enviar_portafolio' && asksConstructionThisTurn) {
          result = { ok: true, note: 'No se envió el brochure: en este turno el lead preguntó por el avance de obra. Ofrécelo después si le interesa.' };
        } else if (toolName === 'enviar_portafolio') {
          portfolioSentCount++;
          if (usesConsultiveAgent(config) && portfolioSentCount > 1) {
            // Prevenir ráfagas de múltiples PDFs en el mismo turno
            result = { ok: true, note: 'Solo se envía un portafolio por turno para no saturar al cliente.' };
          } else {
            result = await runPortfolioTool(companyId, leadId, lead, call, config);
          }
        } else if (toolName === 'consultar_avance_obra') {
          result = await runConstructionUpdateTool(companyId, leadId, call, userMessage);
        } else if (toolName === 'enviar_plano') {
          result = await runPlanoTool(companyId, leadId, lead, call);
        } else if (toolName === 'enviar_cotizacion') {
          result = await runCotizacionTool(companyId, leadId, lead, call, config, userMessage);
        } else if (toolName === 'consultar_horarios') {
          result = await runAvailabilityTool(companyId, leadId, lead, call);
        } else if (toolName === 'registrar_no_interes') {
          const r = await runNoInterestTool(companyId, leadId, lead, call);
          if (r.definitivo) leadDeclined = true;
          if (r.fichaRecorded) fichasThisTurn += 1;
          result = r;
        } else {
          result = await runAppointmentTool(companyId, leadId, call, config.businessName, userMessage);
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        if (await recordToolFicha(companyId, leadId, toolName, result)) fichasThisTurn += 1;
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
        const followUpParams = buildCompletionParamsForCompany(
          config,
          false,
          messages
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const followUp = await getOpenAIClient().chat.completions.create(followUpParams as any);
        usages.push(followUp.usage);
        if (followUp.choices[0]?.finish_reason === 'length') {
          logger.warn('[AI] ADVERTENCIA: Respuesta followUp truncada por límite de tokens (finish_reason=length)', {
            companyId,
            leadId,
            completionTokens: followUp.usage?.completion_tokens,
          });
        }
        aiReply = followUp.choices[0]?.message?.content?.trim() ?? config.fallbackMessage;
      }
    } else {
      aiReply = choice?.content?.trim() ?? config.fallbackMessage;
    }

    logger.info('[AI] Respuesta generada', {
      leadId, replyLength: aiReply.length, toolCalls: toolCalls.length,
      usoEntrada: completion?.usage?.prompt_tokens,
    });
  } catch (err) {
    logger.error('[AI] Error llamando a OpenAI', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    aiReply = config.fallbackMessage;
    aiFailed = true;
    aiFailError = err instanceof Error ? err.message : String(err);
  }

  await recordAiUsage(companyId, leadId, config.model || 'default', usages);

  // 6a. Si la IA se despidió de un lead que dijo que no y no registró el motivo, se registra igual
  //     (antes quedaban como "nuevo" leads que habían dicho "no gracias").
  if (!aiFailed && !leadDeclined && usesConsultiveAgent(config) && isFarewellReply(aiReply)) {
    const recentLeadTexts = [...longHistory]
      .filter((m) => m.direction === 'inbound' && m.senderType === 'lead')
      .slice(-3)
      .map((m) => m.content ?? '')
      .concat(userMessage);
    if (recentLeadTexts.some((t) => detectsDeclineCue(t))) {
      const reason = [...recentLeadTexts].reverse().find((t) => detectsDeclineCue(t)) ?? userMessage;
      const r = await runNoInterestTool(companyId, leadId, lead, {
        id: `auto_no_interes_${messageId}`,
        type: 'function',
        function: { name: 'registrar_no_interes', arguments: JSON.stringify({ categoria: inferNoInterestCategory(recentLeadTexts), motivo: reason, definitivo: true }) },
      });
      if (r.definitivo) leadDeclined = true;
      if (r.fichaRecorded) fichasThisTurn += 1;
      logger.info('[AI] La IA se despidió de un lead que dijo que no — se registró el no interés', { leadId });
    }
  }

  // 6b. Pausa natural: que la respuesta no llegue pegada a la bienvenida.
  if (welcomeDoneAtMs) await sleep(Math.max(0, 4000 - (Date.now() - welcomeDoneAtMs)));

  // 6c. Si el lead escribió otra vez mientras se preparaba esta respuesta, no se envía:
  //     el mensaje más nuevo responde con los dos en contexto (evita la doble respuesta).
  if (!aiFailed && await newerLeadMessageArrived(companyId, leadId, messageId)) {
    logger.info('[AI] Llegó un mensaje más nuevo del lead — se descarta esta respuesta', { leadId, messageId });
    await messagesRepository.markAiProcessed(companyId, leadId, messageId);
    return;
  }

  // 7. Guardar respuesta IA + enviar por el canal del lead (en audio si el lead envió audio)
  const aiSentAt = await saveAndSendAiResponse(
    companyId,
    leadId,
    lead,
    aiReply,
    aiResponseMetadata,
    wasVoiceInbound && isVoiceEnabled(config)
  );

  // 7b. Actualizar el contador de la guarda de costo (ventana horaria).
  await leadsRepository.update(companyId, leadId, {
    aiHourlyCount:       priorCount + 1,
    aiHourlyWindowStart: windowActive
      ? (freshLead.aiHourlyWindowStart ?? Timestamp.fromMillis(nowMs))
      : Timestamp.fromMillis(nowMs),
  });

  // 8. Marcar mensaje original como procesado (idempotencia)
  await messagesRepository.markAiProcessed(companyId, leadId, messageId);

  // 8b. La IA no pudo responder (OpenAI caído, sin saldo, error): el cliente ya recibió el
  //     mensaje de respaldo; se pausa la IA en este chat y se avisa al asesor para que siga él.
  if (aiFailed) {
    await bumpAiDaily(companyId, { fallos: 1 });
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      ...humanHandoffPatch(freshLead),
    });
    await messagesRepository.create({
      companyId,
      leadId,
      direction: 'outbound',
      senderType: 'system',
      content: 'IA pausada: no pudo responder por un error técnico. El asesor continúa la conversación.',
      channel: 'whatsapp',
      status: 'sent',
      createdAt: Timestamp.now(),
    });
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    await sendAdvisorPush(companyId, lead.assignedTo, {
      title: `La IA no pudo responder a ${lead.name?.trim() || lead.phone || 'un lead'}`,
      body:  'Se pausó la IA en este chat. Respóndele tú.',
      url:   `/dashboard/inbox?lead=${leadId}`,
      type:  'lead-attention',
      leadId,
    }).catch(() => { /* best-effort */ });
    await sendAiFailureAlert(companyId, lead, aiFailError);
    return;
  }

  // 9. Follow-ups. Si en este turno se agendó/reagendó una cita, es un cierre
  //    positivo: cancelamos los follow-ups pendientes y NO programamos más
  //    (evita el "¿necesitas algo más?" redundante tras confirmar la cita).
  //    Los recordatorios de la cita los maneja processReminders por aparte.
  if (appointmentScheduled) {
    const when = await nextAppointmentLabel(companyId, leadId, env.calendarTimeZone());
    if (await recordAiFicha(companyId, leadId, {
      kind: 'cita',
      result: `La IA agendó una cita con el asesor${when ? ` para el ${when}` : ''}`,
      nextAction: 'Cita comercial con el asesor (ver modalidad en la cita)',
      dedupeKey: `cita:${when}`,
    })) fichasThisTurn += 1;
  }
  // Con cada ficha nueva se recalcula el análisis IA (puntaje, temperatura, presupuesto).
  if (fichasThisTurn > 0) await refreshLeadAnalysis(companyId, leadId);

  if (leadDeclined) {
    await followUpsRepository.cancelPendingForLead(companyId, leadId);
    await leadsRepository.update(companyId, leadId, {
      aiEnabled: false,
      aiDisabledAt: Timestamp.now(),
      aiRejectedAt: Timestamp.now(),
      ...humanHandoffPatch(freshLead),
    });
    logger.info('[AI] El lead no quiere continuar — IA pausada sin seguimientos', { leadId });
  } else if (appointmentScheduled) {
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
        'La cita puede ser por llamada telefónica o por videollamada de Google Meet, como prefiera el lead.',
      parameters: {
        type: 'object',
        properties: {
          fecha_hora_iso: {
            type: 'string',
            description: 'Fecha y hora de inicio en ISO 8601 con offset de Colombia, ej: 2026-06-20T15:00:00-05:00',
          },
          duracion_minutos: { type: 'number', description: 'Duración en minutos (default 30).' },
          modalidad: {
            type: 'string',
            enum: ['llamada', 'videollamada'],
            description: 'llamada = el asesor lo llama por teléfono; videollamada = Google Meet. Si el lead no lo dijo, usa "llamada".',
          },
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
          modalidad: {
            type: 'string',
            enum: ['llamada', 'videollamada'],
            description: 'Solo si el lead pidió cambiarla; si no, se conserva la de la cita anterior.',
          },
        },
        required: ['nueva_fecha_hora_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cambiar_modalidad_cita',
      description:
        'Cambia SOLO la modalidad de la cita ya agendada (llamada telefónica ↔ videollamada por Google Meet), sin mover la fecha ni la hora. ' +
        'Úsala cuando el lead diga, por ejemplo, "mejor por Meet" o "prefiero que me llamen".',
      parameters: {
        type: 'object',
        properties: {
          modalidad: { type: 'string', enum: ['llamada', 'videollamada'] },
        },
        required: ['modalidad'],
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

const NO_INTERES_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'registrar_no_interes',
    description:
      'Registra por qué el lead no está interesado. Úsala cuando el lead diga el motivo por el que no le interesa o no quiere avanzar ' +
      '(precio, ubicación, ya compró en otro lado, no es el momento, etc.). No envía nada al lead. ' +
      'definitivo=false si el motivo tiene solución y le vas a ofrecer una alternativa; definitivo=true si no quiere continuar.',
    parameters: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          enum: ['precio', 'ubicacion', 'competencia', 'tiempo', 'no_califica', 'atencion', 'otro'],
          description: 'precio = caro o no le alcanza; ubicacion = la zona no le sirve; competencia = compró o prefiere otra opción; ' +
            'tiempo = no es el momento; no_califica = no busca comprar un terreno; atencion = está molesto con la atención; otro = cualquier otro.',
        },
        motivo: { type: 'string', description: 'El motivo en palabras del lead, corto.' },
        definitivo: { type: 'boolean', description: 'true si no quiere continuar; false si le ofrecerás una alternativa.' },
      },
      required: ['categoria', 'motivo', 'definitivo'],
    },
  },
};

/** Guarda el motivo de no interés; si es definitivo, deja la ficha de desistimiento y avisa al asesor. */
async function runNoInterestTool(
  companyId: string,
  leadId: string,
  lead: Pick<Lead, 'name' | 'phone' | 'assignedTo'>,
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
): Promise<{ ok: boolean; definitivo?: boolean; fichaRecorded?: boolean; mensaje?: string; error?: string }> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };
  let args: { categoria?: string; motivo?: string; definitivo?: boolean } = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* argumentos inválidos */ }
  const categoria = args.categoria && NO_INTEREST_LABELS[args.categoria] ? args.categoria : 'otro';
  const label = NO_INTEREST_LABELS[categoria];
  const motivo = String(args.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const definitivo = args.definitivo === true;
  await leadsRepository.update(companyId, leadId, {
    aiNoInterest: { category: categoria, reason: motivo, definitive: definitivo, at: Timestamp.now() },
  });
  await bumpAiDaily(companyId, { [`noInteres.${categoria}`]: 1 });
  logger.info('[AI] Motivo de no interés registrado', { leadId, categoria, definitivo });
  if (!definitivo) {
    const objection = categoria === 'precio'
      ? await recordAiFicha(companyId, leadId, {
          kind: 'objecion_presupuesto',
          result: 'El cliente planteó una objeción de precio o presupuesto',
          nextAction: 'Ofrecer plan de pagos, bono y terrenos de menor valor',
          notes: motivo ? `En palabras del cliente: "${motivo}"` : undefined,
          dedupeKey: 'objecion_presupuesto',
        })
      : false;
    return {
      ok: true, definitivo: false, fichaRecorded: objection,
      mensaje: 'Registrado. Ofrécele UNA alternativa que resuelva ese motivo (sección "Cuando dice que no le interesa") y termina con una sola pregunta. ' +
        'Si la rechaza, llama registrar_no_interes con definitivo=true.',
    };
  }
  const fichaRecorded = await recordAiFicha(companyId, leadId, {
    kind: 'desistimiento',
    result: `No le interesa. Motivo: ${label}`,
    pipelineStage: categoria === 'precio' ? 'no_interesado_dinero'
      : categoria === 'ubicacion' ? 'no_interesado_ubicacion'
      : categoria === 'no_califica' ? 'no_interesado_otra'
      : undefined,
    nextAction: 'Sin seguimiento; el asesor decide si retoma',
    notes: motivo ? `En palabras del cliente: "${motivo}"` : undefined,
    dedupeKey: 'desistimiento',
  });
  await sendAdvisorPush(companyId, lead.assignedTo, {
    title: `${lead.name?.trim() || lead.phone || 'Un lead'} no quiere continuar`,
    body:  `Motivo: ${label}${motivo ? ` — "${motivo.slice(0, 120)}"` : ''}. La IA se despidió y se pausó.`,
    url:   `/dashboard/inbox?lead=${leadId}`,
    type:  'lead-attention',
    leadId,
  }).catch(() => { /* best-effort */ });
  return {
    ok: true, definitivo: true, fichaRecorded,
    mensaje: 'Registrado. Agradece, deja la puerta abierta y despídete en una o dos frases, de usted. No ofrezcas nada más ni hagas preguntas.',
  };
}

const AVANCE_OBRA_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'consultar_avance_obra',
    description:
      'Consulta los informes de avance de obra del último mes de un club (o de todos) para que le cuentes al lead, en pocas frases, cómo van las obras, y le compartas el enlace con el detalle y las fotos. ' +
      'Úsala SOLO cuando el lead pregunte cómo va la obra, el avance o la construcción. No envía nada al lead. ' +
      'Hay informes de Cañón de Arizona, Laguna Mar y Río Claro.',
    parameters: {
      type: 'object',
      properties: {
        club: { type: 'string', description: 'Club de campo: "Cañón de Arizona", "Laguna Mar", "Río Claro", "Llano Grande", "Sobre Montañas" o "todos".' },
      },
      required: ['club'],
    },
  },
};

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
            'Proyecto/club del portafolio: "PORTAFOLIO GENERAL MERAKI", "Cañón de Arizona", "Laguna Mar", "Río Claro", "Llano Grande" o "Sobre Montañas". Si el lead solo dijo el municipio, usa "Melgar", "Mariquita" o "Alvarado".',
        },
      },
      required: ['project'],
    },
  },
};

// Herramienta de cotización — solo se ofrece cuando quoteMode !== 'off' (ver más abajo).
export const COTIZACION_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'enviar_cotizacion',
    description:
      'Envía al lead, por WhatsApp, la IMAGEN de una cotización de un terreno específico. ' +
      'Úsala cuando el lead ya eligió un terreno (número + sector) y quieres darle el precio. ' +
      'ANTES de llamarla, pregunta si el pago es de contado o en cuotas; si es en cuotas, pregunta a cuántos meses. ' +
      'Excepción: si ya enviaste cotización de ese mismo terreno, NUNCA la llames otra vez salvo que el lead pida explícitamente recotizar/cambiar plazo o aplicar un bono ganado. Si el lead dice "sí", "si eso", "agendemos", o da una fecha/hora, NO uses enviar_cotizacion: usa consultar_horarios o agendar_cita. Si el lead adjunta una imagen nueva, la imagen nueva tiene prioridad sobre la cotización anterior. ' +
      'No inventes precios: esta herramienta calcula el valor real y envía la imagen.',
    parameters: {
      type: 'object',
      properties: {
        sector: {
          type: 'string',
          description:
            'El SECTOR o ETAPA exacto donde está el terreno. NO es el nombre del club de campo (única excepción: en Llano Grande pasa "Llano Grande" y el sistema identifica el sector): un club ' +
            'tiene varios sectores. Mapa club → sectores válidos: ' +
            'Cañón de Arizona → Texas, Colorado, Las Vegas, Los Angeles, San Francisco. ' +
            'Río Claro → Lagunilla, Medina. Llano Grande → Valle de Aburrá o San Antonio; si el lead no dijo cuál, pasa "Llano Grande" y el sistema lo identifica por el número. ' +
            'Laguna Mar → Mar Santorini, Mar Canarias. Sobre Montañas → sector "Sobre Montañas" y terreno = número o nombre de la aldea (1 a 17); sus plazos son 12, 18 o 24 meses. ' +
            'Pasa el sector tal como lo nombró el lead, p. ej. "Las Vegas", "Texas", "Mar Santorini", "Valle de Aburrá".',
        },
        terreno: { type: 'string', description: 'Número del terreno EXACTAMENTE como lo dijo el lead. NUNCA inventes un número: si el lead no ha dicho uno, NO llames esta herramienta (ofrécele el plano).' },
        tipo_pago: {
          type: 'string',
          enum: ['contado', 'cuotas'],
          description: 'Forma de pago elegida por el lead. Omítela si el lead no la ha dicho (el sistema cotiza a 40 meses).',
        },
        meses: { type: 'number', description: 'Solo si tipo_pago = cuotas: número de meses (plazo).' },
        bono_ganado: {
          type: 'number',
          description:
            'Solo si el lead dice que YA jugó y GANÓ un bono en puertabono: el monto ganado en COP ' +
            '(p. ej. 50000000 si dijo "gané 50 millones"). Si viene, se usa ese bono en vez del bono base.',
        },
      },
      required: ['sector', 'terreno'],
    },
  },
};

export const COTIZACION_TOOL_DEMO: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'enviar_cotizacion',
    description:
      'Envía al lead, por WhatsApp, la IMAGEN oficial de una cotización de un terreno específico. ' +
      'Úsala EXCLUSIVAMENTE cuando el lead ya eligió un terreno (número + sector) y solicita conocer su valor específico o propuesta de pago. ' +
      'Modalidades comerciales autorizadas: pago de contado, 20 meses, 30 meses o 40 meses. ' +
      'Si el lead aún no dio la forma de pago, NO la preguntes: llama la herramienta sin tipo_pago y el sistema cotiza a 40 meses (la cuota más cómoda; 24 en Sobre Montañas). ' +
      'Si ya la dio (aunque haya sido para otro terreno), cotiza de una vez: no la vuelvas a preguntar ni reconfirmes el terreno. ' +
      'PROHIBIDO llamarla ante consultas generales de precios (las consultas generales se responden con el precio "desde" vigente y las modalidades de pago). ' +
      'Si ya enviaste la cotización y el lead solo responde "sí", "ese", "me gusta", "listo" o confirma cita, NO la vuelvas a llamar salvo que pida cambiar de modalidad (ej. cambiar a 20, 30 o 40 meses) o pida reenvío explícito.',
    parameters: {
      type: 'object',
      properties: {
        sector: {
          type: 'string',
          description:
            'El SECTOR o ETAPA exacto donde está el terreno. NO es el nombre del club de campo (única excepción: en Llano Grande pasa "Llano Grande" y el sistema identifica el sector): un club ' +
            'tiene varios sectores. Mapa club → sectores válidos: ' +
            'Cañón de Arizona → Texas, Colorado, Las Vegas, Los Angeles, San Francisco. ' +
            'Río Claro → Lagunilla, Medina. Llano Grande → Valle de Aburrá o San Antonio; si el lead no dijo cuál, pasa "Llano Grande" y el sistema lo identifica por el número. ' +
            'Laguna Mar → Mar Santorini, Mar Canarias. Sobre Montañas → sector "Sobre Montañas" y terreno = número o nombre de la aldea (1 a 17); sus plazos son 12, 18 o 24 meses. ' +
            'Pasa el sector tal como lo nombró el lead, p. ej. "Las Vegas", "Texas", "Mar Santorini", "Valle de Aburrá".',
        },
        terreno: { type: 'string', description: 'Número del terreno EXACTAMENTE como lo dijo el lead. NUNCA inventes un número: si el lead no ha dicho uno, NO llames esta herramienta (ofrécele el plano).' },
        tipo_pago: {
          type: 'string',
          enum: ['contado', 'cuotas'],
          description: 'Forma de pago elegida por el lead. Omítela si el lead no la ha dicho (el sistema cotiza a 40 meses).',
        },
        meses: {
          type: 'number',
          enum: [20, 30, 40, 12, 18, 24],
          description: 'Solo si tipo_pago = cuotas: 20, 30 o 40 meses; en Sobre Montañas exclusivamente 12, 18 o 24 meses.',
        },
        bono_ganado: {
          type: 'number',
          description:
            'Solo si el lead dice que YA jugó y GANÓ un bono en puertabono: el monto ganado en COP ' +
            '(p. ej. 50000000 si dijo "gané 50 millones"). Si viene, se usa ese bono en vez del bono base.',
        },
      },
      required: ['sector', 'terreno'],
    },
  },
};

export function getCotizacionToolForCompany(config: Pick<AiConfig, 'agentProfile'>): OpenAI.Chat.Completions.ChatCompletionTool {
  return usesConsultiveAgent(config) ? COTIZACION_TOOL_DEMO : COTIZACION_TOOL;
}

/**
 * Evita cotizar con una forma de pago que el lead no dijo (p. ej. decir "financiado" y
 * que el modelo elija 20 meses por su cuenta).
 */
export function leadChosePaymentTerm(leadTexts: string[], pago: string, meses?: number): boolean {
  const text = normKey(leadTexts.join(' '));
  if (/\bTODAS? (LAS |LOS )?(OPCIONES|MODALIDADES|FORMAS|PLAZOS|ALTERNATIVAS)\b|\b(CONTADO|EFECTIVO) Y (A |EN )?(PLAZOS|CUOTAS)\b|\b(PLAZOS|CUOTAS) Y (DE )?CONTADO\b|\bTODAS\b/.test(text)) return true;
  if (pago === 'cuotas') {
    if (!meses) return true;
    const words: Record<number, string> = { 12: 'DOCE', 18: 'DIECIOCHO', 20: 'VEINTE', 24: 'VEINTICUATRO', 30: 'TREINTA', 40: 'CUARENTA' };
    return new RegExp(`\\b(${meses}${words[meses] ? `|${words[meses]}` : ''})\\b`).test(text);
  }
  return /\b(CONTADO|EFECTIVO|UN SOLO PAGO)\b/.test(text);
}

/** ¿El lead mencionó alguna forma de pago o plazo (aunque no sea uno autorizado)? */
export function leadMentionedPaymentTerm(leadTexts: string[]): boolean {
  const text = normKey(leadTexts.join(' '));
  return /\b(CONTADO|EFECTIVO|UN SOLO PAGO|CREDITO|\d{1,2} ?(MESES|CUOTAS)|(DOCE|DIECIOCHO|VEINTE|VEINTICUATRO|TREINTA|TREINTA Y SEIS|CUARENTA) (MESES|CUOTAS))\b/.test(text);
}

export function validateQuotationModalities(
  config: Pick<AiConfig, 'agentProfile'>,
  pago: string,
  meses?: number
): { ok: boolean; reason?: string; mensaje?: string } {
  if (!usesConsultiveAgent(config)) {
    if (pago === 'cuotas' && (!meses || meses < 1)) {
      return {
        ok: false,
        reason: 'falta_meses',
        mensaje: 'Para cotizar en cuotas necesito el número de meses. Pregúntale al lead a cuántos meses quiere el plan.',
      };
    }
    return { ok: true };
  }

  // Reglas estrictas del perfil consultivo:
  if (!pago || (pago !== 'contado' && pago !== 'cuotas' && pago !== 'efectivo')) {
    return {
      ok: false,
      reason: 'falta_tipo_pago',
      mensaje: 'Falta la forma de pago. Pregúntale al lead con las opciones autorizadas: "¿Prefiere pago de contado o pago a plazos? Si elige cuotas, ¿a cuántos meses le gustaría el plan de pago: 20, 30 o 40 meses?". NUNCA envíes cotización de contado por defecto sin que el lead lo haya solicitado.',
    };
  }

  if (pago === 'cuotas') {
    if (!meses) {
      return {
        ok: false,
        reason: 'falta_meses',
        mensaje: 'En nuestras formas de pago a plazos manejamos opciones a 20, 30 o 40 meses. Pregúntale al lead cuál de estas tres modalidades prefiere.',
      };
    }
    if (![20, 30, 40].includes(meses)) {
      return {
        ok: false,
        reason: 'plazo_no_autorizado',
        mensaje: `Las únicas opciones de pago a plazos autorizadas son 20, 30 o 40 meses (el plazo ${meses} meses no está autorizado). ` +
          `Explícale al lead con amabilidad que contamos con opciones de pago a plazos a 20, 30 y 40 meses, o pago de contado, y ofrécele la alternativa autorizada más cercana a su solicitud sin modificar automáticamente su elección.`,
      };
    }
  }
  return { ok: true };
}

export function buildCompletionParamsForCompany(
  config: AiConfig,
  currentTurnHasImage: boolean,
  messages: unknown[],
  tools?: unknown[]
): Record<string, unknown> {
  const customModel = config.model;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configuredMax = config.maxCompletionTokens || (config as any)?.maxTokens;
  const maxTokens = typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : 650;

  // El perfil consultivo usa GPT-5.6 Luna salvo que se configure 'gpt-4o-mini' como rollback
  const useLuna = usesConsultiveAgent(config) && customModel !== 'gpt-4o-mini';

  if (useLuna) {
    return {
      model: 'gpt-5.6-luna',
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'none',
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    };
  }

  // Perfil anterior, o rollback del consultivo
  return {
    model: currentTurnHasImage ? 'gpt-4o' : 'gpt-4o-mini',
    messages,
    max_tokens: 350,
    temperature: 0.7,
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
  };
}

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
  call:      OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  config:    AiConfig,
  userMessage: string = ''
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
  let terreno      = String(args.terreno ?? '').trim();
  if (/^\d+$/.test(terreno)) terreno = String(Number(terreno));
  // El terreno debe salir de lo que escribió (o dijo) el lead. Las cotizaciones deterministas
  // (forced_quote_) ya vienen del texto del lead o de la imagen del plano que él marcó.
  if (terreno && !call.id.startsWith('forced_quote_')) {
    const recentLead = (await messagesRepository.getRecent(companyId, leadId, 20))
      .filter((m) => m.direction === 'inbound' && m.senderType === 'lead')
      .slice(-6);
    const sentImage = recentLead.some((m) => String((m as { mediaType?: string }).mediaType ?? m.metadata?.mediaType ?? '').startsWith('image/'));
    const texts = [userMessage, ...recentLead.map((m) => `${m.content ?? ''} ${String(m.metadata?.transcription ?? '')}`)];
    if (!sentImage && !leadNamedLot(terreno, texts)) {
      logger.warn('[AI] Cotización frenada: el lead no nombró ese terreno', { leadId, terreno });
      return {
        ok: false,
        reason: 'terreno_no_indicado',
        mensaje: 'El lead NO ha dicho ningún número de terreno. No inventes uno ni digas que un terreno está vendido. ' +
          'Si pregunta precios, dale la referencia (desde cuánto, bonos y plazos) y ofrécele el plano para que elija un terreno y cotizárselo.',
      };
    }
  }
  const rawPago    = (args.tipo_pago ?? '').trim().toLowerCase();
  let pago         = rawPago === 'cuotas' ? 'cuotas' : rawPago === 'contado' ? 'efectivo' : rawPago;
  let meses        = args.meses;
  let defaultTerm  = false;
  const bonoGanado = Math.max(0, Number(args.bono_ganado) || 0);
  if (sector && terreno) {
    const recentForPlano = await messagesRepository.getRecent(companyId, leadId, QUOTE_STATE_WINDOW);
    const planoClub = clubKeyOf(latestAiPlano(recentForPlano)?.projectName);
    const sectorClub: ClubKey | null = isLlanoGrandeSector(sector)
      ? 'llano-grande'
      : sobreMontanasAldea(sector, terreno) !== null
        ? 'sobre-montañas'
        : (inventorySectorFor(sector)?.projectId as ClubKey | undefined) ?? null;
    const leadTextsForPlano = recentForPlano
      .filter((m) => m.direction === 'inbound' && m.senderType === 'lead')
      .slice(-3)
      .map((m) => m.content ?? '');
    const wrongClub = planoClubMismatch(planoClub, sectorClub, [userMessage, ...leadTextsForPlano], sector);
    if (wrongClub) {
      logger.info('[AI] Cotización frenada: sector de otro club distinto al plano enviado', { leadId, sector, planoClub: wrongClub });
      return {
        ok: false,
        reason: 'club_distinto_al_plano',
        mensaje:
          `El último plano que le enviaste es de ${CLUB_LABELS[wrongClub]}, así que el terreno ${terreno} es de ${CLUB_LABELS[wrongClub]}, no de otro club. ` +
          `Vuelve a cotizar con un sector de ${CLUB_LABELS[wrongClub]} (${planoColorGuide(wrongClub)}) y NO le digas al lead que es de otro club.`,
      };
    }
  }

  const aldea = sobreMontanasAldea(sector, terreno);
  // Sin forma de pago elegida: se cotiza de una vez al plazo más largo (la cuota más cómoda).
  // Si después pide menos meses o contado, el valor total baja en vez de subir.
  if (usesConsultiveAgent(config)) {
    const recentLeadTexts = (await messagesRepository.getRecent(companyId, leadId, 20))
      .filter((m) => m.direction === 'inbound' && m.senderType === 'lead')
      .slice(-8)
      .map((m) => m.content ?? '');
    const texts = [userMessage, ...recentLeadTexts];
    const chosen = !!pago && leadChosePaymentTerm(texts, pago, meses);
    if (!chosen && !leadMentionedPaymentTerm(texts)) {
      pago = 'cuotas';
      meses = aldea !== null ? 24 : 40;
      defaultTerm = true;
    }
  }
  if (aldea !== null) {
    if (!config.sobreMontanasQuotes) {
      logger.info('[AI] Cotización de Sobre Montañas bloqueada', { leadId, sector, terreno });
      return {
        ok: false,
        reason: 'sobre_montanas_no_cotizable',
        mensaje: `${sobreMontanasRule(config)} NO vuelvas a llamar enviar_cotizacion para este club.`,
      };
    }
    if (!aldea) {
      return { ok: false, reason: 'falta_aldea', mensaje: 'Pregúntale al lead cuál aldea de Sobre Montañas le interesa (de la 1 a la 17) o ofrécele el plano.' };
    }
    if (pago === 'cuotas' && ![12, 18, 24].includes(Number(meses))) {
      return {
        ok: false,
        reason: 'plazo_no_autorizado',
        mensaje: 'En Sobre Montañas los plazos son 12, 18 o 24 meses (no 20, 30 ni 40), o pago de contado. Pregúntale cuál prefiere sin cambiar su elección por tu cuenta.',
      };
    }
    const status = await sobreMontanasAldeaStatus(aldea);
    if (status && status !== 'DISPONIBLE') {
      return {
        ok: false,
        reason: 'no_disponible',
        mensaje: `La aldea ${aldea} (${aldeaName(aldea)}) de Sobre Montañas NO está disponible (estado: ${status}). Explícaselo con amabilidad e invítalo a elegir otra aldea.`,
      };
    }
    sector = 'Sobre Montañas';
    terreno = String(aldea);
  }
  if (aldea === null && sector && terreno) {
    if (isLlanoGrandeSector(sector)) {
      const llano = await loadProjectLots('llano-grande');
      if (llano) {
        const recent = await messagesRepository.getRecent(companyId, leadId, 20);
        const leadTexts = recent
          .filter((message) => message.direction === 'inbound' && message.senderType === 'lead')
          .slice(-8)
          .map((message) => message.content ?? '');
        const pick = pickLlanoGrandeSector(llano, terreno, namedLlanoGrandeSector([userMessage, ...leadTexts]));
        if (pick.kind === 'ask') {
          return {
            ok: false,
            reason: 'sector_ambiguo',
            mensaje: `El terreno ${terreno} de Llano Grande existe en Valle de Aburrá y en San Antonio. NO cotices aún: pregúntale al lead en cuál de los dos sectores está el terreno que marcó en el plano.`,
          };
        }
        if (pick.kind === 'none') {
          return {
            ok: false,
            reason: 'no_existe',
            mensaje: `No encuentro el terreno ${terreno} en Llano Grande. Pídele al lead que confirme el número que marcó en el plano.`,
          };
        }
        sector = pick.sector === 'SAN ANTONIO' ? 'San Antonio' : 'Valle de Aburrá';
      }
    }
    const target = inventorySectorFor(sector);
    if (target) {
      const lots = await loadProjectLots(target.projectId);
      const status = lots ? lotStatus(lots, target.sector, terreno) : null;
      if (status && status !== 'DISPONIBLE') {
        const label = sector === 'Sn.FRANCISCO' ? 'San Francisco' : sector;
        logger.info('[AI] Terreno no disponible según inventario — no se cotiza', { leadId, sector, terreno, status });
        return {
          ok: false,
          reason: 'no_disponible',
          mensaje: `El terreno ${terreno} del sector ${label} NO está disponible (estado: ${status}). Explícale al lead con amabilidad que ese terreno no se puede cotizar e invítalo a elegir otro del plano.`,
        };
      }
    }
  }
  if (!sector || !terreno) {
    return { ok: false, mensaje: 'Falta el terreno o el sector. Pregúntale al lead el número de terreno y en qué sector (p. ej. Texas, Las Vegas, Mar Santorini).' };
  }

  const sectorLabel = sector === 'Sn.FRANCISCO' ? 'San Francisco' : sector;

  // Validación de modalidades según el perfil del agente (Sobre Montañas ya se validó arriba)
  const modalityCheck = aldea ? { ok: true } : validateQuotationModalities(config, pago, meses);
  if (!modalityCheck.ok) {
    return modalityCheck;
  }

  if (usesConsultiveAgent(config)) {
    const recent = await messagesRepository.getRecent(companyId, leadId, 20);
    const leadTexts = recent
      .filter((message) => message.direction === 'inbound' && message.senderType === 'lead')
      .slice(-8)
      .map((message) => message.content ?? '');
    if (!defaultTerm && !leadChosePaymentTerm([userMessage, ...leadTexts], pago, meses)) {
      logger.info('[AI] Cotización frenada: el lead no eligió esa forma de pago', { leadId, pago, meses });
      return {
        ok: false,
        reason: 'forma_pago_no_elegida',
        mensaje:
          `El lead todavía no ha elegido esa forma de pago. NO cotices aún: pregúntale si prefiere pago de contado o a plazos de ${aldea ? '12, 18 o 24' : '20, 30 o 40'} meses.`,
      };
    }
  }

  const isExplicitResend = /\b(reenvia|reenviame|vuelve a enviar|otra vez|mandamela de nuevo|no me llego|no la veo|actualiza|actualizada)\b/i.test(userMessage);

  const quotationKey = quoteKey(sector, terreno, pago, meses, bonoGanado);
  const slot = await reserveQuotationSlot(companyId, leadId, quotationKey);
  if (slot.ok && slot.alreadySent && !isExplicitResend) {
    logger.info('[AI] Cotización idéntica ya enviada previamente — no se reenvía imagen', {
      leadId, sector, terreno, quotationKey,
    });
    return {
      ok: true,
      alreadySent: true,
      mensaje: `La cotización del terreno ${terreno} del sector ${sectorLabel} (${pago === 'cuotas' ? `${meses} cuotas` : 'contado'}) YA fue enviada al lead en esta conversación. NO vuelvas a llamar enviar_cotizacion ni envíes otra vez la imagen. Responde con naturalidad a lo que el lead dijo y guíalo hacia agendar la llamada para revisar las opciones y separar el terreno.`,
    };
  }
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
        'Dile con naturalidad: "Ya revisamos varias opciones para usted. Para darle información precisa y actualizada, ' +
        'mejor le ayudo a elegir entre esas alternativas o agendamos una llamada corta con un asesor para revisar disponibilidad en vivo."',
    };
  }

  // 1) Generar la imagen de cotización (endpoint headless de tour-meraki).
  //    El endpoint recibe el SECTOR en el parámetro `club` (así lo lee la ruta de impresión).
  let imageUrl: string;
  try {
    const qs = new URLSearchParams({ club: sector, terreno, pago });
    if (pago === 'cuotas' && meses) qs.set('meses', String(meses));
    // Bono: si el lead ganó uno en puertabono, usarlo (con tope); si no, el bono base.
    const bono = bonoGanado > 0 ? Math.min(bonoGanado, quoteBonusMax(config)) : quoteBonusBase(config);
    if (bono > 0) qs.set('bono', String(bono));
    const resp = await fetch(`${env.cotizadorUrl()}?${qs.toString()}`);
    const json = (await resp.json()) as { url?: string; error?: string; available?: boolean; status?: string };
    if (json?.available === false) {
      logger.info('[AI] Terreno no disponible — no se cotiza', { leadId, sector, terreno, status: json.status });
      await releaseQuotationSlot(companyId, leadId, quotationKey);
      return {
        ok: false,
        reason: 'no_disponible',
        mensaje: `El terreno ${terreno} del sector ${sectorLabel} NO está disponible (estado: ${json.status ?? 'no disponible'}). ` +
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

  await bumpAiDaily(companyId, { cotizaciones: 1 });
  logger.info('[AI] Cotización enviada', {
    leadId,
    sector,
    terreno,
    pago,
    bonoGanado: bonoGanado || null,
    meses: meses ?? null,
    quotationCount: slot.count,
  });
  const plazo = defaultTerm
    ? `a ${meses} meses, la opción con la cuota mensual más cómoda`
    : pago === 'cuotas' ? `en ${meses} cuotas` : 'de contado';
  const otherTerms = defaultTerm
    ? 'Si prefiere pagarlo en menos tiempo o de contado, el valor total es menor y con gusto se lo cotizo. '
    : '';
  const terrenoLabel = aldea
    ? `aldea ${terreno} (${aldeaName(aldea)}) de Sobre Montañas`
    : `terreno ${terreno} del sector ${sectorLabel}`;
  const confirmationMessage = bonoGanado > 0
    // Ya jugó y ganó: aplicar su bono, felicitar y NO volver a invitar a jugar.
    ? `¡Felicidades! 🎉 Le compartí la cotización del ${terrenoLabel} ${plazo} con su bono de ` +
      `${cop(Math.min(bonoGanado, quoteBonusMax(config)))} ya aplicado (en reemplazo del bono inicial). ` +
      `El bono queda sujeto a validación. ${otherTerms}Para separarlo, lo mejor es una llamada con un asesor. ` +
      `¿Le gustaría que la agendemos?`
    // Bono base de 20M: invitar a probar suerte para cambiarlo/mejorarlo por uno mayor (no acumulable).
    : `Le compartí la cotización del ${terrenoLabel} ${plazo}. Ya incluye un bono de ${cop(quoteBonusBase(config))} de descuento 🎁. ${otherTerms}` +
      `Y si quiere probar suerte jugando por un bono mayor, puede ingresar aquí: ${env.puertabonoUrl()} 🎟️ ` +
      `(el bono que saque reemplaza al inicial, no son acumulables). ` +
      `Para ver las opciones de pago y separarlo, lo mejor es una llamada con un asesor. ¿Le gustaría que la agendemos?`;
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

/** Ficha de la IA según la herramienta que se ejecutó con éxito en este turno. */
async function recordToolFicha(companyId: string, leadId: string, toolName: string, result: unknown): Promise<boolean> {
  const r = result as { ok?: boolean; alreadySent?: boolean; enviado?: string };
  if (!r?.ok || r.alreadySent || !r.enviado) return false;
  if (toolName === 'enviar_portafolio') {
    return recordAiFicha(companyId, leadId, {
      kind: 'envio_informacion', result: `Se envió el brochure: ${r.enviado}`,
      nextAction: 'Presentar el club y ofrecer el plano', dedupeKey: `brochure:${r.enviado}`,
    });
  }
  if (toolName === 'enviar_plano') {
    return recordAiFicha(companyId, leadId, {
      kind: 'envio_informacion', result: `Se enviaron planos y disponibilidad: ${r.enviado}`,
      nextAction: 'Elegir terreno y cotizar', dedupeKey: `plano:${r.enviado}`,
    });
  }
  if (toolName === 'enviar_cotizacion') {
    return recordAiFicha(companyId, leadId, {
      kind: 'cotizacion', result: `Se envió cotización formal: ${r.enviado}`,
      nextAction: 'Agendar llamada con el asesor para separar', dedupeKey: `cotizacion:${r.enviado}`,
    });
  }
  if (toolName === 'consultar_avance_obra') {
    return recordAiFicha(companyId, leadId, {
      kind: 'envio_informacion', result: `Se compartió el resumen del avance de obra: ${r.enviado}`,
      nextAction: 'Continuar asesoría', dedupeKey: `avance:${r.enviado}`,
    });
  }
  return false;
}

/**
 * Ejecuta consultar_avance_obra: devuelve al modelo los informes del último mes y el
 * enlace de la web, para que responda con un resumen breve. No envía mensajes ni fotos.
 */
async function runConstructionUpdateTool(
  companyId: string,
  leadId: string,
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  userMessage: string
): Promise<object> {
  if (call.type !== 'function') return { ok: false, error: 'herramienta desconocida' };
  let club = '';
  try {
    club = String(JSON.parse(call.function.arguments || '{}').club ?? '').trim();
  } catch { /* se pregunta abajo */ }

  const recent = await messagesRepository.getRecent(companyId, leadId, 10);
  const leadTexts = recent
    .filter((m) => m.direction === 'inbound' && m.senderType === 'lead')
    .slice(-2)
    .map((m) => m.content ?? '');
  if (!asksAboutConstruction([userMessage, ...leadTexts])) {
    return {
      ok: false,
      reason: 'no_pedido',
      mensaje: 'El lead no preguntó por el avance de obra. NO lo menciones: responde solo lo que preguntó.',
    };
  }

  const cut = (text: string) => summarizeUpdate(text, 900);
  if (/^(todos|todas|general|los proyectos|todos los proyectos)$/i.test(club.trim())) {
    const clubs = await Promise.all(CLUBS_WITH_UPDATES.map(async (c) => ({
      club: c.label,
      enlace: CLUB_PAGE_URLS[c.slug],
      informes: (await loadRecentConstructionUpdates(c.slug, 31, 2)).map((u) => ({ semana: u.date, texto: cut(u.text) })),
    })));
    return {
      ok: true,
      enviado: 'todos los clubes',
      clubes: clubs,
      mensaje:
        'Con estos informes del último mes, explica en UNA frase por club cómo van sus obras (Cañón de Arizona, Laguna Mar y Río Claro), sin copiar el texto. ' +
        'Aclara que Llano Grande ya está construido. Luego dile que puede ver el detalle con fotos en la página de cada club y pregúntale cuál le interesa para enviarle el enlace. ' +
        'NO inventes porcentajes ni fechas de entrega.',
    };
  }

  const target = resolveConstructionClub(club);
  if (!target) {
    return { ok: false, mensaje: 'No sé de qué club quiere el avance. Pregúntale cuál le interesa.' };
  }
  if (!target.slug) {
    return {
      ok: false,
      reason: 'sin_informes',
      mensaje: target.label === 'Llano Grande'
        ? 'Llano Grande ya está construido y terminado, por eso no tiene informes de avance de obra. Díselo con naturalidad.'
        : `No hay informes de obra publicados de ${target.label}. Dilo con naturalidad, sin inventar avances ni fechas, y ofrece que un asesor le cuente el estado actual.`,
    };
  }

  const updates = await loadRecentConstructionUpdates(target.slug, 31, 5);
  if (!updates.length) {
    return {
      ok: false,
      mensaje: `No pude consultar el avance de obra de ${target.label}. Discúlpate brevemente y comparte el enlace donde se publican los avances: ${CLUB_PAGE_URLS[target.slug]}`,
    };
  }
  logger.info('[AI] Avance de obra consultado', { leadId, slug: target.slug, informes: updates.length });
  return {
    ok: true,
    enviado: target.label,
    club: target.label,
    enlace: CLUB_PAGE_URLS[target.slug],
    informes: updates.map((u) => ({ semana: u.date, texto: cut(u.text) })),
    mensaje:
      `Con estos informes del último mes de ${target.label}, explica en 2 o 3 frases cortas cómo van las obras (qué frentes avanzaron), con tus palabras y sin copiar el texto. ` +
      `Después invítalo a ver el detalle con fotos en este enlace: ${CLUB_PAGE_URLS[target.slug]} . NO inventes porcentajes ni fechas de entrega y NO envíes brochure ni plano en este mensaje.`,
  };
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
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  config: AiConfig
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

  const request = resolvePortfolioRequest(project);
  if (request.kind === 'ask_club') {
    return {
      ok: false,
      reason: 'elegir_club',
      mensaje:
        `En ${request.municipality} hay brochure de ${request.options.join(' y de ')}. NO envíes ningún PDF todavía: ` +
        `pregúntale al lead por cuál de los dos está interesado y, cuando responda, llama enviar_portafolio con ese club.`,
    };
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
          `No hay brochure aprobado de "${project}" en la biblioteca. NO envíes el de otro club ni prometas enviarlo. ` +
          `Preséntalo con la información autorizada que tengas y ofrece el plano de disponibilidad o que un asesor amplíe la información.`,
      };
    }
    if (usesConsultiveAgent(config)) {
      return {
        ok: true,
        enviado: result.item?.title ?? project,
        mensaje:
          `El brochure/portafolio oficial de ${result.item?.project || project} fue enviado exitosamente al lead por WhatsApp. ` +
          `Ahora redacta tu respuesta con la voz de Victoria Sarmiento: presenta el club de campo destacando su ubicación, tamaño de terrenos campestres, concepto exclusivo y amenidades principales. Menciona con naturalidad que le compartiste el brochure para que vea fotos y detalles, y cierra con una pregunta consultiva preguntándole si desea conocer más sobre alguna amenidad o si prefiere revisar el plano de disponibilidad.`,
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
  lead:      Pick<Lead, 'assignedTo' | 'phone'>,
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
    confirmationMessage: isForeignPhone(lead.phone)
      ? `Tengo disponibles estos horarios para la videollamada:\n\n${lines}\n\n¿Cuál de estos horarios le queda mejor? Es por videollamada de Google Meet, así puede conocer el club sin viajar; si prefiere que el asesor le llame, dígamelo junto con el horario (por ejemplo: "1 por llamada").`
      : `Tengo disponibles estos horarios para la llamada:\n\n${lines}\n\n¿Cuál de estos horarios le queda mejor? El asesor le llama por teléfono; si prefiere videollamada por Google Meet, dígamelo junto con el horario (por ejemplo: "1 por Meet").`,
  };
}

export function resolveAvailabilitySelection(
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

  const numericChoice = normalizedMessage.match(/(?:^|\s)(?:opcion\s*)?(\d{1,2})(?!\s*de\s+[a-z]+)(?:\s|$)/);
  if (numericChoice) {
    const index = Number(numericChoice[1]);
    const slot = slots.find((item) => item.index === index);
    if (slot) return slot;
  }

  const requestedTime = extractRequestedLocalTime(normalizedMessage);
  if (!requestedTime) return null;

  let requestedDay: string | null = null;
  if (normalizedMessage.includes('manana')) {
    requestedDay = localYmd(new Date(Date.now() + 24 * 60 * 60 * 1000), timeZone);
  } else if (normalizedMessage.includes('hoy')) {
    requestedDay = localYmd(new Date(), timeZone);
  } else {
    const dateMatch = normalizedMessage.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
    if (dateMatch) {
      const dayNum = Number(dateMatch[1]);
      const monthNum = MONTH_BY_NAME[normalizeText(dateMatch[2])];
      if (monthNum) {
        const slotMatch = slots.find((s) => {
          const parts = localParts(new Date(s.iso), timeZone);
          const [, sM, sD] = parts.ymd.split('-').map(Number);
          return sM === monthNum && sD === dayNum;
        });
        if (slotMatch) {
          requestedDay = localParts(new Date(slotMatch.iso), timeZone).ymd;
        }
      }
    }
  }

  const matches = slots.filter((slot) => {
    const parts = localParts(new Date(slot.iso), timeZone);
    if (parts.hour !== requestedTime.hour || parts.minute !== requestedTime.minute) return false;
    return requestedDay ? parts.ymd === requestedDay : true;
  });

  return matches.length === 1 ? matches[0] : null;
}

const MONTH_BY_NAME: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function parseAvailabilitySlotsFromContent(content: string): AvailabilitySlotMetadata[] {
  const slots: AvailabilitySlotMetadata[] = [];
  const pattern = /(\d{1,2})\.\s*[^,\n]*,\s*(\d{1,2})\s+de\s+([a-zA-ZáéíóúñÁÉÍÓÚÑ]+)\s+de\s+(\d{4}),\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/gi;
  for (const match of content.matchAll(pattern)) {
    const index = Number(match[1]);
    const day = Number(match[2]);
    const month = MONTH_BY_NAME[normalizeText(match[3])];
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

export function extractRequestedLocalTime(text: string): { hour: number; minute: number } | null {
  // 1. Hora con prefijo 'a las / a la' o sufijo meridiano (am/pm) explícito
  let match = text.match(/(?:a\s+las?|a\s+la|alas?)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i);
  if (!match) {
    match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)/i);
  }
  if (!match) {
    // Si no tiene prefijo ni am/pm, limpiamos fechas como "9 de octubre" antes de buscar número
    const withoutDates = text.replace(/\b\d{1,2}\s+de\s+[a-z]+\b/gi, '');
    match = withoutDates.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i);
  }
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const marker = (match[3] ?? '').toLowerCase().replace(/[\s.]+/g, '');
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
      fecha_hora_iso?: string; nueva_fecha_hora_iso?: string; duracion_minutos?: number; modalidad?: string;
    };
    const requestedModality: AppointmentModality | undefined =
      args.modalidad === 'videollamada' || args.modalidad === 'llamada' ? args.modalidad : undefined;
    // Lo que diga el lead en su mensaje manda sobre lo que deduzca el modelo.
    let modality: AppointmentModality | undefined = detectAppointmentModality(userMessage) ?? requestedModality;
    // Número del exterior: la cita es por Meet salvo que el lead haya pedido una llamada.
    if (name === 'agendar_cita' && !detectAppointmentModality(userMessage)) {
      const leadDoc = await leadsRepository.findById(companyId, leadId);
      if (isForeignPhone(leadDoc?.phone)) {
        const recent = (await messagesRepository.getRecent(companyId, leadId, 12))
          .filter((m) => m.direction === 'inbound' && m.senderType === 'lead').map((m) => m.content ?? '');
        modality = leadPreferredModality(recent) ?? 'videollamada';
      }
    }

    // ── Cambiar solo la modalidad ─────────────────────────────────────────────
    if (name === 'cambiar_modalidad_cita') {
      if (!modality) return { ok: false, error: 'falta modalidad' };
      const updated = await changeAppointmentModality(companyId, leadId, modality);
      if (!updated) {
        return { ok: false, reason: 'sin_cita', mensaje: 'El lead no tiene una cita próxima. Ofrécele agendar una.' };
      }
      return {
        ok: true,
        mensaje: `Listo: la cita quedó como ${modalityLabel(modality)}. Confírmaselo en una frase corta` +
          (modality === 'videollamada' ? ' y dile que le enviaremos el enlace de Google Meet unos minutos antes.' : ' y dile que el asesor lo llamará a este número.'),
      };
    }

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
          companyId, leadId, startTime: start, durationMinutes: args.duracion_minutos, modality,
        });
        return {
          ok: true,
          scheduled: true,
          fecha: fmtDate(start),
          meet: appointment.googleMeetLink ?? null,
          confirmationMessage: buildReschedule(businessName, appointment.leadName, start, appointment.modality),
          mensaje: 'El lead ya tenía una cita; se movió al nuevo horario en vez de duplicarla.',
        };
      }

      const appt = await bookAppointment({
        companyId, leadId, startTime: start,
        durationMinutes: args.duracion_minutos, source: 'ai', modality: modality ?? 'llamada',
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appt.googleMeetLink ?? null,
        confirmationMessage: buildConfirmation(businessName, appt.leadName, start, appt.modality),
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
        companyId, leadId, startTime: start, durationMinutes: args.duracion_minutos, modality,
      });
      return {
        ok: true,
        scheduled: true,
        fecha: fmtDate(start),
        meet: appointment.googleMeetLink ?? null,
        confirmationMessage: hadPrevious
          ? buildReschedule(businessName, appointment.leadName, start, appointment.modality)
          : buildConfirmation(businessName, appointment.leadName, start, appointment.modality),
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

/** ¿Llegó un mensaje del lead posterior a este? (el último entrante del lead ya no es este). */
async function newerLeadMessageArrived(companyId: string, leadId: string, messageId: string): Promise<boolean> {
  const recent = await messagesRepository.getRecent(companyId, leadId, 15).catch(() => [] as Message[]);
  const lastLead = [...recent].reverse().find((m) => m.direction === 'inbound' && m.senderType === 'lead');
  return !!lastLead && lastLead.id !== messageId;
}

/** ¿La IA sigue a cargo del chat? false si un asesor lo tomó (aiEnabled apagado). */
async function aiStillInControl(companyId: string, leadId: string): Promise<boolean> {
  const current = await leadsRepository.findById(companyId, leadId).catch(() => null);
  return current?.aiEnabled !== false;
}

/** Guarda y envía la respuesta IA. Retorna el Timestamp del mensaje guardado. */
async function saveAndSendAiResponse(
  companyId: string,
  leadId:    string,
  lead:      Pick<Lead, 'phone' | 'inboxProvider' | 'channel' | 'externalId' | 'name' | 'assignedTo'>,
  rawContent: string,
  extraMetadata?: AiResponseMetadata,
  sendAsVoice?: boolean
): Promise<Timestamp> {
  // El asesor pudo tomar el chat mientras la IA preparaba la respuesta (nota de voz, herramientas):
  // en ese caso no se envía nada para no pisar su conversación.
  if (!(await aiStillInControl(companyId, leadId))) {
    logger.info('[AI] El asesor ya tomó el chat — no se envía la respuesta de la IA', { leadId });
    return Timestamp.now();
  }
  const fixedContent = fixMerakiLinks(rawContent);
  const content = (!lead.channel || lead.channel === 'whatsapp') ? formatForWhatsApp(fixedContent) : fixedContent;
  const now = Timestamp.now();
  let status: 'sent' | 'failed' = 'sent';
  let externalMsgId: string | undefined;
  let provider: SendTextResult['provider'] | undefined;
  let sendError: string | undefined;
  let voiceUrl: string | undefined;

  // Si el lead nos envió una nota de voz y la empresa tiene voz activa, responder con audio
  if (sendAsVoice && (!lead.channel || lead.channel === 'whatsapp')) {
    try {
      const voiceResult = await generateVictoriaVoiceNote(companyId, leadId, content);
      if (voiceResult?.audioUrl) {
        voiceUrl = voiceResult.audioUrl;
        logger.info('[AI] Enviando respuesta como nota de voz con Andrea Paisa', { leadId, voiceUrl });
        const mediaResult = await sendMediaToLeadChannel(
          { ...lead, companyId },
          voiceResult.audioUrl,
          voiceResult.mimeType
        );
        provider = mediaResult.provider;
        externalMsgId = mediaResult.externalMsgId;
      }
    } catch (err) {
      logger.error('[AI] Error generando o enviando nota de voz, cayendo a texto', { error: String(err) });
    }
  }

  // Si no se envió como audio (o falló la generación), enviar como texto normal
  if (!externalMsgId) {
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
      ...(voiceUrl ? { isVoiceNote: true, mediaUrl: voiceUrl, mediaType: 'audio/ogg; codecs=opus' } : {}),
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
  // Seguridad (R11): la llave de YCloud solo viaja a dominios de YCloud y el
  // destino/redirecciones se validan (antes se enviaba a cualquier URL).
  const { buffer } = await safeDownload(audioUrl, {
    headersFor: ycloudAuthHeaders(env.ycloudApiKey()),
    maxBytes:   25 * 1024 * 1024, // límite de Whisper
  });

  // Determinar extensión para que Whisper identifique el formato
  const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg';
  const file = new File([new Uint8Array(buffer)], `audio.${ext}`, { type: mimeType });

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

  // Con una cita agendada no hay "información pendiente": no se programan seguimientos.
  if (await hasPendingAppointment(companyId, leadId)) {
    logger.info('[AI] Lead con cita agendada — sin seguimientos', { leadId });
    return;
  }

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
