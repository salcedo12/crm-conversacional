import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface SchedulingConfig {
  workingDays:   number[];                                    // 0=domingo … 6=sábado
  startHour:     number;
  endHour:       number;
  slotMinutes:   number;
  lookaheadDays: number;
  minAdvanceMinutes: number;
  lunch:         { startHour: number; endHour: number } | null;
  colombianHolidays: boolean;                                 // festivos de Colombia automáticos
  workedHolidays: string[];                                   // claves de festivos que SÍ se trabajan
  holidays:      string[];                                    // cierres adicionales 'YYYY-MM-DD'
}

export interface ColombianHoliday {
  key:  string;
  name: string;
  date: string;  // 'YYYY-MM-DD'
}

const _get  = httpsCallable<{ companyId: string }, SchedulingConfig>(functions, 'getSchedulingConfig');
const _save = httpsCallable<{ companyId: string } & SchedulingConfig, { ok: boolean }>(functions, 'saveSchedulingConfig');
const _holidays = httpsCallable<Record<string, never>, { holidays: ColombianHoliday[] }>(functions, 'listColombianHolidays');

export async function fetchSchedulingConfig(companyId: string): Promise<SchedulingConfig> {
  const result = await _get({ companyId });
  return result.data;
}

export async function persistSchedulingConfig(companyId: string, cfg: SchedulingConfig): Promise<void> {
  await _save({ companyId, ...cfg });
}

export async function fetchColombianHolidays(): Promise<ColombianHoliday[]> {
  const result = await _holidays({});
  return result.data.holidays;
}
