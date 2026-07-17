import { env } from '../../config/env';
import { listEvents } from '../../integrations/google/google.client';
import { appointmentsRepository } from './appointments.repository';
import { getSchedulingConfig, type SchedulingConfig } from './schedulingConfig';
import { colombianHolidayKey } from './colombianHolidays';

export interface BusySlot {
  start: Date;
  end:   Date;
  source: 'crm' | 'google';
  title?: string;
}

export interface AvailabilityResult {
  available:   boolean;
  conflicts:   BusySlot[];
  suggestions: Date[];
}

const MAX_SUGGESTIONS = 5;

export class AvailabilityError extends Error {
  constructor(
    message: string,
    public readonly suggestions: Date[],
    public readonly conflicts: BusySlot[]
  ) {
    super(message);
    this.name = 'AvailabilityError';
  }
}

export function formatAvailabilityDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone:  env.calendarTimeZone(),
  }).format(date);
}

export function formatSuggestions(suggestions: Date[]): string {
  return suggestions.map(formatAvailabilityDate).join(', ');
}

export interface AvailabilityInput {
  companyId:    string;
  advisorId?:   string;
  refreshToken?: string;
  start:        Date;
  end:          Date;
  /** Si true, exige la anticipación mínima (minAdvanceMinutes). Solo para la IA. */
  enforceMinAdvance?: boolean;
}

export async function checkAppointmentAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
  const config = await getSchedulingConfig(input.companyId);
  // Hora más temprana permitida: ahora + anticipación mínima (solo si se exige).
  const earliest = input.enforceMinAdvance
    ? new Date(Date.now() + config.minAdvanceMinutes * 60_000)
    : new Date(0);

  const conflicts = await listBusySlots(input, config);
  const available =
    input.start.getTime() >= earliest.getTime() &&
    isWithinSchedule(input.start, input.end, config) &&
    !hasOverlap(conflicts, input.start, input.end);
  const suggestions = available
    ? []
    : await findNearbyAvailableSlots(input, conflicts, config, earliest);

  return { available, conflicts, suggestions };
}

export async function assertAppointmentAvailability(input: AvailabilityInput): Promise<void> {
  const result = await checkAppointmentAvailability(input);
  if (result.available) return;

  const detail = result.suggestions.length > 0
    ? ` Horarios disponibles cercanos: ${formatSuggestions(result.suggestions)}.`
    : ' No encontré horarios disponibles cercanos en los próximos días.';

  throw new AvailabilityError(
    `Ese horario no está disponible (en el pasado, muy pronto, ocupado o fuera del horario de atención).${detail}`,
    result.suggestions,
    result.conflicts
  );
}

async function listBusySlots(
  input: AvailabilityInput,
  config: SchedulingConfig
): Promise<BusySlot[]> {
  const durationMs = input.end.getTime() - input.start.getTime();
  const windowStart = new Date(input.start.getTime() - durationMs);
  const windowEnd = new Date(input.start.getTime() + config.lookaheadDays * 24 * 60 * 60_000);

  const [crmAppointments, googleEvents] = await Promise.all([
    appointmentsRepository.listOverlapping(input.companyId, windowStart, windowEnd, input.advisorId),
    input.refreshToken ? listEvents(input.refreshToken, windowStart, windowEnd) : Promise.resolve([]),
  ]);

  return [
    ...crmAppointments.map((a): BusySlot => ({
      start:  a.startTime.toDate(),
      end:    a.endTime.toDate(),
      source: 'crm',
      title:  a.title,
    })),
    ...googleEvents.map((e): BusySlot => ({
      start:  new Date(e.start),
      end:    new Date(e.end),
      source: 'google',
      title:  e.title,
    })),
  ].filter((slot) => slot.start.getTime() < slot.end.getTime());
}

export async function findNearbyAvailableSlots(
  input: AvailabilityInput,
  initialConflicts: BusySlot[],
  config: SchedulingConfig,
  earliest: Date
): Promise<Date[]> {
  const durationMs = input.end.getTime() - input.start.getTime();
  const slotMs = config.slotMinutes * 60_000;
  const suggestions: Date[] = [];
  const seen = new Set<number>();

  // Punto de partida: nunca antes de la hora más temprana permitida (earliest),
  // ni en el pasado. El horizonte de búsqueda se ancla en el mayor de start/earliest.
  const floorMs   = Math.max(input.start.getTime() + slotMs, earliest.getTime());
  const horizonMs = Math.max(input.start.getTime(), earliest.getTime())
    + config.lookaheadDays * 24 * 60 * 60_000;

  for (
    let candidate = roundUpToSlot(new Date(floorMs), slotMs);
    candidate.getTime() <= horizonMs;
    candidate = new Date(candidate.getTime() + slotMs)
  ) {
    const candidateEnd = new Date(candidate.getTime() + durationMs);
    if (!isWithinSchedule(candidate, candidateEnd, config)) continue;
    if (seen.has(candidate.getTime())) continue;

    const conflicts = initialConflicts.length > 0
      ? initialConflicts
      : (await listBusySlots({ ...input, start: candidate, end: candidateEnd }, config));

    if (!hasOverlap(conflicts, candidate, candidateEnd)) {
      suggestions.push(candidate);
      seen.add(candidate.getTime());
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
  }

  return suggestions;
}

function hasOverlap(slots: BusySlot[], start: Date, end: Date): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return slots.some((slot) => slot.start.getTime() < endMs && slot.end.getTime() > startMs);
}

function roundUpToSlot(date: Date, slotMs: number): Date {
  return new Date(Math.ceil(date.getTime() / slotMs) * slotMs);
}

/** ¿El rango [start, end] cae dentro del horario de atención configurado? */
function isWithinSchedule(start: Date, end: Date, config: SchedulingConfig): boolean {
  const s = getTimeParts(start);
  const e = getTimeParts(end);

  // Debe empezar y terminar el mismo día.
  if (s.day !== e.day) return false;
  // Día laboral.
  if (!config.workingDays.includes(s.weekday)) return false;
  // Festivo nacional de Colombia (automático), salvo que la empresa lo trabaje.
  if (config.colombianHolidays) {
    const hkey = colombianHolidayKey(s.day);
    if (hkey && !config.workedHolidays.includes(hkey)) return false;
  }
  // Festivo / día cerrado adicional.
  if (config.holidays.includes(s.day)) return false;
  // Dentro de la franja de atención.
  if (s.hour < config.startHour) return false;
  if (e.hour > config.endHour) return false;
  if (e.hour === config.endHour && e.minute > 0) return false;
  // No solapar el almuerzo.
  if (config.lunch) {
    const lunchStart = config.lunch.startHour * 60;
    const lunchEnd   = config.lunch.endHour * 60;
    const sMin = s.hour * 60 + s.minute;
    const eMin = e.hour * 60 + e.minute;
    if (sMin < lunchEnd && eMin > lunchStart) return false;
  }
  return true;
}

function getTimeParts(date: Date): { day: string; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.calendarTimeZone(),
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    hourCycle: 'h23',
    weekday:  'short',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    day:     `${value('year')}-${value('month')}-${value('day')}`,
    hour:    Number(value('hour')),
    minute:  Number(value('minute')),
    weekday: weekdayToNumber(value('weekday')),
  };
}

function weekdayToNumber(weekday: string): number {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}
