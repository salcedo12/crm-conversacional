import { db } from '../../lib/admin';

/**
 * Configuración de agenda por empresa: define cuándo se pueden agendar citas.
 * Si no hay doc en Firestore, se usan los defaults (= comportamiento histórico:
 * lun-sáb, 8:00–18:00, bloques de 30 min, sin almuerzo ni festivos).
 *
 * Ruta: companies/{companyId}/config/scheduling
 */
export interface SchedulingConfig {
  /** Días laborales (0=domingo … 6=sábado). */
  workingDays:   number[];
  /** Hora de apertura (0–23). */
  startHour:     number;
  /** Hora de cierre (1–24). */
  endHour:       number;
  /** Tamaño del bloque/cita en minutos (granularidad de las sugerencias). */
  slotMinutes:   number;
  /** Cuántos días hacia adelante buscar horarios alternativos. */
  lookaheadDays: number;
  /** Anticipación mínima en minutos para que la IA agende (no aplica a asesores). */
  minAdvanceMinutes: number;
  /** Activa la reasignacion automatica si el asesor no hace primer contacto humano. */
  autoReassignFirstContactEnabled: boolean;
  /** Minutos que se espera el primer mensaje humano del asesor antes de reasignar. */
  firstContactTimeoutMinutes: number;
  /** Hora local (0–23) desde la que SÍ se permite reasignar. Fuera de la franja no
   *  se reasigna para no notificar a los asesores de madrugada. */
  reassignStartHour: number;
  /** Hora local (1–24) hasta la que se permite reasignar (exclusiva). */
  reassignEndHour: number;
  /** Franja de almuerzo en la que NO se agenda (opcional). */
  lunch:         { startHour: number; endHour: number } | null;
  /** Aplicar automáticamente los festivos nacionales de Colombia. */
  colombianHolidays: boolean;
  /** Claves de festivos nacionales que la empresa SÍ trabaja (no se cierran). */
  workedHolidays: string[];
  /** Festivos / días cerrados ADICIONALES en formato 'YYYY-MM-DD' (zona local). */
  holidays:      string[];
}

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  workingDays:       [1, 2, 3, 4, 5, 6], // lun–sáb
  startHour:         8,
  endHour:           18,
  slotMinutes:       30,
  lookaheadDays:     7,
  minAdvanceMinutes: 60,
  autoReassignFirstContactEnabled: false,
  firstContactTimeoutMinutes: 15,
  reassignStartHour: 7,
  reassignEndHour:   22,
  lunch:             null,
  colombianHolidays: true,
  workedHolidays:    [],
  holidays:          [],
};

const ref = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('config').doc('scheduling');

/** Carga la config de agenda, mezclada con los defaults (campos faltantes). */
export async function getSchedulingConfig(companyId: string): Promise<SchedulingConfig> {
  const snap = await ref(companyId).get();
  if (!snap.exists) return { ...DEFAULT_SCHEDULING_CONFIG };
  return { ...DEFAULT_SCHEDULING_CONFIG, ...(snap.data() as Partial<SchedulingConfig>) };
}

/**
 * Caché en memoria (por instancia de la función) para lecturas de alta
 * frecuencia — p. ej. el loop de reasignación, que consulta la config de CADA
 * empresa CADA minuto (1 lectura/empresa/min aunque el toggle esté apagado).
 * Con TTL de 5 min ese costo baja ~5×.
 *
 * Tradeoff: un cambio de config del admin tarda como mucho `ttlMs` en reflejarse
 * en el loop que use esta variante (aceptable para reasignación). NO usar donde
 * se requiera config siempre-fresca: el agendamiento de la IA sigue con
 * getSchedulingConfig (sin caché).
 */
const memCache = new Map<string, { cfg: SchedulingConfig; at: number }>();

export async function getSchedulingConfigCached(
  companyId: string,
  ttlMs = 5 * 60_000,
): Promise<SchedulingConfig> {
  const hit = memCache.get(companyId);
  if (hit && Date.now() - hit.at < ttlMs) return hit.cfg;
  const cfg = await getSchedulingConfig(companyId);
  memCache.set(companyId, { cfg, at: Date.now() });
  return cfg;
}

/** Guarda (crea/sobrescribe) la config de agenda de la empresa. */
export async function saveSchedulingConfig(companyId: string, cfg: SchedulingConfig): Promise<void> {
  await ref(companyId).set({ ...cfg });
  memCache.delete(companyId); // invalida el caché en esta instancia tras guardar
}
