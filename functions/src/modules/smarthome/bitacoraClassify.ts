import type { SmartHomeEvent } from '../../integrations/smarthome/smarthome.client';
import type { LeadStatus } from '../leads/leads.types';

/**
 * Clasificación del estado comercial de un cliente a partir de lo que el asesor
 * escribió en la BITÁCORA de SmartHome. Compartido por el Informe 317 (mostrar) y
 * por el sync automático de estado (escribir). Ver [[crm-informe-317-apartado]].
 */

const AUTO_NOTE_RE = /se agrega el cliente al sistema|se ha actualizado la informaci|se asigna el atendido en|oportunidad generada por whatsapp|registro api/i;

/**
 * ¿Es una nota escrita por un HUMANO (el asesor)? "Registrado por:" = escrita
 * desde nuestro CRM (aunque la acción diga "Evento del Sistema"); las del agente
 * móvil traen una acción real. Se excluyen los eventos de sistema y las plantillas.
 */
export function isAdvisorNote(e: SmartHomeEvent): boolean {
  const c = e.content ?? '';
  if (/registrado por:/i.test(c)) return true;
  if (e.system) return false;
  if (AUTO_NOTE_RE.test(c)) return false;
  return true;
}

/** Texto legible de una nota: si viene como "Registrado por:… Contexto: X", muestra X. */
export function cleanNoteText(content: string): string {
  const m = /contexto:\s*([\s\S]+)/i.exec(content);
  return (m ? m[1] : content).replace(/\s+/g, ' ').trim();
}

export type BitacoraSignal =
  | 'no_interesado' | 'compro' | 'agendado' | 'interesado' | 'sin_respuesta' | 'neutral' | 'sin_nota';

export interface BitacoraClass {
  signal: BitacoraSignal;
  reason?: 'precio' | 'ubicacion' | 'competencia' | 'otro';
  /** Estado comercial que sugiere la bitácora (para mostrar o para el sync). */
  suggested?: LeadStatus;
}

/**
 * Clasifica el estado del cliente leyendo lo que el asesor escribió en la bitácora.
 * Un "no interesado" (por precio, ubicación o competencia) NO necesita más
 * seguimiento → se sugiere Perdido.
 */
export function classifyBitacora(text: string): BitacoraClass {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return { signal: 'sin_nota' };
  const noInt = /no le interesa|no est[aá] interesad|no interesa|\bno desea\b|no quiere|desiste|desisti[oó]|ya (consigui|compr)|compr[oó] (otro|apartament|en otro|con otr)|prefiere otr|otro proyecto|no cuenta con presupuesto|no le alcanza|fuera de (su )?presupuesto|no le da el presupuesto/;
  if (noInt.test(t)) {
    let reason: BitacoraClass['reason'] = 'otro';
    if (/presupuesto|alcanza|dinero|caro|econom|precio|valor/.test(t)) reason = 'precio';
    else if (/desea en|interesa en (la|el)|prefiere (en|la|el)|quindio|eje cafeter|costa|bucaramanga|otra (ubicaci|zona|ciudad)|otro (lugar|sitio)/.test(t)) reason = 'ubicacion';
    else if (/otro proyecto|ya consigui|ya compr|competencia|otra (opci|empresa|constructora)/.test(t)) reason = 'competencia';
    return { signal: 'no_interesado', reason, suggested: 'lost' };
  }
  if (/compr[oó] (apartament|el lote|el terreno|con nosotros)|\bfirm[oó]\b|separ[oó]|vendid/.test(t)) return { signal: 'compro', suggested: 'closed' };
  if (/agend|programo la visita|programada la visita|visita el (dia|lunes|martes|mierc|juev|vier|sab|dom)|cita programada|viene a conocer|va a venir|me llama para la visita|ir a (la )?visita|asiste a corferias|va a la feria|ir a la feria/.test(t)) return { signal: 'agendado', suggested: 'scheduled' };
  if (/no contesta|nunca contest|no responde|no vuelve a contest|no me contest|numero desconectad|no ha (vuelto|contestad)|no da respuesta/.test(t)) return { signal: 'sin_respuesta' };
  if (/interesad|env[ií][oe]? (la )?informaci|hacer seguimiento|volver a llamar|quedo pendiente|solicita|muestra inter|env[ií]e informaci|va a revisar|le envie|pendiente de/.test(t)) return { signal: 'interesado', suggested: 'qualified' };
  return { signal: 'neutral' };
}

/** Última nota HUMANA del asesor (ya limpia), o '' si no hay. */
export function latestAdvisorNoteText(events: SmartHomeEvent[]): string {
  const note = events.find(isAdvisorNote);
  return note ? cleanNoteText(note.content ?? '') : '';
}
