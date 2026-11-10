import { test, expect } from 'vitest';
import { normalizeSector, parsePriceList, priceOptionsFor } from './priceList';

// Encabezado y filas con el formato real del Sheet publicado.
const CSV = [
  'SECTOR,NUMERO DEL TERRENO,AREA M2,ESQUINERO, ESQUINERO,0    MESES, 20 MESES,30 MESES,40 MESES',
  'Mar Canarias,9,"351,9",ESQ.,,$ 141.094.100,$ 153.709.715,$ 157.914.920,$ 162.120.125',
  'Mar Canarias,53,"313,6",,,$ 124.950.400,$ 136.192.960,$ 139.940.480,$ 143.688.000',
  'LAGUNILLA,12,"300",,,$ 99.000.000,,,',
  'Sn.FRANCISCO,7,"400,5",,,$ 150.000.000,$ 160.000.000,,',
].join('\n');

test('parsePriceList lee sector, lote, área y precios por plazo', () => {
  const rows = parsePriceList(CSV);
  expect(rows).toHaveLength(4);
  expect(rows[1]).toEqual({
    sector: 'Mar Canarias', lot: '53', areaM2: 313.6,
    prices: { 0: 124_950_400, 20: 136_192_960, 30: 139_940_480, 40: 143_688_000 },
  });
  expect(rows[2].prices).toEqual({ 0: 99_000_000 });
});

test('normalizeSector unifica mayúsculas, tildes y "Sn."', () => {
  expect(normalizeSector('Mar Canarias')).toBe('MAR CANARIAS');
  expect(normalizeSector('Sn.FRANCISCO')).toBe('SAN FRANCISCO');
  expect(normalizeSector('Cañón')).toBe('CANON');
});

test('priceOptionsFor empareja el sector del inventario con el de la lista', () => {
  const rows = parsePriceList(CSV);
  expect(priceOptionsFor(rows, 'MAR CANARIAS', '053')).toEqual([
    { termMonths: 0, price: 124_950_400 },
    { termMonths: 20, price: 136_192_960 },
    { termMonths: 30, price: 139_940_480 },
    { termMonths: 40, price: 143_688_000 },
  ]);
  expect(priceOptionsFor(rows, 'RIO LAGUNILLA', '12')).toEqual([{ termMonths: 0, price: 99_000_000 }]);
  expect(priceOptionsFor(rows, 'SAN FRANCISCO', '7')).toHaveLength(2);
  expect(priceOptionsFor(rows, 'MAR SANTORINI', '9')).toEqual([]);
});
