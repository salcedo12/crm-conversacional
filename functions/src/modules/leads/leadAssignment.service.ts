import { db } from '../../lib/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { leadsRepository } from './leads.repository';
import { countsAs317LineLead, LINE_317_SOURCES } from './leadClassification';
import type { Lead } from './leads.types';

/** Solo los asesores reciben leads por asignacion automatica. */
const ASSIGNABLE_ROLES = ['advisor'];

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
      return ASSIGNABLE_ROLES.includes(u.role) && u.active !== false && !excluded.has(d.id);
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
async function countAssigned317Load(companyId: string, advisorId: string): Promise<number> {
  const snap = await leadsCol(companyId)
    .where('assignedTo', '==', advisorId)
    .where('source', 'in', Array.from(LINE_317_SOURCES))
    .get();

  return snap.docs.filter((doc) => countsAs317LineLead(doc.data() as Pick<Lead, 'source' | 'metadata'>)).length;
}

async function pickLeastLoadedAdvisor(companyId: string, pool: string[]): Promise<string> {
  const loads = await Promise.all(
    pool.map(async (uid) => ({ uid, count: await countAssigned317Load(companyId, uid) }))
  );

  const minCount = Math.min(...loads.map((l) => l.count));
  const leastLoaded = loads.filter((l) => l.count === minCount);
  const chosen = leastLoaded[Math.floor(Math.random() * leastLoaded.length)];

  logger.info('[LeadAssignment] Carga 317 para asignacion', {
    companyId,
    loads,
    chosenAdvisorId: chosen.uid,
  });

  return chosen.uid;
}

/**
 * Elige un asesor para un lead nuevo mediante round-robin por menor carga 317.
 *
 * Reparte entre todos los usuarios activos con rol asignable. La carga se mide
 * solo con leads de la linea 317 (whatsapp/web/meta_ads) y excluye los espejos
 * del WhatsApp personal del asesor.
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

  // Siempre se asigna al que MENOS leads tenga (así todos llegan a 1 antes de que
  // alguien tenga 2, a 2 antes de que alguien tenga 3, etc.). Cuando varios están
  // empatados en la menor carga, se elige al azar entre ellos: si no, el orden fijo
  // haría que el primero acaparara todos los leads que entran mientras hay empate.
  return pickLeastLoadedAdvisor(companyId, pool);
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

  const chosen = await pickLeastLoadedAdvisor(companyId, pool);
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
 * Asigna un asesor a un lead (round-robin) y lo persiste. Se llama al crear un
 * lead desde los webhooks de entrada y, de forma perezosa, al agendar una cita
 * de un lead que aún no tuviera asesor.
 *
 * No lanza: si algo falla, el lead queda sin asignar y se registra el error.
 *
 * @returns uid del asesor asignado, o null si no se pudo asignar.
 */
export async function assignLead(companyId: string, leadId: string): Promise<string | null> {
  try {
    const advisorId = await pickAdvisorForLead(companyId);
    if (!advisorId) return null;
    await leadsRepository.update(companyId, leadId, {
      assignedTo: advisorId,
      advisorAssignedAt: Timestamp.now(),
      pendingFirstContact: true,
    });
    logger.info('[LeadAssignment] Lead asignado', { companyId, leadId, advisorId });
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
