import type { Lead } from '../types';

export interface ManualTakeoverSlaInfo {
  isManual: boolean;
  status: 'compliant' | 'pending' | 'overdue';
  hoursLeft: number;
  minsLeft: number;
  label: string;
  badgeLabel: string;
  deadlineMillis: number;
  isOverdue: boolean;
  isCompliant: boolean;
}

/**
 * Calcula el estado y tiempo restante del SLA de 24 horas cuando el asesor
 * apaga la IA para tomar control manual de la conversación.
 */
export function getManualTakeoverSlaInfo(lead: Lead): ManualTakeoverSlaInfo | null {
  if (lead.aiEnabled) return null;

  const rawLead = lead as unknown as Record<string, unknown>;

  // Si fue marcado explícitamente como compliant o exento en base de datos
  if (lead.aiTakeoverSlaStatus === 'compliant' || (rawLead.aiTakeoverSlaStatus === 'exempt')) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
      badgeLabel: '● Modo manual',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  const disabledMillis =
    lead.aiDisabledAt?.toMillis?.() ??
    (rawLead.aiPausedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ??
    0;

  const lastFollowUpMillis =
    lead.lastFollowUpAt?.toMillis?.() ??
    (rawLead.lastFichaAt as { toMillis?: () => number } | undefined)?.toMillis?.() ??
    0;

  // 1. REQUISITO ESTRICTO: Para estar "Ficha / Seguimiento al día", DEBE existir un
  // seguimiento o ficha técnica registrada (lastFollowUpMillis > 0).
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
      badgeLabel: '✅ Ficha al día',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  // 2. EXENCIÓN DE HISTÓRICOS ANTERIORES A HOY:
  // Si no hubo acción explícita de apagar la IA por un asesor (disabledMillis === 0),
  // o si la toma manual ocurrió antes de la capacitación/lanzamiento de hoy (2026-10-26),
  // queda exento de mora para no penalizar a los asesores con vencidos históricos.
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();

  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '● Modo manual',
      badgeLabel: '● Modo manual',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  // 3. Para tomas de control manual iniciadas hoy en adelante:
  // El tiempo corre 24 horas exactas desde que el asesor apagó la IA.
  const deadlineMillis = disabledMillis + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  // 4. Si ya vencieron las 24h
  if (diffMs <= 0 || lead.aiTakeoverSlaStatus === 'overdue') {
    return {
      isManual: true,
      status: 'overdue',
      hoursLeft: 0,
      minsLeft: 0,
      label: '🚨 SLA 24h vencido tras apagar IA — Llenar Ficha Técnica ahora',
      badgeLabel: '🚨 SLA 24h vencido',
      deadlineMillis,
      isOverdue: true,
      isCompliant: false,
    };
  }

  // 5. En cuenta regresiva activa dentro del plazo de 24h
  const hoursLeft = Math.floor(diffMs / 3600_000);
  const minsLeft = Math.floor((diffMs % 3600_000) / 60_000);

  return {
    isManual: true,
    status: 'pending',
    hoursLeft,
    minsLeft,
    label: `⏳ Toma manual: ${hoursLeft}h ${minsLeft}m restantes para registrar Ficha o Cita`,
    badgeLabel: `⏳ ${hoursLeft}h ${minsLeft}m restantes`,
    deadlineMillis,
    isOverdue: false,
    isCompliant: false,
  };
}
