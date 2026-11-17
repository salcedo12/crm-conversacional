import { test, expect } from 'vitest';
import PizZip from 'pizzip';
import { buildContractData, bogotaNow, dataHash } from './contractData';
import { docxText, renderContract } from './contractRenderer';
import { getProjectLegalProfile, SELLERS } from '../deals/legalProfiles';
import { buildSimpleRows } from '../deals/paymentPlan';
import type { ClientProfile, DealLot, PaymentPlan } from '../deals/deals.types';

// Datos ficticios.
const buyer = (n: number, extra: Partial<ClientProfile> = {}): ClientProfile => ({
  id: `CC-100000000${n}`, companyId: 'c', personKind: 'natural',
  firstNames: n === 1 ? 'Carlos Andrés' : 'Ana María', lastNames: n === 1 ? 'Prueba Uno' : 'Prueba Dos',
  birthDate: '1991-04-10', maritalStatus: 'casado', gender: n === 1 ? 'masculino' : 'femenino',
  residenceCity: 'Bogotá D.C.', address: 'Calle 123 # 45 - 67', identificationKind: 'CC',
  identificationNumber: `100000000${n}`, expeditionCity: 'Bogotá D.C.', expeditionDate: '2009-11-03',
  mobile: `+57300111223${n}`, email: `comprador${n}@meraki.test`, leadIds: [],
  createdAt: null as never, updatedAt: null as never, ...extra,
});

const lot: DealLot = {
  projectId: 'laguna-mar', sector: 'MAR CANARIAS', lotNumber: '9', lotCode: '110009',
  inventoryLotId: 'laguna-mar-MARCANARIAS-9', areaM2: 400.6, corner: false,
};

const simple = {
  separationTotal: 6_000_000, separationCount: 2, separationFirstDate: '2026-10-27',
  ordinaryCount: 20, ordinaryFirstDate: '2026-12-27',
  extraordinary: [{ amount: 10_000_000, date: '2027-06-27' }, { amount: 10_000_000, date: '2027-12-27' }],
};
const plan: PaymentPlan = {
  lotId: lot.inventoryLotId, mode: 'simple', simple, landValue: 153_709_715, termMonths: 20,
  benefit: 10_000_000, severance: { fundName: 'Porvenir', amount: 5_000_000 },
  rows: buildSimpleRows(simple, { landValue: 153_709_715, benefit: 10_000_000, severance: 5_000_000 }),
  referredBy: 'Referido de prueba', notes: 'Se obsequian planos arquitectónicos tipo 2',
};

function data(projectId: string, buyers = [buyer(1), buyer(2)], l: DealLot = lot) {
  const profile = getProjectLegalProfile(projectId)!;
  return buildContractData({
    buyers, lot: { ...l, projectId }, plan, profile, seller: SELLERS[profile.seller],
    advisorName: 'Asesor Pruebas', issuedAt: { date: '2026-10-27', time: '09:15:00 AM' },
  });
}

test('buildContractData arma totales, letras y cuotas agrupadas', () => {
  const d = data('laguna-mar');
  expect(d['plan.valorTerreno']).toBe('$ 153.709.715');
  expect(d['plan.totalTerreno']).toBe('$ 143.709.715');
  expect(d['plan.saldo']).toBe('$ 142.709.715');                 // valor − separación − cesantías
  expect(d['plan.arras']).toBe('$ 46.112.915');                  // 30 %
  expect(d['plan.separacionLetras']).toBe('SEIS MILLONES DE PESOS');
  expect(d['plan.numeroCuotas']).toBe('20');
  expect(d['plan.tieneBono']).toBe(true);
  expect(d.gruposOrdinarias).toEqual([
    { n: '1', fechas: '27/12/2026', valorLetras: 'CINCO MILLONES SEISCIENTOS TREINTA Y CINCO MIL QUINIENTOS PESOS', valor: '$\u00a05.635.500' },
    { n: '19', fechas: '27/01/2027 a 27/07/2028', valorLetras: 'CINCO MILLONES SEISCIENTOS TREINTA Y CINCO MIL CUATROCIENTOS OCHENTA Y CINCO PESOS', valor: '$\u00a05.635.485' },
  ]);
  expect((d.filasCuotas as unknown[]).length).toBe(2);
  expect(d.separacionPagos).toEqual([
    { valor: '$\u00a03.000.000', fecha: '27/10/2026', total: '$\u00a06.000.000', esPrimera: true },
    { valor: '$\u00a03.000.000', fecha: '27/11/2026', total: '$\u00a06.000.000', esPrimera: false },
  ]);
  expect(d['fecha.texto']).toBe('a los veintisiete (27) días del mes de octubre (10) del año dos mil veintiséis (2026)');
  expect(d['titular.nombreCompleto']).toBe('CARLOS ANDRÉS PRUEBA UNO');
});

test('promesa crea y combina una fila por cada pago de separación', () => {
  const fourSeparations = {
    ...simple,
    separationTotal: 12_000_000,
    separationCount: 4,
  };
  const fourPlan: PaymentPlan = {
    ...plan,
    simple: fourSeparations,
    rows: buildSimpleRows(fourSeparations, {
      landValue: plan.landValue,
      benefit: plan.benefit,
      severance: plan.severance!.amount,
    }),
  };
  const profile = getProjectLegalProfile('laguna-mar')!;
  const contractData = buildContractData({
    buyers: [buyer(1)], lot, plan: fourPlan, profile, seller: SELLERS.zomac,
    advisorName: 'Asesor Pruebas', issuedAt: { date: '2026-10-27', time: '09:15:00 AM' },
  });
  const buffer = renderContract('promesa', contractData);
  const xml = new PizZip(buffer).file('word/document.xml')!.asText();
  const text = docxText(buffer);

  expect(text.match(/VALOR DE LA SEPARACIÓN/g)).toHaveLength(1);
  for (const date of ['27/10/2026', '27/11/2026', '27/12/2026', '27/01/2027']) {
    expect(text).toContain(date);
  }
  expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect((xml.match(/<w:vMerge(?: [^>]*)?\/>/g) ?? []).length).toBeGreaterThanOrEqual(8);
});

test('la huella cambia si cambia cualquier dato', () => {
  expect(dataHash(data('laguna-mar'))).toBe(dataHash(data('laguna-mar')));
  expect(dataHash(data('laguna-mar'))).not.toBe(dataHash(data('rio-claro')));
});

test('bogotaNow usa la hora de Colombia', () => {
  expect(bogotaNow(new Date('2026-10-28T03:30:00Z'))).toEqual({ date: '2026-10-27', time: '10:30:00 PM' });
});

test('preventa de Laguna Mar: dos compradores, ZOMAC y plan completo', () => {
  const text = docxText(renderContract('preventa', data('laguna-mar')));
  expect(text).not.toMatch(/[{}]/);
  expect(text.match(/CARLOS ANDRÉS PRUEBA UNO/g)!.length).toBeGreaterThanOrEqual(5);
  expect(text.match(/ANA MARÍA PRUEBA DOS/g)!.length).toBeGreaterThanOrEqual(5); // 4 tablas + recuadro de firma
  expect(text).toContain('GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC');
  expect(text).not.toContain('S+M SAS');
  expect(text).toContain('TERRENO No. 9 – ETAPA/SECTOR MAR CANARIAS CIUDAD COUNTRY LAGUNA MAR BUNGALOW COLIVING CLUB ubicado en el municipio de MELGAR');
  expect(text).toContain('SEIS MILLONES DE PESOS ($\u00a06.000.000)');
  expect(text).toContain('$\u00a05.635.485');
  expect(text).toContain('Referido de prueba');
  expect(text).toContain('Se obsequian planos arquitectónicos tipo 2');
  expect(text).toContain('TOTAL ORDINARIAS');
  expect(text).toContain('Convenio Banco Davivienda 1171362');
  expect(text).toContain('Mayor(es) de edad, identificado(s) como anteriormente se detalla');
});

test('preventa oculta las filas vacías de cada grupo de cuotas', () => {
  const contractData = data('laguna-mar');
  const original = contractData.filasCuotas as Array<Record<string, unknown>>;
  contractData.filasCuotas = Array.from({ length: 6 }, (_, index) => ({
    sepN: index < 2 ? original[index].sepN : '',
    sepValor: index < 2 ? original[index].sepValor : '',
    sepFecha: index < 2 ? original[index].sepFecha : '',
    ordN: index < 2 ? original[index].ordN : '',
    ordValor: index < 2 ? original[index].ordValor : '',
    ordFecha: index < 2 ? original[index].ordFecha : '',
    extN: '1', extValor: '$\u00a05.000.000', extFecha: `0${index + 1}/01/2027`,
  }));

  const xml = new PizZip(renderContract('preventa', contractData)).file('word/document.xml')!.asText();
  // Cuatro filas sobrantes × ocho celdas (incluidos los separadores), con bordes anulados.
  expect((xml.match(/<w:tcBorders><w:top w:val="nil"\/>/g) ?? []).length).toBeGreaterThanOrEqual(32);
});

test('preventa de Cañón: firma de S+M y convenio de S+M', () => {
  const text = docxText(renderContract('preventa', data('cañon-arizona', [buyer(1)])));
  expect(text).not.toMatch(/[{}]/);
  expect(text).toContain('COMPAÑÍA CONSTRUCTORA MERAKI S+M S.A.S');
  expect(text).toContain('COMPAÑÍA CONSTRUCTORA MERAKI S+M SAS');   // bloque de firma
  expect(text).toContain('Convenio Banco Davivienda 1488121');
  expect(text).not.toContain('ANA MARÍA');
});

test('promesa de Laguna Mar: solo los textos de Laguna Mar y de ZOMAC', () => {
  const text = docxText(renderContract('promesa', data('laguna-mar')));
  expect(text).not.toMatch(/[{}]/);
  expect(text).not.toContain('(Texto para');
  expect(text).toContain('MONTECRISTO');                            // linderos de Laguna Mar
  expect(text).not.toContain('EL BALSO');                           // Río Claro
  expect(text).not.toContain('SAN MIGUEL');                         // Cañón
  expect(text).toContain('Entre los suscritos a saber GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC');
  expect(text).not.toContain('Entre los suscritos a saber COMPAÑÍA CONSTRUCTORA MERAKI S+M');
  expect(text).toContain('168770042765');                           // cuenta ZOMAC
  expect(text).not.toContain('108900237588');
  expect(text).toContain('ETAPA MAR CANARIAS, ubicado');
  expect(text).toContain('CIENTO CINCUENTA Y TRES MILLONES SETECIENTOS NUEVE MIL SETECIENTOS QUINCE PESOS M/CTE ($\u00a0153.709.715)');
  expect(text).toContain('PLAZO TOTAL DE (20) MESES');
  expect(text).toContain('27/01/2027 a 27/07/2028');
  expect(text).toContain('Cuota bono descuento');
  expect(text).toContain('CUARENTA Y SEIS MILLONES CIENTO DOCE MIL NOVECIENTOS QUINCE PESOS');
  expect(text).toContain('a los 27 días del mes de octubre del año 2026');
});

test('promesa de Cañón: textos de Cañón y de S+M, sin bono si no hay beneficio', () => {
  const noBenefit = { ...plan, benefit: 0, rows: buildSimpleRows(simple, { landValue: plan.landValue, benefit: 0, severance: 5_000_000 }) };
  const profile = getProjectLegalProfile('cañon-arizona')!;
  const d = buildContractData({
    buyers: [buyer(1)], lot: { ...lot, projectId: 'cañon-arizona', sector: 'TEXAS' }, plan: noBenefit, profile,
    seller: SELLERS.sm, advisorName: 'Asesor', issuedAt: { date: '2026-10-27', time: '09:00:00 AM' },
  });
  const text = docxText(renderContract('promesa', d));
  expect(text).not.toMatch(/[{}]/);
  expect(text).toContain('SAN MIGUEL');
  expect(text).not.toContain('MONTECRISTO');
  expect(text).toContain('Entre los suscritos a saber COMPAÑÍA CONSTRUCTORA MERAKI S+M');
  expect(text).toContain('108900237588');
  expect(text).not.toContain('Cuota bono descuento');
  expect(text).toContain('área administrativa del COMPAÑÍA CONSTRUCTORA MERAKI S+M S.A.S,');
});

test('promesa de Llano Grande y Río Claro llevan sus propios linderos', () => {
  const llano = docxText(renderContract('promesa', data('llano-grande')));
  expect(llano).toContain('Goteras');
  expect(llano).not.toContain('MONTECRISTO');
  const rio = docxText(renderContract('promesa', data('rio-claro')));
  expect(rio).toContain('EL BALSO');
  expect(rio).not.toContain('Goteras');
});

test('firmas: el recuadro original se repite por comprador con su tipo de documento real', () => {
  const pasaporte = buyer(2, { identificationKind: 'PAS', identificationNumber: 'AB123456', expeditionCity: 'Madrid' });
  for (const kind of ['preventa', 'promesa'] as const) {
    const text = docxText(renderContract(kind, data('laguna-mar', [buyer(1), pasaporte])));
    expect(text).toContain('CÉDULA DE CIUDADANÍA:1000000001');
    expect(text).toContain('PASAPORTE:AB123456');
    expect(text).toContain('MADRID');
    expect(text).not.toContain('CEDÚLA DE CIUDADANIA');             // ya no queda fija
  }
});

test('firma del vendedor de la preventa: bloque de S+M solo en Cañón', () => {
  expect(docxText(renderContract('preventa', data('cañon-arizona', [buyer(1)])))).toContain('COMPAÑÍA CONSTRUCTORA MERAKI S+M SAS');
  expect(docxText(renderContract('preventa', data('laguna-mar', [buyer(1)])))).not.toContain('COMPAÑÍA CONSTRUCTORA MERAKI S+M SAS');
});

test('separación: cada cuota con su fecha en la promesa', () => {
  const d = data('laguna-mar');
  expect(d['plan.separacionCuotas']).toBe('$\u00a03.000.000\n$\u00a03.000.000');
  expect(d['plan.separacionFechas']).toBe('27/10/2026\n27/11/2026');
});

test('Sobre Montañas tiene perfil legal completo sin textos faltantes', () => {
  const profile = getProjectLegalProfile('sobre-montañas')!;
  expect(profile).toBeTruthy();
  expect(profile.projectId).toBe('sobre-montanas');
  expect(profile.templateVariant).toBe('sobre_montanas');
  expect(profile.seller).toBe('zomac');
  expect(profile.municipality).toBe('ALVARADO');
  expect(profile.earnestPercent).toBe(30);
  expect(profile.missingTexts).toEqual([]);
});

test('preventa de Sobre Montañas: común y proindiviso, ZOMAC NIT 901110049-0 y variables reales', () => {
  const smLot = {
    ...lot,
    projectId: 'sobre-montanas',
    projectName: 'SOBRE MONTAÑAS',
    sector: 'ALDEA CONDOR',
    lotNumber: '16',
    lotCode: '701016',
    areaM2: 1258,
  };
  const profile = getProjectLegalProfile('sobre-montanas')!;
  const contractData = buildContractData({
    buyers: [buyer(1), buyer(2)],
    lot: smLot,
    plan,
    profile,
    seller: SELLERS[profile.seller],
    advisorName: 'Asesor Pruebas',
    issuedAt: { date: '2026-10-27', time: '09:15:00 AM' },
  });
  const text = docxText(renderContract('preventa', contractData, profile.templateVariant));

  expect(text).not.toMatch(/[{}]/);
  expect(text).toContain('COMPRAVENTA DE BIEN INMUEBLE COMÚN Y PROINDIVISO');
  expect(text).toContain('CONTRATO DE PREVENTA DE BIEN INMUEBLE COMÚN Y PROINDIVISO');
  expect(text).toContain('finca denominada NAPOLES');
  expect(text).toContain('pozo séptico, energía solar y acueducto veredal');
  expect(text).toContain('GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC');
  expect(text).toContain('901110049-0');
  expect(text).toContain('TERRENO No. 16 – ETAPA/SECTOR ALDEA CONDOR SOBRE MONTAÑAS');
  expect(text).toContain('Convenio Banco Davivienda 1171362');
  expect(text).toContain('TOTAL ORDINARIAS');
  expect(text).toContain('Mayor(es) de edad, identificado(s) como anteriormente se detalla');
  expect(text).not.toContain('901110049-1');
  expect(text).not.toContain('propiedad horizontal');
  expect(text).not.toContain('BATMAN');
  expect(text).not.toContain('PEPITO');
  expect(text).not.toContain('JUANA MARÍA');
  expect(text).not.toContain('Mar Santorini');
  expect(text).not.toContain('30.000 m2');
});

test('promesa de Sobre Montañas: participación en derecho de dominio, Finca Nápoles y arras/cuotas dinámicas', () => {
  const smLot = {
    ...lot,
    projectId: 'sobre-montanas',
    projectName: 'SOBRE MONTAÑAS',
    sector: 'ALDEA CONDOR',
    lotNumber: '16',
    lotCode: '701016',
    areaM2: 1258,
  };
  const profile = getProjectLegalProfile('sobre-montanas')!;
  const contractData = buildContractData({
    buyers: [buyer(1), buyer(2)],
    lot: smLot,
    plan,
    profile,
    seller: SELLERS[profile.seller],
    advisorName: 'Asesor Pruebas',
    issuedAt: { date: '2026-10-27', time: '09:15:00 AM' },
  });
  const buffer = renderContract('promesa', contractData, profile.templateVariant);
  const xml = new PizZip(buffer).file('word/document.xml')!.asText();
  const text = docxText(buffer);

  expect(text).not.toMatch(/[{}]/);
  expect(text).toContain('CONTRATO DE COMPRAVENTA DE PARTICIPACIÓN EN DERECHO DE DOMINIO SOBRE PREDIO RURAL');
  expect(text).toContain('predio rural de mayor extensión denominado "NAPOLES"');
  expect(text).toContain('vereda DOYARE');
  expect(text).toContain('350-75661');
  expect(text).toContain('0001-0048-000');
  expect(text).toContain('participación que corresponde a un área aproximada de 1.258 m2');
  expect(text).toContain('NÚMERO DE REFERENCIA: 701016');
  expect(text).toContain('168770042765');
  expect(text).toContain('CARLOS ANDRÉS PRUEBA UNO');
  expect(text).toContain('ANA MARÍA PRUEBA DOS');
  expect(text).toContain('CUARENTA Y SEIS MILLONES CIENTO DOCE MIL NOVECIENTOS QUINCE PESOS');
  expect(text).toContain('a los 27 días del mes de octubre del año 2026');
  // Merge vertical de separación funciona sobre T2 igual que en la promesa estándar
  expect(text.match(/VALOR DE LA SEPARACIÓN/g)).toHaveLength(1);
  expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBeGreaterThanOrEqual(1);
  // Sin texto de PH ni de otros proyectos ni datos de muestra
  expect(text).not.toContain('MONTECRISTO');
  expect(text).not.toContain('EL BALSO');
  expect(text).not.toContain('Goteras');
  expect(text).not.toContain('S+M SAS');
  expect(text).not.toContain('BATMAN');
  expect(text).not.toContain('PEPITO');
  expect(text).not.toContain('Mar Santorini');
  expect(text).not.toContain('30,000 metros cuadrados');
});
