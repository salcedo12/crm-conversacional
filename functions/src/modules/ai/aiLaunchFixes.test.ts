import { describe, expect, it } from 'vitest';
import { detectAppointmentModality, leadPreferredModality } from './aiOrchestrator.service';
import { buildConfirmation, buildReminder2h, buildReminder30m } from '../appointments/appointmentMessages';
import { bogotaDay, sumUsage } from './aiUsage.service';
import { detectsTransferKeyword } from './aiContext.service';

describe('modalidad de la cita', () => {
  it('detecta lo que pide el cliente', () => {
    expect(detectAppointmentModality('1 por Meet')).toBe('videollamada');
    expect(detectAppointmentModality('mejor una videollamada')).toBe('videollamada');
    expect(detectAppointmentModality('prefiero que me llamen')).toBe('llamada');
    expect(detectAppointmentModality('1')).toBeNull();
    expect(leadPreferredModality(['quiero por meet', '2'])).toBe('videollamada');
    expect(leadPreferredModality(['hola', '2'])).toBeNull();
  });
  it('los mensajes dicen lo mismo que la modalidad', () => {
    const start = new Date('2026-11-10T20:30:00Z');
    expect(buildConfirmation('Meraki', 'Ana', start)).toMatch(/llamada telefónica/);
    expect(buildConfirmation('Meraki', 'Ana', start)).not.toMatch(/enlace/);
    expect(buildConfirmation('Meraki', 'Ana', start, 'videollamada')).toMatch(/Google Meet/);
    expect(buildReminder2h('Meraki', 'Ana', start)).not.toMatch(/videollamada/);
    expect(buildReminder30m('Ana', 'https://meet.google.com/x', 'llamada')).not.toMatch(/meet\.google/);
    expect(buildReminder30m('Ana', 'https://meet.google.com/x', 'videollamada')).toMatch(/meet\.google/);
  });
});

describe('consumo y traspaso', () => {
  it('suma el uso del turno y usa el día de Bogotá', () => {
    expect(sumUsage([{ prompt_tokens: 10, completion_tokens: 2 }, undefined, { prompt_tokens: 5 }])).toEqual({ calls: 2, input: 15, output: 2 });
    expect(bogotaDay(new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
  });
  it('preguntar por el asesor de la cita no es pedir traspaso', () => {
    const k = ['hablar con un asesor', 'quiero un asesor', 'persona real'];
    expect(detectsTransferKeyword('¿Cuándo me llama el asesor?', k)).toBe(false);
    expect(detectsTransferKeyword('Quiero hablar con un asesor', k)).toBe(true);
  });
});

import { leadChosePaymentTerm } from './aiOrchestrator.service';
describe('todas las modalidades', () => {
  it('"dame todas las opciones" autoriza cotizar contado y plazos', () => {
    expect(leadChosePaymentTerm(['Dame todas las opciones'], 'efectivo')).toBe(true);
    expect(leadChosePaymentTerm(['contado y a plazos'], 'cuotas', 30)).toBe(true);
    expect(leadChosePaymentTerm(['si por favor'], 'cuotas', 30)).toBe(false);
  });
});

import { brochureClubChoice } from './aiOrchestrator.service';
describe('brochure por municipio o club', () => {
  it('elige el club del brochure', () => {
    expect(brochureClubChoice('Mariquita')).toBe('Río Claro');
    expect(brochureClubChoice('Melgar')).toBe('Laguna Mar');
    expect(brochureClubChoice('me interesa Cañón')).toBe('Cañón de Arizona');
    expect(brochureClubChoice('Alvarado')).toBeNull();
    expect(brochureClubChoice('Sobre Montañas')).toBeNull();
  });
});
