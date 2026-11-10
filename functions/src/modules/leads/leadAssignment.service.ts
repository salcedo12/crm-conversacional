import { db } from '../../lib/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { leadsRepository } from './leads.repository';
import { countsAs317LineLead, LINE_317_SOURCES } from './leadClassification';
import type { Lead } from './leads.types';

/** Solo los asesores reciben leads por asignacion automatica. */
const ASSIGNABLE_ROLES = ['advisor'];

const TEST_USER_IDS = new Set(['H69G8PsEzReNuU1yowJNnlCHgie2']);
const TEST_USER_EMAILS = new Set(['servidor.meraki@gmail.com']);
const TEST_USER_NAMES = new Set(['pruebas', 'prueba']);

/**
 * Determina si un usuario es de pruebas o tiene deshabilitada la recepción
 * automática de leads de pauta / línea 317.
 */
export function isExcludedFromLeadAssignment(
  userId: string,
  u: FirebaseFirestore.DocumentData | undefined
): boolean {
  if (!u) return true;
  if (
    u.excludeFromLeadAssignment === true ||
    u.receiveLeads === false ||
    u.isTestUser === true
  ) {
    return true;
  }
  if (TEST_USER_IDS.has(userId)) return true;
  const email = String(u.email || '').trim().toLowerCase();
  if (TEST_USER_EMAILS.has(email)) return true;
  const name = String(u.displayName || u.name || '').trim().toLowerCase();
  if (TEST_USER_NAMES.has(name)) return true;
  return false;
}

const leadsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

const usersCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('users');

async function getAssignableAdvisorPool(
  companyId: string,
  options: { exclude?: string[]; requireGoogle?: boolean; preferGoogle?: boolean } = {}
): Promise<string[]> {
  const excluded = new Set(options.exclude ?? []);
  const usersSnap = await usersCol(companyId).get();
  const candidates = usersSnap.docs
    .filter((d) => {
      const u = d.data();
      return (
        ASSIGNABLE_ROLES.includes(u.role) &&
        u.active !== false &&
        u.isBlockedForLeads !== true && // <-- Bloqueo disciplinario activo por SLA
        !isExcludedFromLeadAssignment(d.id, u) &&
        !excluded.has(d.id)
      );
    })
    .map((d) => d.id);

  if (candidates.length === 0) {
    return [];
  }

  if (!options.requireGoogle && !options.preferGoogle) {
    return candidates;
  }

  const withGoogle = await Promise.all(
    candidates.map((uid) =>
      googleConnectionRepository.getActive(companyId, uid).then((c) => !!c)
    )
  );
  const connected = candidates.filter((_, i) => withGoogle[i]);
  return options.requireGoogle
    ? connected
    : (connected.length > 0 ? connected : candidates);
}

/**
 * Cuenta solo la carga de leads de la linea 317 para no mezclar datos propios
 * del WhatsApp del asesor ni otros canales manuales/organicos.
 */
export async function countAssigned317Load(companyId: string, advisorId: string): Promise<number> {
  const snap = await leadsCol(companyId)
    .where('assignedTo', '==', advisorId)
    .where('source', 'in', Array.from(LINE_317_SOURCES))
    .get();

  return snap.docs.filter((doc) => countsAs317LineLead(doc.data() as Pick<Lead, 'source' | 'metadata' | 'inbox'>)).length;
}

/**
 * Elige un asesor del pool elegible mediante Round-Robin por Turno de Espera.
 *
 * En lugar de contar el acumulado de meses pasados, selecciona al asesor activo que
 * lleve más tiempo sin recibir un lead (menor `lastLeadAssignedAt` o sin asignación previa).
 * Esto garantiza que cada lead nuevo se reparta estrictamente 1 a 1 entre todos los asesores.
 * Si varios asesores empatan (ej: todos al inicio del turno), se elige aleatoriamente entre ellos.
 */
async function pickAdvisorByWaitTurn(companyId: string, pool: string[]): Promise<string> {
  if (pool.length === 1) return pool[0];

  const userSnaps = await Promise.all(
    pool.map(async (uid) => {
      try {
        const snap = await usersCol(companyId).doc(uid).get();
        return { uid, data: snap.data() };
      } catch {
        return { uid, data: undefined };
      }
    })
  );

  const candidates = userSnaps.map((u) => {
    const lastMillis = u.data?.lastLeadAssignedAt?.toMillis?.() ?? 0;
    return {
      uid: u.uid,
      lastMillis,
    };
  });

  // Ordenar de MENOR a MAYOR tiempo (los que tienen 0 o fecha más antigua van primero)
  candidates.sort((a, b) => {
    if (a.lastMillis !== b.lastMillis) {
      return a.lastMillis - b.lastMillis;
    }
    return Math.random() - 0.5;
  });

  const chosen = candidates[0].uid;

  logger.info('[LeadAssignment] Asesor elegido por turno de espera (Round-Robin)', {
    companyId,
    chosen,
    queue: candidates.map((c) => ({
      uid: c.uid,
      lastAssigned: c.lastMillis === 0 ? 'Sin asignación previa' : new Date(c.lastMillis).toISOString(),
    })),
  });

  return chosen;
}

/**
 * Actualiza el turno del asesor en su ficha de usuario para mandarlo al final de la cola.
 */
export async function markAdvisorTurnUsed(companyId: string, advisorId: string): Promise<void> {
  try {
    await usersCol(companyId).doc(advisorId).update({
      lastLeadAssignedAt: Timestamp.now(),
    });
  } catch (err) {
    logger.warn('[LeadAssignment] No se pudo actualizar lastLeadAssignedAt del asesor', {
      companyId,
      advisorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Elige un asesor para un lead nuevo mediante round-robin por turno de espera.
 *
 * Reparte de forma equitativa 1 a 1 entre todos los usuarios activos con rol asignable
 * que no tengan bloqueo disciplinario por SLA.
 *
 * @returns uid del asesor elegido, o null si la empresa no tiene usuarios asignables.
 */
export async function pickAdvisorForLead(
  companyId: string,
  options: { exclude?: string[]; requireGoogle?: boolean } = {}
): Promise<string | null> {
  const pool = await getAssignableAdvisorPool(companyId, options);

  if (pool.length === 0) {
    logger.warn('[LeadAssignment] Sin usuarios asignables', { companyId });
    return null;
  }

  return pickAdvisorByWaitTurn(companyId, pool);
}

async function getFirstContactTimeoutAdvisorIds(companyId: string, leadId: string): Promise<string[]> {
  const snap = await db.collection('companies').doc(companyId)
    .collection('leadReassignmentEvents')
    .where('leadId', '==', leadId)
    .get();

  const ids = new Set<string>();
  snap.docs.forEach((doc) => {
    const event = doc.data();
    if (event.reason === 'first-contact-timeout' && typeof event.previousAdvisorId === 'string') {
      ids.add(event.previousAdvisorId);
    }
  });
  return [...ids];
}

/**
 * Elige el siguiente asesor para un lead que ya fue quitado por falta de primer
 * contacto. Primero evita repetir asesores que ya dejaron vencer este mismo lead;
 * entre los elegibles, asigna al de menor carga 317. Solo cuando el lead ya
 * recorrio todos los asesores elegibles se reinicia el ciclo.
 */
export async function pickAdvisorForFirstContactReassignment(
  companyId: string,
  leadId: string,
  currentAdvisorId: string,
  options: { requireGoogle?: boolean } = {}
): Promise<string | null> {
  const alreadyTimedOut = await getFirstContactTimeoutAdvisorIds(companyId, leadId);
  const excludeUntilCycleEnds = [...alreadyTimedOut, currentAdvisorId];
  let pool = await getAssignableAdvisorPool(companyId, {
    exclude: excludeUntilCycleEnds,
    requireGoogle: options.requireGoogle,
  });
  let cycleReset = false;

  if (pool.length === 0) {
    cycleReset = true;
    pool = await getAssignableAdvisorPool(companyId, {
      exclude: [currentAdvisorId],
      requireGoogle: options.requireGoogle,
    });
  }

  if (pool.length === 0) {
    logger.warn('[LeadAssignment] Sin asesor alterno para reasignacion', {
      companyId,
      leadId,
      currentAdvisorId,
      requireGoogle: options.requireGoogle === true,
    });
    return null;
  }

  const chosen = await pickAdvisorByWaitTurn(companyId, pool);
  logger.info('[LeadAssignment] Asesor elegido para reasignacion por falta de contacto', {
    companyId,
    leadId,
    currentAdvisorId,
    advisorId: chosen,
    skippedAdvisorCount: alreadyTimedOut.length,
    cycleReset,
  });
  return chosen;
}

/**
 * Asigna un asesor a un lead (round-robin por turno de espera) y lo persiste.
 * Se llama al crear un lead desde los webhooks de entrada y, de forma perezosa,
 * al agendar una cita de un lead que aún no tuviera asesor.
 *
 * No lanza: si algo falla, el lead queda sin asignar y se registra el error.
 *
 * @returns uid del asesor asignado, o null si no se pudo asignar.
 */
export async function assignLead(companyId: string, leadId: string): Promise<string | null> {
  try {
    const advisorId = await pickAdvisorForLead(companyId);
    if (!advisorId) return null;
    const now = Timestamp.now();
    await leadsRepository.update(companyId, leadId, {
      assignedTo: advisorId,
      advisorAssignedAt: now,
      pendingFirstContact: true,
    });
    // Desplaza al asesor elegido al final de la fila de espera
    await markAdvisorTurnUsed(companyId, advisorId);
    logger.info('[LeadAssignment] Lead asignado por turno de espera', { companyId, leadId, advisorId });
    return advisorId;
  } catch (err) {
    logger.error('[LeadAssignment] Error asignando lead', {
      companyId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
