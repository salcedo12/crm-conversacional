import { describe, it, expect } from 'vitest';
import { extractColombianMobile } from './chatPhone';

describe('extractColombianMobile', () => {
  it('lee el celular en los formatos que escriben los clientes', () => {
    expect(extractColombianMobile('Este es mi número y es también WhatsApp  302 2062481')).toBe('+573022062481');
    expect(extractColombianMobile('3022062481')).toBe('+573022062481');
    expect(extractColombianMobile('mi cel es 302-206-2481 gracias')).toBe('+573022062481');
    expect(extractColombianMobile('+57 302 206 2481')).toBe('+573022062481');
    expect(extractColombianMobile('573022062481')).toBe('+573022062481');
    expect(extractColombianMobile('(302) 206 2481')).toBe('+573022062481');
  });

  it('no confunde precios ni otros números con un celular', () => {
    expect(extractColombianMobile('el lote vale $3022062481')).toBe('');
    expect(extractColombianMobile('presupuesto de 3.500.000.000')).toBe('');
    expect(extractColombianMobile('lote de 300 mts2 a 120 millones')).toBe('');
    expect(extractColombianMobile('cédula 1022062481')).toBe('');
    expect(extractColombianMobile('número 30220624811')).toBe('');
    expect(extractColombianMobile('')).toBe('');
    expect(extractColombianMobile(undefined)).toBe('');
  });

  it('si hay dos celulares distintos no adivina', () => {
    expect(extractColombianMobile('el mío 3022062481 o el de mi esposa 3109998877')).toBe('');
    expect(extractColombianMobile('3022062481, repito 302 206 2481')).toBe('+573022062481');
  });
});
