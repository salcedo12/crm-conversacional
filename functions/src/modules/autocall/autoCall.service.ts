import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { leadsRepository } from '../leads/leads.repository';
import { callsRepository } from '../calls/calls.repository';
import { findActiveAppointmentForLead } from '../appointments/appointments.service';
import { getDaptaClient } from '../../integrations/dapta/dapta.client';
import { getAutoCallConfig, type AutoCallConfig } from './autoCallConfig';
import { autoCallTasksRepository, type AutoCallTask } from './autoCallTasks.repository';
import { isWithinCallWindow, nextCallWindowOpen } from './phoneTimezone';
import type { Lead } from '../leads/leads.types';
import type { Call } from '../calls/calls.types';

/** Fuentes de lead que "escriben" (mensajería entrante). Manual/web quedan fuera. */
const MESSAGING_SOURCES = new Set(['whatsapp', 'facebook', 'instagram', 'meta_ads']);

/** Estados de lead en los que ya no tiene sentido llamar. */
const TERMINAL_LEAD_STATUS = new Set(['scheduled', 'closed', 'lost']);

function hasCallablePhone(lead: Pick<Lead, 'phone'>): boolean {
  return typeof lead.phone === 'string' && /^\+\d{7,15}$/.test(lead.phone.trim());
}

/** ¿El lead es elegible para auto-llamada al entrar? */
export function isLeadEligibleForAutoCall(lead: Lead): boolean {
  return MESSAGING_SOURCES.has(lead.source) && hasCallablePhone(lead);
}

// ─── 1. Encolar la llamada inicial cuando entra un lead nuevo ──────────────────

export async function enqueueInitialAutoCall(companyId: string, lead: Lead): Promise<void> {
  const config = await getAutoCallConfig(companyId);
  if (!config.enabled) return;
  if (!isLeadEligibleForAutoCall(lead)) return;
  if (await autoCallTasksRepository.existsForLead(companyId, lead.id)) return;

  await autoCallTasksRepository.create({
    companyId,
    leadId:      lead.id,
    leadPhone:   lead.phone,
    attempt:     1,
    kind:        'initial',
    scheduledAt: Timestamp.now(), // el cron respeta la ventana diurna al disparar
    status:      'pending',
  });
  logger.info('[AutoCall] Llamada inicial encolada', { companyId, leadId: lead.id });
}

// ─── 2. Disparar las tareas vencidas (lo llama el cron) ────────────────────────

const startOfTodayMs = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export async function fireDueAutoCalls(companyId: string): Promise<number> {
  const config = await getAutoCallConfig(companyId);
  if (!config.enabled) return 0;

  const now = Timestamp.now();
  const due = await autoCallTasksRepository.findDue(companyId, now);
  if (due.length === 0) return 0;

  let firedToday = config.dailyCap > 0
    ? await autoCallTasksRepository.countFiredSince(companyId, Timestamp.fromMillis(startOfTodayMs()))
    : 0;

  let fired = 0;
  for (const task of due) {
    const outcome = await fireOneTask(companyId, task, config, firedToday);
    if (outcome === 'fired') { fired++; firedToday++; }
  }
  return fired;
}

type FireOutcome = 'fired' | 'rescheduled' | 'skipped';

async function fireOneTask(
  companyId: string,
  task: AutoCallTask,
  config: AutoCallConfig,
  firedToday: number
): Promise<FireOutcome> {
  const lead = await leadsRepository.findById(companyId, task.leadId);
  if (!lead || !hasCallablePhone(lead)) {
    await autoCallTasksRepository.update(companyId, task.id, { status: 'skipped' });
    return 'skipped';
  }

  // El lead ya se convirtió o se descartó → no llamar.
  if (TERMINAL_LEAD_STATUS.has(lead.status)) {
    await autoCallTasksRepository.update(companyId, task.id, { status: 'skipped' });
    return 'skipped';
  }

  const nowDate = new Date();

  // Fuera del horario diurno del país del lead → reprogramar (no consume intento).
  if (!isWithinCallWindow(lead.phone, nowDate, config.windowStartHour, config.windowEndHour)) {
    const next = nextCallWindowOpen(lead.phone, nowDate, config.windowStartHour, config.windowEndHour);
    await autoCallTasksRepository.update(companyId, task.id, { scheduledAt: Timestamp.fromDate(next) });
    return 'rescheduled';
  }

  // Tope diario de costo alcanzado → reintentar en la próxima corrida.
  if (config.dailyCap > 0 && firedToday >= config.dailyCap) {
    const next = new Date(nowDate.getTime() + 30 * 60_000);
    await autoCallTasksRepository.update(companyId, task.id, { scheduledAt: Timestamp.fromDate(next) });
    logger.warn('[AutoCall] Tope diario alcanzado — tarea reprogramada', { companyId, leadId: lead.id, dailyCap: config.dailyCap });
    return 'rescheduled';
  }

  if (!env.daptaConfigured()) {
    await autoCallTasksRepository.update(companyId, task.id, { status: 'skipped' });
    logger.warn('[AutoCall] Dapta no configurado — no se puede disparar', { companyId, leadId: lead.id });
    return 'skipped';
  }

  const anchorAt = task.anchorAt ?? Timestamp.now();

  try {
    const result = await getDaptaClient().startCall({
      phone:     lead.phone,
      name:      lead.name,
      leadId:    lead.id,
      companyId,
      ...(lead.metadata && Object.keys(lead.metadata).length > 0 ? { variables: lead.metadata } : {}),
    });

    if (!result.ok) throw new Error(`Dapta rechazó la solicitud (HTTP ${result.status}).`);

    const call = await callsRepository.create({
      companyId,
      leadId:       lead.id,
      direction:    'outbound',
      provider:     'dapta',
      status:       'initiated',
      triggeredBy:  'auto',
      auto:         true,
      autoAttempt:  task.attempt,
      autoAnchorAt: anchorAt,
      leadName:     lead.name,
      leadPhone:    lead.phone,
      ...(result.externalId && { externalId: result.externalId }),
      createdAt:    Timestamp.now(),
    });

    await autoCallTasksRepository.update(companyId, task.id, {
      status: 'fired', callId: call.id, firedAt: Timestamp.now(), anchorAt,
    });
    logger.info('[AutoCall] Llamada disparada', { companyId, leadId: lead.id, attempt: task.attempt, callId: call.id });
    return 'fired';
  } catch (err) {
    // No se pudo ni iniciar la llamada (no habrá webhook) → programar el reintento aquí.
    logger.error('[AutoCall] Error iniciando llamada — se programa reintento', {
      companyId, leadId: lead.id, attempt: task.attempt,
      error: err instanceof Error ? err.message : String(err),
    });
    await autoCallTasksRepository.update(companyId, task.id, { status: 'skipped', anchorAt });
    await scheduleRetry(companyId, lead, task.attempt, anchorAt, config);
    return 'skipped';
  }
}

// ─── 3. Reaccionar al resultado de una llamada automática (lo llama el webhook) ─

type CallCategory = 'booked' | 'interested' | 'no_contact' | 'contacted';

const BOOKED_OUTCOMES     = new Set(['Agendó cita', 'Cita virtual', 'Cita presencial']);
const INTERESTED_OUTCOMES = new Set(['Interesado', 'Recontactar']);
const NO_CONTACT_OUTCOMES = new Set(['No contestó', 'No concluida']);
const NO_CONTACT_STATUS   = new Set(['no-answer', 'voicemail', 'busy', 'failed', 'missed', 'rejected']);

function classifyCall(call: Pick<Call, 'outcome' | 'status'>): CallCategory {
  const o = call.outcome;
  if (o && BOOKED_OUTCOMES.has(o))     return 'booked';
  if (o && INTERESTED_OUTCOMES.has(o)) return 'interested';
  if (o && NO_CONTACT_OUTCOMES.has(o)) return 'no_contact';
  if (NO_CONTACT_STATUS.has(call.status)) return 'no_contact';
  return 'contacted'; // contestó pero sin interés claro → no reintentar
}

/**
 * Decide el siguiente paso tras una llamada automática:
 *  - no contactado  → reintento (si quedan offsets)
 *  - interesado sin cita → seguimiento (una sola vez)
 *  - agendó / no interesado / contactado → fin de la cadena
 */
export async function handleAutoCallResult(companyId: string, call: Call): Promise<void> {
  if (!call.auto) return;
  const config = await getAutoCallConfig(companyId);
  if (!config.enabled) return;

  const lead = await leadsRepository.findById(companyId, call.leadId);
  if (!lead || TERMINAL_LEAD_STATUS.has(lead.status)) return;

  // Si el lead ya tiene una cita activa, no seguir llamando aunque el outcome no lo diga.
  const activeAppt = await findActiveAppointmentForLead(companyId, call.leadId);
  if (activeAppt) return;

  // Evitar duplicar si el webhook llega dos veces: solo una tarea pendiente por lead.
  if (await autoCallTasksRepository.existsPendingForLead(companyId, call.leadId)) return;

  const category = classifyCall(call);
  const attempt  = call.autoAttempt ?? 1;
  const anchorAt = call.autoAnchorAt ?? call.createdAt;

  if (category === 'no_contact') {
    await scheduleRetry(companyId, lead, attempt, anchorAt, config);
  } else if (category === 'interested') {
    await scheduleFollowUp(companyId, lead, attempt, config);
  }
  // 'booked' / 'contacted' → no se encola nada más.
}

// ─── Helpers de programación ───────────────────────────────────────────────────

/** Programa el reintento posterior a un no-contacto (offset contado desde el 1er intento). */
async function scheduleRetry(
  companyId: string,
  lead: Lead,
  failedAttempt: number,
  anchorAt: Timestamp,
  config: AutoCallConfig
): Promise<void> {
  const retryIndex = failedAttempt - 1; // intento 1 → offset[0], intento 2 → offset[1] …
  if (retryIndex < 0 || retryIndex >= config.retryOffsetsHours.length) return;
  if (await autoCallTasksRepository.existsPendingForLead(companyId, lead.id)) return;

  const scheduledMs = anchorAt.toMillis() + config.retryOffsetsHours[retryIndex] * 3_600_000;
  await autoCallTasksRepository.create({
    companyId,
    leadId:      lead.id,
    leadPhone:   lead.phone,
    attempt:     failedAttempt + 1,
    kind:        'retry',
    scheduledAt: Timestamp.fromMillis(Math.max(scheduledMs, Date.now())),
    anchorAt,
    status:      'pending',
  });
  logger.info('[AutoCall] Reintento programado', {
    companyId, leadId: lead.id, nextAttempt: failedAttempt + 1, offsetHours: config.retryOffsetsHours[retryIndex],
  });
}

/** Programa un único seguimiento a un interesado que no agendó cita. */
async function scheduleFollowUp(
  companyId: string,
  lead: Lead,
  prevAttempt: number,
  config: AutoCallConfig
): Promise<void> {
  if (!config.followUpInterestedEnabled) return;
  if (lead.autoCallFollowupDone) return;
  if (await autoCallTasksRepository.existsPendingForLead(companyId, lead.id)) return;

  await autoCallTasksRepository.create({
    companyId,
    leadId:      lead.id,
    leadPhone:   lead.phone,
    attempt:     prevAttempt + 1,
    kind:        'followup',
    scheduledAt: Timestamp.fromMillis(Date.now() + config.followUpInterestedHours * 3_600_000),
    status:      'pending',
  });
  await leadsRepository.update(companyId, lead.id, { autoCallFollowupDone: true });
  logger.info('[AutoCall] Seguimiento a interesado programado', {
    companyId, leadId: lead.id, inHours: config.followUpInterestedHours,
  });
}
