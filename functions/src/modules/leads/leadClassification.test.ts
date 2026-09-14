import { describe, it, expect } from 'vitest';
import { isDirectAdvisorLead, countsAsBusinessLead, countsAs317LineLead } from './leadClassification';
import type { Lead } from './leads.types';

const lead = (partial: Partial<Lead>): Pick<Lead, 'source' | 'metadata'> => ({
  source: 'whatsapp',
  metadata: {},
  ...partial,
}) as Pick<Lead, 'source' | 'metadata'>;

describe('isDirectAdvisorLead', () => {
  it('detecta por fuente advisor_whatsapp (leads nuevos)', () => {
    expect(isDirectAdvisorLead(lead({ source: 'advisor_whatsapp' }))).toBe(true);
  });

  it('detecta por marca de metadata (leads antiguos aún con fuente whatsapp)', () => {
    expect(isDirectAdvisorLead(lead({ source: 'whatsapp', metadata: { advisorWhatsappMirror: 'true' } }))).toBe(true);
  });

  it('NO marca un lead normal del 317', () => {
    expect(isDirectAdvisorLead(lead({ source: 'whatsapp' }))).toBe(false);
    expect(isDirectAdvisorLead(lead({ source: 'meta_ads' }))).toBe(false);
    expect(isDirectAdvisorLead(lead({ source: 'manual' }))).toBe(false);
  });

  it('countsAsBusinessLead es el inverso', () => {
    expect(countsAsBusinessLead(lead({ source: 'whatsapp' }))).toBe(true);
    expect(countsAsBusinessLead(lead({ source: 'advisor_whatsapp' }))).toBe(false);
  });
});

describe('countsAs317LineLead', () => {
  it('cuenta pauta, formularios y WhatsApp directo al 317', () => {
    expect(countsAs317LineLead(lead({ source: 'meta_ads' }))).toBe(true);   // pauta
    expect(countsAs317LineLead(lead({ source: 'web' }))).toBe(true);        // formulario / botón web
    expect(countsAs317LineLead(lead({ source: 'whatsapp' }))).toBe(true);   // orgánico directo al 317
  });

  it('NO cuenta otros canales ni leads manuales', () => {
    expect(countsAs317LineLead(lead({ source: 'facebook' }))).toBe(false);
    expect(countsAs317LineLead(lead({ source: 'instagram' }))).toBe(false);
    expect(countsAs317LineLead(lead({ source: 'manual' }))).toBe(false);
  });

  it('NO cuenta el WhatsApp personal del asesor (por fuente o por marca de mirror)', () => {
    expect(countsAs317LineLead(lead({ source: 'advisor_whatsapp' }))).toBe(false);
    expect(countsAs317LineLead(lead({ source: 'whatsapp', metadata: { advisorWhatsappMirror: 'true' } }))).toBe(false);
  });
});
