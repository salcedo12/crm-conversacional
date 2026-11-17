import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { followUpsRepository } from '../followups/followups.repository';
import { leadsRepository } from '../leads/leads.repository';
import type { Lead } from '../leads/leads.types';
import { messagesRepository } from '../messages/messages.repository';
import { getAiConfig } from './aiConfig.repository';
import type { AiConfig } from './ai.types';

type ProfileConfig = Pick<AiConfig, 'agentProfile'>;
type RolloutLead = Pick<Lead, 'phone' | 'normalizedPhone' | 'createdAt' | 'source'>;

/** Agente consultivo: modelo nuevo, reglas comerciales y plazos 20/30/40. */
export function usesConsultiveAgent(config: ProfileConfig): boolean {
  return config.agentProfile === 'consultive';
}

export function isVoiceEnabled(config: Pick<AiConfig, 'voiceEnabled'>): boolean {
  return config.voiceEnabled === true;
}

/** Últimos 10 dígitos: compara teléfonos sin importar el formato ni el indicativo. */
export function phoneKey(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * ¿La IA puede atender este lead? Sin `rollout` atiende a todos. Con `rollout` atiende
 * solo a los teléfonos de prueba y a los leads creados desde `startAt`, opcionalmente
 * limitados a ciertos orígenes. Los leads anteriores al piloto nunca entran.
 */
export function isLeadInAiRollout(config: Pick<AiConfig, 'rollout'>, lead: RolloutLead): boolean {
  const rollout = config.rollout;
  if (!rollout) return true;

  const key = phoneKey(lead.normalizedPhone || lead.phone);
  if (key && (rollout.testPhones ?? []).some((phone) => phoneKey(phone) === key)) return true;

  const startMs = rollout.startAt?.toMillis?.();
  if (startMs === undefined) return false;
  if ((lead.createdAt?.toMillis?.() ?? 0) < startMs) return false;

  const sources = rollout.sources ?? [];
  return sources.length === 0 || sources.includes(String(lead.source ?? ''));
}

/**
 * Reinicia el reloj de primer contacto cuando un lead pasa de la IA a un asesor. Sin
 * esto, el lead se reasignaría de inmediato porque el reloj siguió corriendo.
 *
 * NO toca `advisorAssignedAt`: esa fecha marca desde cuándo el asesor tiene el lead y
 * el muro de privacidad del chat oculta lo anterior a ella. Moverla al pausar la IA
 * le escondía al asesor toda la conversación que tuvo la IA con el cliente.
 */
export function humanHandoffPatch(lead: Pick<Lead, 'pendingFirstContact'>): Partial<Lead> {
  return lead.pendingFirstContact ? { firstContactClockAt: Timestamp.now() } : {};
}

/**
 * Inicio del reloj de primer contacto: el más reciente entre la asignación y el último
 * reinicio (traspaso desde la IA o espera sin asesor alterno).
 */
export function firstContactClockMs(
  lead: Pick<Lead, 'advisorAssignedAt' | 'firstContactClockAt'>
): number | undefined {
  const assigned = lead.advisorAssignedAt?.toMillis?.();
  const clock = lead.firstContactClockAt?.toMillis?.();
  if (assigned === undefined) return clock;
  if (clock === undefined) return assigned;
  return Math.max(assigned, clock);
}

/**
 * Si el asesor escribe en un chat que la IA está atendiendo, la IA se pausa. Mientras la
 * IA de la empresa esté apagada o el lead esté fuera del piloto, no cambia nada.
 */
export async function pauseAiForAdvisorMessage(
  companyId: string,
  lead: Lead,
  advisorId: string | undefined
): Promise<void> {
  if (!lead.aiEnabled) return;
  const config = await getAiConfig(companyId);
  if (!config.enabled || !isLeadInAiRollout(config, lead)) return;

  const now = Timestamp.now();
  await leadsRepository.update(companyId, lead.id, {
    aiEnabled:           false,
    aiDisabledAt:        now,
    aiTakeoverSlaStatus: 'pending',
    ...(advisorId ? { takeoverBy: advisorId } : {}),
  });
  await followUpsRepository.cancelPendingForLead(companyId, lead.id);
  await messagesRepository.create({
    companyId,
    leadId:     lead.id,
    direction:  'outbound',
    senderType: 'system',
    content:    'IA pausada. El asesor tomó el control.',
    channel:    'whatsapp',
    status:     'sent',
    createdAt:  now,
  });
  logger.info('[AI] IA pausada porque el asesor escribió', { companyId, leadId: lead.id, advisorId });
}

// ─── Compradores actuales ───────────────────────────────────────────────────────

const BUYERS_TTL_MS = 10 * 60 * 1000;
const buyersCache = new Map<string, { at: number; phones: Set<string> }>();

/** Los teléfonos de SmartHome vienen en muchos formatos y a veces traen dos números. */
export function buyerPhoneKeys(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,;/]|-\+/)
    .map(phoneKey)
    .filter(Boolean);
}

async function loadBuyerPhones(companyId: string): Promise<Set<string>> {
  const cached = buyersCache.get(companyId);
  if (cached && Date.now() - cached.at < BUYERS_TTL_MS) return cached.phones;

  const company = db.collection('companies').doc(companyId);
  const [sales, clients] = await Promise.all([
    company.collection('smarthomeSales').select('mobileNumber', 'inventoryStatus').get(),
    company.collection('clients').select('mobile').get(),
  ]);
  const phones = new Set<string>();
  sales.docs
    .filter((doc) => doc.data().inventoryStatus !== 'DISPONIBLE')
    .forEach((doc) => buyerPhoneKeys(doc.data().mobileNumber).forEach((key) => phones.add(key)));
  clients.docs.forEach((doc) => buyerPhoneKeys(doc.data().mobile).forEach((key) => phones.add(key)));

  buyersCache.set(companyId, { at: Date.now(), phones });
  return phones;
}

/** Si la consulta falla responde false: el lead se atiende como un prospecto normal. */
export async function isExistingBuyer(
  companyId: string,
  lead: Pick<Lead, 'phone' | 'normalizedPhone'>
): Promise<boolean> {
  const key = phoneKey(lead.normalizedPhone || lead.phone);
  if (!key) return false;
  try {
    return (await loadBuyerPhones(companyId)).has(key);
  } catch (err) {
    logger.warn('[AI] No se pudo verificar si es comprador', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * ¿Es uno de los teléfonos de prueba del piloto de la IA (rollout.testPhones)? Esos
 * números pueden ser del equipo (p. ej. el celular personal de un usuario del CRM) y
 * aun así deben entrar como lead para probar la IA.
 */
export async function isAiTestPhone(companyId: string, phone: string): Promise<boolean> {
  const key = phoneKey(phone);
  if (!key) return false;
  try {
    const config = await getAiConfig(companyId);
    return (config.rollout?.testPhones ?? []).some((p) => phoneKey(p) === key);
  } catch {
    return false;
  }
}

/** Etiqueta de los leads de prueba de la IA (números del equipo que prueban el piloto). */
export const TEST_LEAD_TAG = 'prueba-ia';

/**
 * Lead de prueba: la IA lo atiende como cliente nuevo aunque el número sea de un
 * comprador, y sus fichas no se envían a la bitácora de SmartHome.
 */
export function isTestLead(lead: Pick<Lead, 'tags'> | null | undefined): boolean {
  return Array.isArray(lead?.tags) && lead.tags.includes(TEST_LEAD_TAG);
}
