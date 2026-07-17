import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { getSchedulingConfig, saveSchedulingConfig } from '../modules/appointments/schedulingConfig';
import { getColombianHolidayList } from '../modules/appointments/colombianHolidays';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

const SaveSchema = z.object({
  companyId:     z.string().min(1),
  workingDays:   z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startHour:     z.number().int().min(0).max(23),
  endHour:       z.number().int().min(1).max(24),
  slotMinutes:   z.number().int().min(5).max(240),
  lookaheadDays: z.number().int().min(1).max(60),
  minAdvanceMinutes: z.number().int().min(0).max(10_080),
  lunch:         z.object({
    startHour: z.number().int().min(0).max(23),
    endHour:   z.number().int().min(1).max(24),
  }).nullable(),
  colombianHolidays: z.boolean(),
  workedHolidays: z.array(z.string().max(50)).max(30),
  holidays:      z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60),
}).refine((d) => d.endHour > d.startHour, {
  message: 'La hora de cierre debe ser mayor que la de apertura.',
}).refine((d) => !d.lunch || d.lunch.endHour > d.lunch.startHour, {
  message: 'El fin del almuerzo debe ser mayor que el inicio.',
});

// ─── getSchedulingConfig ──────────────────────────────────────────────────────

export const getSchedulingConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    return await getSchedulingConfig(companyId);
  }
);

// ─── saveSchedulingConfig ─────────────────────────────────────────────────────

export const saveSchedulingConfigCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const parse = SaveSchema.safeParse(request.data);
    if (!parse.success) {
      throw new HttpsError('invalid-argument', 'Datos inválidos: ' + parse.error.message);
    }

    const { companyId, ...cfg } = parse.data;
    assertCompany(ctx, companyId);

    await saveSchedulingConfig(companyId, cfg);
    logger.info('[Scheduling] Config de agenda guardada', { companyId });
    return { ok: true };
  }
);

// ─── listColombianHolidays ────────────────────────────────────────────────────
// Devuelve los festivos nacionales (con nombre, fecha y clave) del año actual y
// el siguiente, para mostrarlos en la config y elegir cuáles se trabajan.

export const listColombianHolidaysCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    requireAuth(request);
    const thisYear = new Date().getFullYear();
    return {
      holidays: [
        ...getColombianHolidayList(thisYear),
        ...getColombianHolidayList(thisYear + 1),
      ],
    };
  }
);
