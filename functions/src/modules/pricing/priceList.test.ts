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

// Bloque de aldeas de Sobre Montañas: tiene su propio encabezado más abajo en la hoja.
const CSV_WITH_ALDEAS = [
  CSV,
  'COLORADO,5,"300",,,$ 90.000.000,,,',
  'ALDEA,N°DE ALDEA,AREA DE GLAMPLING M2,0 MESES,12 MESES,12 MESES,18 MESES,24 MESES,',
  ',,,,,,,,',
  'AGUILA REAL,ALDEA 06,"30000,00",$ 109.910.000,,$ 118.910.000,$ 132.710.000,$ 153.380.000,',
  'LORO,ALDEA 17,"30000,00",$ 109.910.000,,$ 118.910.000,$ 132.710.000,$ 153.380.000,',
].join('\n');

test('las aldeas de Sobre Montañas usan las columnas de su propio encabezado', () => {
  const rows = parsePriceList(CSV_WITH_ALDEAS);
  expect(rows.find((r) => r.sector === 'AGUILA REAL')).toEqual({
    sector: 'AGUILA REAL', lot: 'ALDEA 06', areaM2: 30_000,
    prices: { 0: 109_910_000, 12: 118_910_000, 18: 132_710_000, 24: 153_380_000 },
  });
  // El encabezado de las aldeas no se cuela como una fila de precios.
  expect(rows.some((r) => r.sector === 'ALDEA')).toBe(false);
  expect(priceOptionsFor(rows, 'AGUILA REAL', '6')).toEqual([
    { termMonths: 0, price: 109_910_000 },
    { termMonths: 12, price: 118_910_000 },
    { termMonths: 18, price: 132_710_000 },
    { termMonths: 24, price: 153_380_000 },
  ]);
  expect(priceOptionsFor(rows, 'AGUILA REAL', 'ALDEA 06')).toHaveLength(4);
});

test('un sector no empareja con otro que solo lo contiene a medias (COLORADO ≠ LORO)', () => {
  const rows = parsePriceList(CSV_WITH_ALDEAS);
  expect(priceOptionsFor(rows, 'COLORADO', '17')).toEqual([]);
  expect(priceOptionsFor(rows, 'COLORADO', '5')).toEqual([{ termMonths: 0, price: 90_000_000 }]);
});
