import { describe, it, expect } from 'vitest';
import { matchPlano, planoFileName, type PlanoIndexItem } from './planos.service';

// Muestra real del índice (endpoint planosIndex), recortada a lo que usa el matcher.
const INDEX: PlanoIndexItem[] = [
  { planoId: 'cañon-arizona', projectId: 'cañon-arizona', projectName: 'Cañon de Arizona', stageName: null,           name: 'Cañon de Arizona', url: 'https://x/canon.pdf',     generatedAt: null },
  { planoId: 'llano-grande',  projectId: 'llano-grande',  projectName: 'Llano Grande',      stageName: null,           name: 'Llano Grande',     url: 'https://x/llano.pdf',     generatedAt: null },
  { planoId: 'mar-canarias',  projectId: 'laguna-mar',    projectName: 'Laguna Mar',        stageName: 'Mar Canarias', name: 'Mar Canarias',     url: 'https://x/canarias.pdf',  generatedAt: null },
  { planoId: 'mar-santorini', projectId: 'laguna-mar',    projectName: 'Laguna Mar',        stageName: 'Mar Santorini',name: 'Mar Santorini',    url: 'https://x/santorini.pdf', generatedAt: null },
  { planoId: 'rio-claro',     projectId: 'rio-claro',     projectName: 'Río Claro',         stageName: null,           name: 'Río Claro',        url: 'https://x/rio.pdf',       generatedAt: null },
  { planoId: 'sobre-montañas',projectId: 'sobre-montañas',projectName: 'Sobre Montañas',    stageName: null,           name: 'Sobre Montañas',   url: 'https://x/sobre.pdf',     generatedAt: null },
];

describe('matchPlano', () => {
  it('empareja un club sin importar acentos, mayúsculas ni el nombre comercial largo', () => {
    // Nombre completo como lo diría el prompt / la IA.
    const m = matchPlano(INDEX, 'Cañón de Arizona Bungalow Luxury Club');
    expect(m.status).toBe('ok');
    if (m.status === 'ok') expect(m.plano.planoId).toBe('cañon-arizona');
  });

  it('empareja "rio claro" (sin tilde) con "Río Claro"', () => {
    const m = matchPlano(INDEX, 'rio claro');
    expect(m.status).toBe('ok');
    if (m.status === 'ok') expect(m.plano.planoId).toBe('rio-claro');
  });

  it('para Laguna Mar sin etapa pide elegir la etapa', () => {
    const m = matchPlano(INDEX, 'Ciudad Country Laguna Mar');
    expect(m.status).toBe('need_stage');
    if (m.status === 'need_stage') {
      expect(m.projectName).toBe('Laguna Mar');
      expect(m.stages).toEqual(expect.arrayContaining(['Mar Santorini', 'Mar Canarias']));
    }
  });

  it('para Laguna Mar con etapa envía el plano de esa etapa', () => {
    const m = matchPlano(INDEX, 'Laguna Mar', 'Santorini');
    expect(m.status).toBe('ok');
    if (m.status === 'ok') expect(m.plano.planoId).toBe('mar-santorini');
  });

  it('un club inexistente devuelve la lista de disponibles', () => {
    const m = matchPlano(INDEX, 'Club Inventado');
    expect(m.status).toBe('not_found');
    if (m.status === 'not_found') expect(m.available).toContain('Laguna Mar');
  });

  it('el nombre de archivo incluye la etapa cuando aplica', () => {
    expect(planoFileName(INDEX[3])).toBe('Plano Laguna Mar - Mar Santorini.pdf');
    expect(planoFileName(INDEX[1])).toBe('Plano Llano Grande.pdf');
  });
});
