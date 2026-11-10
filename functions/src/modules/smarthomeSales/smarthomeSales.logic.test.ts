import { test, expect } from 'vitest';
import type { SmartHomeProspect, SmartHomeUnit } from '../../integrations/smarthome/smarthome.client';
import { attachSiblingFiles, buildInventoryIndex, buildSaleDocs, cleanSector, crmProjectFor, inventoryKeyForUnit, inventoryOnlySales, pickBuyer } from './smarthomeSales.logic';

const unit = (over: Partial<SmartHomeUnit>): SmartHomeUnit => ({ moduleId: 'm1', status: 3, code: '1', name: '', unit: '', ...over });

test('reparte Llano Grande y Sobre Montañas desde Cañón de Arizona', () => {
  expect(crmProjectFor('cañon-arizona', unit({ unit: 'SAN ANTONIO - LLANO GRANDE' }))).toBe('llano-grande');
  // Sector sin "Llano Grande": lo delata el nombre del lote
  expect(crmProjectFor('cañon-arizona', unit({ unit: 'VALLE DE ABURRÁ', name: 'LOTE 02 SECTOR VALLE DE ABURRA CODIGO 0501002 - LLANO GRANDE ' }))).toBe('llano-grande');
  expect(crmProjectFor('cañon-arizona', unit({ unit: 'SOBRE MONTAÑAS', name: 'ALDEA 1 SECTOR GAVILAN SOBRE MONTAÑAS' }))).toBe('sobre-montañas');
  expect(crmProjectFor('cañon-arizona', unit({ unit: 'TEXAS', name: 'LOTE 5 SECTOR TEXAS - CANON DE ARIZONA' }))).toBe('cañon-arizona');
  expect(crmProjectFor('laguna-mar', unit({ unit: 'MAR SANTORINI' }))).toBe('laguna-mar');
});

test('limpia el sufijo y los espacios del sector', () => {
  expect(cleanSector(unit({ unit: 'SAN ANTONIO - LLANO GRANDE' }))).toBe('SAN ANTONIO');
  expect(cleanSector(unit({ unit: 'VALLE DE ABURRÁ- LLANO GRANDE' }))).toBe('VALLE DE ABURRÁ');
  expect(cleanSector(unit({ unit: 'VALLE DE ABURRÁ  -  LLANO GRANDE' }))).toBe('VALLE DE ABURRÁ');
  expect(cleanSector(unit({ unit: '' }))).toBe('SIN SECTOR');
});

test('el comprador es el prospecto en CIERRE, no el lead de captación', () => {
  const lead: SmartHomeProspect = { prospectId: 'lead', saleCycleName: 'CAPTACION ', probability: 100, createdDate: '2026-09-01' };
  const buyer: SmartHomeProspect = { prospectId: 'buyer', saleCycleName: 'CIERRE', probability: 100, createdDate: '2026-01-01' };
  expect(pickBuyer([lead, buyer])?.prospectId).toBe('buyer');
  expect(pickBuyer([])).toBeNull();
});

test('solo arma documentos de lotes vendidos o escriturados, con sus archivos', () => {
  const docs = buildSaleDocs(
    { code: '48c9266a', crmProjectId: 'laguna-mar' },
    [
      unit({ moduleId: 'a', status: 3, code: '53', unit: 'MAR CANARIAS', lotArea: 300 }),
      unit({ moduleId: 'b', status: 1, code: '54', unit: 'MAR CANARIAS' }),
      unit({ moduleId: 'c', status: 5, code: '55', unit: 'MAR CANARIAS' }),
    ],
    [{
      moduleId: 'a', prospectId: 'p1', firstName: 'Cristian', lastName: ' Gonzalez ', ownerId: 'u1', totalValue: 140,
      saleCycleName: 'CIERRE', files: [{ prospectFileId: 'f1', title: 'Cedula.pdf', path: null }],
    }],
    new Map([['u1', 'Asesor Uno']]),
  );
  expect(docs.map((d) => d.moduleId)).toEqual(['a', 'c']);
  expect(docs[0]).toMatchObject({ buyerName: 'Cristian Gonzalez', advisorName: 'Asesor Uno', value: 140, areaM2: 300, files: [{ id: 'f1', title: 'Cedula.pdf' }] });
  expect(docs[1]).toMatchObject({ unitStatusLabel: 'Escriturado', prospectId: '', files: [] });
});

test('un lote sin archivos toma los que el mismo comprador subió en otro lote', () => {
  const [conArchivos, sinArchivos, otroCliente] = buildSaleDocs(
    { code: '17c89d4e', crmProjectId: 'cañon-arizona' },
    [
      unit({ moduleId: 'a', code: '21', unit: 'LOS ANGELES' }),
      unit({ moduleId: 'b', code: '22', unit: 'LOS ANGELES' }),
      unit({ moduleId: 'c', code: '23', unit: 'LOS ANGELES' }),
    ],
    [
      { moduleId: 'a', prospectId: 'p1', customerId: 'cli1', files: [{ prospectFileId: 'f1', title: 'Cedula.pdf' }] },
      { moduleId: 'b', prospectId: 'p2', customerId: 'cli1', files: [] },
      { moduleId: 'c', prospectId: 'p3', customerId: 'cli2', files: [] },
    ],
    new Map(),
  ).map((doc, _i, all) => attachSiblingFiles(all).find((d) => d.moduleId === doc.moduleId)!);

  expect(conArchivos.files).toEqual([{ id: 'f1', title: 'Cedula.pdf' }]);
  expect(sinArchivos.files).toEqual([{ id: 'f1', title: 'Cedula.pdf', prospectId: 'p1', fromLot: 'LOS ANGELES · Lote 21' }]);
  expect(otroCliente.files).toEqual([]);
});

test('ignora las unidades comodín (cupo1 / sin sector ni nombre) aunque figuren vendidas', () => {
  const docs = buildSaleDocs(
    { code: '48c9266a', crmProjectId: 'laguna-mar' },
    [
      unit({ moduleId: 'real', code: '053', name: 'MAR CANARIAS 053', unit: 'MAR CANARIAS' }),
      unit({ moduleId: 'c1', code: 'cupo1', name: 'cupo1', unit: '' }),
      unit({ moduleId: 'c2', code: '01', name: 'CUPO 1', unit: '' }),
      unit({ moduleId: 'vacio', code: '0011', name: '', unit: '' }),
    ],
    [],
    new Map(),
  );
  expect(docs.map((d) => d.moduleId)).toEqual(['real']);
});

test('empareja con la disponibilidad por sector + número, aunque se escriban distinto', () => {
  const index = buildInventoryIndex({
    'llano-grande': { a: { sec: 'SAN ANTONIO', n: '77', s: 'TRAMITE' }, b: { sec: 'SAN ANTONIO', n: '78', s: 'VENDIDO' } },
    'laguna-mar': { c: { sec: 'MAR SANTORINI', n: '07B', s: 'VENDIDO' }, d: { sec: 'MAR SANTORINI', n: '7', s: 'DISPONIBLE' } },
    'arizona-2': { e: { sec: 'MONTE GRANDE', n: '12', s: 'VENDIDO' } },
    'sobre-montañas': { f: { sec: 'GUACAMAYAS', n: '4', s: 'DISPONIBLE' } },
  });
  const key = (u: Partial<SmartHomeUnit>) => inventoryKeyForUnit(unit(u));
  expect(index.get(key({ unit: 'SAN ANTONIO - LLANO GRANDE', name: 'LOTE 77 SECTOR SAN ANTONIO CODIGO 0504077 - LLANO GRANDE', code: '77' }))?.status).toBe('TRAMITE');
  expect(index.get(key({ unit: 'MAR SANTORINI', name: 'MAR SANTORINI 7B', code: '7B' }))?.status).toBe('VENDIDO');
  expect(index.get(key({ unit: 'MAR SANTORINI', name: 'MAR SANTORINI-007', code: '007' }))?.status).toBe('DISPONIBLE');
  expect(index.get(key({ unit: 'MONTEGRANDE ARIZONA 2', name: 'MONTE GRANDE 12', code: '12' }))?.status).toBe('VENDIDO');
  expect(index.get(key({ unit: 'SOBRE MONTAÑAS', name: 'ALDEA 4 SECTOR GUACAMAYAS SOBRE MONTAÑAS CODIGO: 701004', code: 'ALDEA 4' }))?.status).toBe('DISPONIBLE');
});

test('marca cada venta como coincide / no coincide / no está, y lista lo vendido solo en la disponibilidad', () => {
  const index = buildInventoryIndex({ 'cañon-arizona': {
    a: { sec: 'TEXAS', n: '29', s: 'DISPONIBLE' }, b: { sec: 'TEXAS', n: '30', s: 'VENDIDO' }, c: { sec: 'TEXAS', n: '31', s: 'VENDIDO' },
  } });
  const project = { code: '17c89d4e', crmProjectId: 'cañon-arizona' };
  const units = [
    unit({ moduleId: '29', status: 3, code: '29', unit: 'TEXAS', name: 'LOTE 29 SECTOR TEXAS' }),
    unit({ moduleId: '30', status: 3, code: '30', unit: 'TEXAS', name: 'LOTE 30 SECTOR TEXAS' }),
    unit({ moduleId: '99', status: 3, code: '99', unit: 'TEXAS', name: 'LOTE 99 SECTOR TEXAS' }),
    unit({ moduleId: '31', status: 1, code: '31', unit: 'TEXAS', name: 'LOTE 31 SECTOR TEXAS' }),
  ];
  const docs = buildSaleDocs(project, units, [], new Map(), index);
  expect(docs.map((d) => [d.moduleId, d.inventoryMatch, d.inventoryStatus])).toEqual([
    ['29', 'mismatch', 'DISPONIBLE'], ['30', 'ok', 'VENDIDO'], ['99', 'missing', null],
  ]);
  expect(inventoryOnlySales(project, units, index)).toEqual([
    { crmProjectId: 'cañon-arizona', sector: 'TEXAS', lotNumber: '31', lotName: 'LOTE 31 SECTOR TEXAS', smartHomeStatus: 'Disponible' },
  ]);
});
