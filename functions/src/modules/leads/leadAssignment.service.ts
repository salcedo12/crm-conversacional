import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { googleConnectionRepository } from '../calendar/googleConnection.repository';
import { leadsRepository } from './leads.repository';

/** Roles que pueden recibir leads asignados (todos menos viewer). */
const ASSIGNABLE_ROLES = ['admin', 'manager', 'advisor'];

const leadsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

const usersCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('users');

/**
 * Elige un asesor para un lead nuevo mediante round-robin por menor carga.
 *
 * Prefiere asesores con Google Calendar conectado, para que las citas que agende
 * la IA se creen en su calendario con enlace de Meet. Si ningún candidato tiene
 * Google conectado, reparte entre todos los usuarios activos con rol asignable
 * (la cita se guardará sin Meet, pero el lead queda con dueño).
 *
 * @returns uid del asesor elegido, o null si la empresa no tiene usuarios asignables.
 */
export async function pickAdvisorForLead(companyId: string): Promise<string | null> {
  const usersSnap = await usersCol(companyId).get();
  const candidates = usersSnap.docs
    .filter((d) => {
      const u = d.data();
      return ASSIGNABLE_ROLES.includes(u.role) && u.active !== false;
    })
    .map((d) => d.id);

  if (candidates.length === 0) {
    logger.warn('[LeadAssignment] Sin usuarios asignables', { companyId });
    return null;
  }

  // Preferir asesores con Google conectado (para que la cita tenga Meet)
  const withGoogle = await Promise.all(
    candidates.map((uid) =>
      googleConnectionRepository.getActive(companyId, uid).then((c) => !!c)
    )
  );
  const connected = candidates.filter((_, i) => withGoogle[i]);
  const pool = connected.length > 0 ? connected : candidates;

  // Round-robin por menor carga: contar leads ya asignados a cada candidato
  const loads = await Promise.all(
    pool.map(async (uid) => {
      const agg = await leadsCol(companyId).where('assignedTo', '==', uid).count().get();
      return { uid, count: agg.data().count };
    })
  );
  loads.sort((a, b) => a.count - b.count);

  return loads[0].uid;
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
    await leadsRepository.update(companyId, leadId, { assignedTo: advisorId });
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
