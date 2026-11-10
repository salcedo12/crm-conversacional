import { test, expect } from 'vitest';
import {
  availableLotsFromSummary,
  canRelease,
  checkReservable,
  parseArea,
  releaseFields,
  reservationFields,
  summaryEntry,
  toDealLot,
} from './inventory.logic';

const lot = {
  proyecto: 'laguna-mar',
  sector: 'MAR CANARIAS',
  numeroTerreno: '53',
  code: '110053',
  area: 313.6,
  esquinero: false,
  status: 'DISPONIBLE',
};

test('parseArea entiende números y textos con coma decimal', () => {
  expect(parseArea(300)).toBe(300);
  expect(parseArea('400,05')).toBe(400.05);
  expect(parseArea('1.258,40')).toBe(1258.4);
  expect(parseArea('313.60')).toBe(313.6);
  expect(parseArea(undefined)).toBe(0);
});

test('checkReservable: disponible sí; ocupado no; el mismo negocio puede renovar', () => {
  expect(checkReservable(lot, 'd1')).toEqual({ ok: true });
  expect(checkReservable(undefined, 'd1').ok).toBe(false);
  expect(checkReservable({ ...lot, status: 'vendido' }, 'd1')).toEqual({
    ok: false, reason: 'El lote ya no está disponible (estado: VENDIDO).',
  });
  expect(checkReservable({ ...lot, status: 'NEGOCIACION', crmDealId: 'otro' }, 'd1').ok).toBe(false);
  expect(checkReservable({ ...lot, status: 'NEGOCIACION', crmDealId: 'd1' }, 'd1').ok).toBe(true);
  // NEGOCIACION puesta a mano desde tour-meraki (sin negocio del CRM) tampoco se puede tomar.
  expect(checkReservable({ ...lot, status: 'NEGOCIACION' }, 'd1').ok).toBe(false);
});

test('canRelease solo libera lo apartado por el mismo negocio y nunca un vendido', () => {
  expect(canRelease({ ...lot, status: 'NEGOCIACION', crmDealId: 'd1' }, 'd1')).toBe(true);
  expect(canRelease({ ...lot, status: 'NEGOCIACION', crmDealId: 'd2' }, 'd1')).toBe(false);
  expect(canRelease({ ...lot, status: 'VENDIDO', crmDealId: 'd1' }, 'd1')).toBe(false);
  expect(canRelease(undefined, 'd1')).toBe(false);
});

test('reservationFields aparta 24 h en NEGOCIACION con el negocio del CRM', () => {
  const now = new Date('2026-10-27T15:00:00.000Z');
  const fields = reservationFields(now, { dealId: 'd1', companyId: 'c1', advisorName: 'Asesor' });
  expect(fields.status).toBe('NEGOCIACION');
  expect(fields.fechaVencimiento).toBe('2026-10-28T15:00:00.000Z');
  expect(fields.crmDealId).toBe('d1');
  expect(releaseFields(now)).toMatchObject({ status: 'DISPONIBLE', fechaVencimiento: '', crmDealId: '' });
});

test('summaryEntry produce la misma forma que syncProjectSummary', () => {
  expect(summaryEntry({ ...lot, ...reservationFields(new Date('2026-10-27T15:00:00Z'), { dealId: 'd1', companyId: 'c', advisorName: 'A' }) }))
    .toEqual({
      s: 'NEGOCIACION', a: 313.6, n: '53', sec: 'MAR CANARIAS', c: '110053', e: false, o: '',
      f: '2026-10-27T15:00:00.000Z', x: '2026-10-28T15:00:00.000Z',
    });
});

test('availableLotsFromSummary filtra disponibles y ordena por sector y número', () => {
  const result = availableLotsFromSummary({
    'laguna-mar-MARSANTORINI-2': { s: 'DISPONIBLE', n: '2', sec: 'MAR SANTORINI', a: 900 },
    'laguna-mar-MARCANARIAS-10': { s: 'DISPONIBLE', n: '10', sec: 'MAR CANARIAS', a: 300, e: true },
    'laguna-mar-MARCANARIAS-9': { s: 'disponible', n: '9', sec: 'MAR CANARIAS', a: 300 },
    'laguna-mar-MARCANARIAS-8': { s: 'VENDIDO', n: '8', sec: 'MAR CANARIAS', a: 300 },
  });
  expect(result.map((l) => l.id)).toEqual([
    'laguna-mar-MARCANARIAS-9', 'laguna-mar-MARCANARIAS-10', 'laguna-mar-MARSANTORINI-2',
  ]);
  expect(result[1].corner).toBe(true);
});

test('toDealLot copia los datos del lote al negocio', () => {
  expect(toDealLot('laguna-mar-MARCANARIAS-53', lot, '2026-10-28T15:00:00.000Z')).toEqual({
    projectId: 'laguna-mar',
    sector: 'MAR CANARIAS',
    lotNumber: '53',
    lotCode: '110053',
    inventoryLotId: 'laguna-mar-MARCANARIAS-53',
    areaM2: 313.6,
    corner: false,
    reservedUntil: '2026-10-28T15:00:00.000Z',
  });
});
