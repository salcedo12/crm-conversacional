import { db } from '../../lib/admin';

/**
 * Configuración del modo de llamadas IA automáticas, por empresa.
 * Ruta: companies/{companyId}/config/autoCall
 *
 * Cuando está activo, cada lead NUEVO que entra por un canal de mensajería
 * (WhatsApp/redes) y tiene teléfono se llama automáticamente con la IA de voz
 * (Dapta), respetando el horario diurno del país del lead. Si no contesta, se
 * reintenta según `retryOffsetsHours`. Si contesta y queda interesado sin cita,
 * se agenda un seguimiento.
 */
export interface AutoCallConfig {
  /** Interruptor maestro. false = no se dispara ninguna llamada automática. */
  enabled: boolean;
  /** Ventana diurna (hora local del lead) en la que se permite marcar. */
  windowStartHour: number; // 0–23
  windowEndHour:   number; // 1–24
  /**
   * Reintentos tras un NO-CONTACTO, como horas contadas desde el primer intento.
   * Ej: [5, 24, 48] → reintenta a las 5h, al día siguiente y 2 días después.
   * Vacío = sin reintentos.
   */
  retryOffsetsHours: number[];
  /** Hacer una llamada de seguimiento a interesados que no agendaron cita. */
  followUpInterestedEnabled: boolean;
  /** Horas de espera para el seguimiento a interesados. */
  followUpInterestedHours: number;
  /** Tope de llamadas automáticas por día (guarda de costo). 0 = sin tope. */
  dailyCap: number;
}

export const DEFAULT_AUTO_CALL_CONFIG: AutoCallConfig = {
  enabled:                   false,
  windowStartHour:           8,
  windowEndHour:             18,
  retryOffsetsHours:         [5, 24, 48],
  followUpInterestedEnabled: true,
  followUpInterestedHours:   24,
  dailyCap:                  150,
};

const ref = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('config').doc('autoCall');

/** Carga la config de auto-llamadas, mezclada con los defaults. */
export async function getAutoCallConfig(companyId: string): Promise<AutoCallConfig> {
  const snap = await ref(companyId).get();
  if (!snap.exists) return { ...DEFAULT_AUTO_CALL_CONFIG };
  return { ...DEFAULT_AUTO_CALL_CONFIG, ...(snap.data() as Partial<AutoCallConfig>) };
}

/** Guarda (crea/sobrescribe) la config de auto-llamadas de la empresa. */
export async function saveAutoCallConfig(companyId: string, cfg: AutoCallConfig): Promise<void> {
  await ref(companyId).set({ ...cfg });
}
