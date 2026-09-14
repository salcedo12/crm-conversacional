import { describe, it, expect } from 'vitest';
import { localHourForPhone, isWithinCallWindow, nextCallWindowOpen, timezoneForPhone } from './phoneTimezone';

describe('phoneTimezone', () => {
  it('resuelve la zona por prefijo internacional', () => {
    expect(timezoneForPhone('+573001234567')).toBe('America/Bogota');       // Colombia
    expect(timezoneForPhone('+521234567890')).toBe('America/Mexico_City');  // México
    expect(timezoneForPhone('+34612345678')).toBe('Europe/Madrid');         // España
    expect(timezoneForPhone('+59391234567')).toBe('America/Guayaquil');     // Ecuador (3 díg antes que 5x)
    expect(timezoneForPhone('+12125551234')).toBe('America/New_York');      // EE.UU.
  });

  it('cae a la zona por defecto si el prefijo no se reconoce', () => {
    expect(timezoneForPhone('+9990000000')).toBe('America/Bogota');
  });

  it('calcula la hora local del lead (Colombia = UTC-5)', () => {
    // 2026-07-30 15:00 UTC → 10:00 en Bogotá
    const d = new Date('2026-07-30T15:00:00Z');
    expect(localHourForPhone('+573001234567', d)).toBe(10);
  });

  it('respeta la ventana diurna en la hora local del lead', () => {
    const day   = new Date('2026-07-30T15:00:00Z'); // Bogotá 10:00 → dentro de 8-18
    const night = new Date('2026-07-30T07:00:00Z'); // Bogotá 02:00 → fuera de 8-18
    expect(isWithinCallWindow('+573001234567', day, 8, 18)).toBe(true);
    expect(isWithinCallWindow('+573001234567', night, 8, 18)).toBe(false);
  });

  it('nextCallWindowOpen devuelve el mismo instante si ya está en ventana', () => {
    const day = new Date('2026-07-30T15:00:00Z');
    expect(nextCallWindowOpen('+573001234567', day, 8, 18).getTime()).toBe(day.getTime());
  });

  it('nextCallWindowOpen adelanta a la apertura si está fuera de ventana', () => {
    const night = new Date('2026-07-30T07:00:00Z'); // Bogotá 02:00
    const next  = nextCallWindowOpen('+573001234567', night, 8, 18);
    expect(isWithinCallWindow('+573001234567', next, 8, 18)).toBe(true);
    expect(next.getTime()).toBeGreaterThan(night.getTime());
  });
});
