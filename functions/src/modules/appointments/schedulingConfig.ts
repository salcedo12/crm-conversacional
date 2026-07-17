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

/** Guarda (crea/sobrescribe) la config de agenda de la empresa. */
export async function saveSchedulingConfig(companyId: string, cfg: SchedulingConfig): Promise<void> {
  await ref(companyId).set({ ...cfg });
}
