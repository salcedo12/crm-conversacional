import { test, expect } from 'vitest';
import { numeroALetras, pesosEnLetras, formatoPesos } from './numeroALetras';
import { addMonths, fechaCorta, fechaEnLetras, formatDMY, parseCivilDate } from './civilDate';
import {
  computeEarnestMoney,
  expandRows,
  groupInstallments,
  rowsForEvenSplit,
  splitIntoInstallments,
  summarizePlan,
  termIssue,
} from './paymentPlan';
import type { PaymentPlan } from './deals.types';

// ── Letras: valores tal como aparecen en las plantillas 2026 ──────────────────

test('pesosEnLetras: millones exactos llevan "DE PESOS"', () => {
  expect(pesosEnLetras(145_000_000)).toBe('CIENTO CUARENTA Y CINCO MILLONES DE PESOS');
  expect(pesosEnLetras(139_000_000)).toBe('CIENTO TREINTA Y NUEVE MILLONES DE PESOS');
});

test('pesosEnLetras: apócope "un" antes de mil y millones', () => {
  expect(pesosEnLetras(2_241_950)).toBe('DOS MILLONES DOSCIENTOS CUARENTA Y UN MIL NOVECIENTOS CINCUENTA PESOS');
  expect(pesosEnLetras(41_958_600)).toBe('CUARENTA Y UN MILLONES NOVECIENTOS CINCUENTA Y OCHO MIL SEISCIENTOS PESOS');
  expect(pesosEnLetras(21_000_000)).toBe('VEINTIÚN MILLONES DE PESOS');
});

test('pesosEnLetras: casos comunes', () => {
  expect(pesosEnLetras(13_900_000)).toBe('TRECE MILLONES NOVECIENTOS MIL PESOS');
  expect(pesosEnLetras(43_500_000)).toBe('CUARENTA Y TRES MILLONES QUINIENTOS MIL PESOS');
  expect(pesosEnLetras(6_000_000)).toBe('SEIS MILLONES DE PESOS');
  expect(pesosEnLetras(1_000_000)).toBe('UN MILLÓN DE PESOS');
  expect(pesosEnLetras(1_579_990_000)).toBe('MIL QUINIENTOS SETENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA MIL PESOS');
});

test('numeroALetras: cien, ciento, mil y uno sin apócope', () => {
  expect(numeroALetras(100)).toBe('cien');
  expect(numeroALetras(101)).toBe('ciento uno');
  expect(numeroALetras(1000)).toBe('mil');
  expect(numeroALetras(2026)).toBe('dos mil veintiséis');
  expect(numeroALetras(21)).toBe('veintiuno');
  expect(numeroALetras(21, true)).toBe('veintiún');
  expect(() => numeroALetras(-1)).toThrow();
  expect(() => numeroALetras(1.5)).toThrow();
});

test('formatoPesos usa punto de miles', () => {
  expect(formatoPesos(145_000_000)).toBe('$ 145.000.000');
  expect(formatoPesos(0)).toBe('$ 0');
});

// ── Fechas ────────────────────────────────────────────────────────────────────

test('addMonths conserva el día y lo recorta en meses cortos', () => {
  expect(addMonths('2026-01-30', 1)).toBe('2026-02-28');
  expect(addMonths('2026-01-30', 2)).toBe('2026-03-30');
  expect(addMonths('2026-11-26', 3)).toBe('2027-02-26');
  expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
});

test('parseCivilDate rechaza fechas imposibles', () => {
  expect(() => parseCivilDate('2026-02-30')).toThrow();
  expect(() => parseCivilDate('30/05/2026')).toThrow();
});

test('fechas en el formato de los contratos', () => {
  expect(formatDMY('2026-05-30')).toBe('30/05/2026');
  expect(fechaCorta('2026-02-06')).toBe('06 DE FEBRERO DE 2026');
  expect(fechaEnLetras('2026-01-29').texto)
    .toBe('a los veintinueve (29) días del mes de enero (01) del año dos mil veintiséis (2026)');
  expect(fechaEnLetras('2026-03-21').diaLetras).toBe('veintiún');
  expect(fechaEnLetras('2026-03-01').texto).toBe('al primer (01) día del mes de marzo (03) del año dos mil veintiséis (2026)');
});

// ── Plan de pagos ─────────────────────────────────────────────────────────────

test('splitIntoInstallments deja el residuo en la primera cuota (como SmartHome)', () => {
  expect(splitIntoInstallments(134_272_461, 4)).toEqual([33_568_116, 33_568_115, 33_568_115, 33_568_115]);
  expect(splitIntoInstallments(6_000_000, 2)).toEqual([3_000_000, 3_000_000]);
  expect(() => splitIntoInstallments(100, 0)).toThrow();
});

test('rowsForEvenSplit arma las dos filas que muestra SmartHome', () => {
  expect(rowsForEvenSplit('ordinaria', 134_272_461, 4, '2026-11-26')).toEqual([
    { kind: 'ordinaria', count: 1, amount: 33_568_116, firstDate: '2026-11-26' },
    { kind: 'ordinaria', count: 3, amount: 33_568_115, firstDate: '2026-12-26' },
  ]);
  expect(rowsForEvenSplit('separacion', 6_000_000, 2, '2026-11-26')).toEqual([
    { kind: 'separacion', count: 2, amount: 3_000_000, firstDate: '2026-11-26' },
  ]);
});

/** Negocio de la captura de SmartHome: MAR CANARIAS 053, $140.272.461, 4 meses. */
const marCanarias053: PaymentPlan = {
  lotId: 'laguna-mar-MARCANARIAS-53',
  mode: 'simple',
  landValue: 140_272_461,
  termMonths: 4,
  benefit: 0,
  severance: null,
  rows: [
    ...rowsForEvenSplit('separacion', 6_000_000, 2, '2026-11-26'),
    ...rowsForEvenSplit('ordinaria', 134_272_461, 4, '2026-11-26'),
  ],
};

test('summarizePlan cuadra el negocio MAR CANARIAS 053', () => {
  const summary = summarizePlan(marCanarias053);
  expect(summary.totalLand).toBe(140_272_461);
  expect(summary.separationTotal).toBe(6_000_000);
  expect(summary.ordinaryTotal).toBe(134_272_461);
  expect(summary.extraordinaryTotal).toBe(0);
  expect(summary.installmentsTotal).toBe(140_272_461);
  expect(summary.difference).toBe(0);
  expect(summary.issues).toEqual([]);
  expect(summary.installments).toHaveLength(6);
});

test('summarizePlan avisa cuando faltan o sobran pesos', () => {
  const short = summarizePlan({ ...marCanarias053, landValue: 140_272_462 });
  expect(short.difference).toBe(1);
  expect(short.issues[0]).toMatch(/Faltan 1 pesos/);
  const over = summarizePlan({ ...marCanarias053, landValue: 140_272_460 });
  expect(over.issues[0]).toMatch(/superan/);
});

test('summarizePlan: beneficio resta del total y el bono debe igualarlo', () => {
  const plan: PaymentPlan = {
    lotId: 'canon-arizona-SANFRANCISCO-124',
    mode: 'especifico',
    landValue: 129_736_843,
    termMonths: 24,
    benefit: 20_000_000,
    severance: { fundName: 'Porvenir', amount: 10_000_000 },
    rows: [
      { kind: 'separacion', count: 1, amount: 6_000_000, firstDate: '2026-01-01' },
      ...rowsForEvenSplit('ordinaria', 93_736_843, 24, '2026-02-01'),
      { kind: 'bono', count: 1, amount: 20_000_000, firstDate: '2028-02-01' },
    ],
  };
  const summary = summarizePlan(plan);
  expect(summary.totalLand).toBe(109_736_843);
  expect(summary.difference).toBe(0);
  expect(summary.issues).toEqual([]);
  expect(summarizePlan({ ...plan, severance: { fundName: ' ', amount: 10_000_000 } }).issues)
    .toContain('Falta el nombre del fondo de cesantías.');
});

test('groupInstallments agrupa como la tabla de la promesa y corta en meses saltados', () => {
  const ordinarias = expandRows([
    { kind: 'ordinaria', count: 1, amount: 2_241_950, firstDate: '2026-05-30' },
    { kind: 'ordinaria', count: 5, amount: 2_241_935, firstDate: '2026-07-30' },
    { kind: 'ordinaria', count: 5, amount: 2_241_935, firstDate: '2027-01-30' },
  ]);
  expect(groupInstallments(ordinarias)).toEqual([
    { count: 1, amount: 2_241_950, from: '2026-05-30', to: '2026-05-30' },
    { count: 5, amount: 2_241_935, from: '2026-07-30', to: '2026-11-30' },
    { count: 5, amount: 2_241_935, from: '2027-01-30', to: '2027-05-30' },
  ]);
});

test('groupInstallments mantiene el día 30 después de febrero', () => {
  const cuotas = expandRows([{ kind: 'ordinaria', count: 3, amount: 1000, firstDate: '2027-01-30' }]);
  expect(cuotas.map((c) => c.date)).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
  expect(groupInstallments(cuotas)).toEqual([{ count: 3, amount: 1000, from: '2027-01-30', to: '2027-03-30' }]);
});

test('computeEarnestMoney: 30 % del precio por defecto', () => {
  expect(computeEarnestMoney(145_000_000)).toBe(43_500_000);
});

// ── Ficha legal por proyecto ──────────────────────────────────────────────────

test('vendedor por proyecto: Cañón = S+M, el resto = ZOMAC', async () => {
  const { getSellerForProject, getProjectLegalProfile } = await import('./legalProfiles');
  expect(getSellerForProject('cañon-arizona')?.nit).toBe('901590498-2');
  expect(getSellerForProject('canon-arizona')?.nit).toBe('901590498-2');
  for (const id of ['laguna-mar', 'rio-claro', 'llano-grande', 'sobre-montañas']) {
    expect(getSellerForProject(id)?.nit).toBe('901110049-0');
  }
  expect(getProjectLegalProfile('sobre-montañas')?.missingTexts).toEqual([]);
  expect(getProjectLegalProfile('arizona-1')).toBeNull();
});

test('buildSimpleRows arma el plan de la captura de SmartHome (MAR CANARIAS 053)', async () => {
  const { buildSimpleRows } = await import('./paymentPlan');
  const rows = buildSimpleRows(
    { separationTotal: 6_000_000, separationCount: 2, separationFirstDate: '2026-11-26', ordinaryCount: 4, ordinaryFirstDate: '2026-11-26', extraordinary: [] },
    { landValue: 140_272_461, benefit: 0, severance: 0 },
  );
  expect(rows).toEqual([
    { kind: 'separacion', count: 2, amount: 3_000_000, firstDate: '2026-11-26' },
    { kind: 'ordinaria', count: 1, amount: 33_568_116, firstDate: '2026-11-26' },
    { kind: 'ordinaria', count: 3, amount: 33_568_115, firstDate: '2026-12-26' },
  ]);
});

test('buildSimpleRows permite separaciones con valores y fechas independientes en modo simple', async () => {
  const { buildSimpleRows } = await import('./paymentPlan');
  const rows = buildSimpleRows(
    {
      separationTotal: 7_000_000,
      separationCount: 2,
      separationFirstDate: '2026-10-19',
      separationPayments: [
        { amount: 1_000_000, date: '2026-10-19' },
        { amount: 2_000_000, date: '2026-11-05' },
        { amount: 4_000_000, date: '2026-12-20' },
      ],
      ordinaryCount: 1,
      ordinaryFirstDate: '2027-01-20',
      extraordinary: [],
    },
    { landValue: 10_000_000, benefit: 0, severance: 0 },
  );

  expect(rows).toEqual([
    { kind: 'separacion', count: 1, amount: 1_000_000, firstDate: '2026-10-19' },
    { kind: 'separacion', count: 1, amount: 2_000_000, firstDate: '2026-11-05' },
    { kind: 'separacion', count: 1, amount: 4_000_000, firstDate: '2026-12-20' },
    { kind: 'ordinaria', count: 1, amount: 3_000_000, firstDate: '2027-01-20' },
  ]);
});

test('buildSimpleRows permite ordinarias por rangos con valores diferentes', async () => {
  const { buildSimpleRows } = await import('./paymentPlan');
  const rows = buildSimpleRows(
    {
      separationTotal: 6_000_000,
      separationCount: 1,
      separationFirstDate: '2026-10-27',
      ordinaryCount: 0,
      ordinaryFirstDate: '2026-12-27',
      ordinaryMode: 'rangos',
      ordinaryRanges: [
        { amount: 1_000_000, fromDate: '2026-12-27', toDate: '2027-05-27' },
        { amount: 2_000_000, fromDate: '2027-06-27', toDate: '2027-08-27' },
      ],
      extraordinary: [],
    },
    { landValue: 18_000_000, benefit: 0, severance: 0 },
  );

  expect(rows).toEqual([
    { kind: 'separacion', count: 1, amount: 6_000_000, firstDate: '2026-10-27' },
    { kind: 'ordinaria', count: 6, amount: 1_000_000, firstDate: '2026-12-27' },
    { kind: 'ordinaria', count: 3, amount: 2_000_000, firstDate: '2027-06-27' },
  ]);
});

test('buildSimpleRows descuenta extraordinarias, cesantías y agrega el bono al final', async () => {
  const { buildSimpleRows } = await import('./paymentPlan');
  const plan: PaymentPlan = {
    lotId: 'l', mode: 'simple', landValue: 145_000_000, termMonths: 20, benefit: 13_900_000,
    severance: { fundName: 'Protección', amount: 5_000_000 },
    rows: buildSimpleRows(
      {
        separationTotal: 6_000_000, separationCount: 1, separationFirstDate: '2026-05-30',
        ordinaryCount: 10, ordinaryFirstDate: '2026-06-30',
        extraordinary: [{ amount: 10_000_000, date: '2026-12-30' }, { amount: 10_000_000, date: '2027-06-30' }],
      },
      { landValue: 145_000_000, benefit: 13_900_000, severance: 5_000_000 },
    ),
  };
  const summary = summarizePlan(plan);
  expect(summary.ordinaryTotal).toBe(145_000_000 - 13_900_000 - 6_000_000 - 20_000_000 - 5_000_000);
  expect(summary.bonusTotal).toBe(13_900_000);
  expect(summary.difference).toBe(0);
  expect(summary.issues).toEqual([]);
  expect(plan.rows[plan.rows.length - 1]).toEqual({ kind: 'bono', count: 1, amount: 13_900_000, firstDate: '2027-07-30' });
});

test('draftStatusFor: plan listo solo con compradores, lote y plan válido de ese lote', async () => {
  const { draftStatusFor } = await import('./dealStatus');
  const lot = { projectId: 'laguna-mar', sector: 'MAR CANARIAS', lotNumber: '53', lotCode: '', inventoryLotId: 'laguna-mar-MARCANARIAS-53', areaM2: 313.6, corner: false };
  const base = { status: 'borrador' as const, buyers: [{ clientId: 'CC-1', order: 1 }], lot, plan: marCanarias053 };
  expect(draftStatusFor(base)).toBe('plan_listo');
  expect(draftStatusFor({ ...base, buyers: [] })).toBe('borrador');
  expect(draftStatusFor({ ...base, lot: null })).toBe('borrador');
  expect(draftStatusFor({ ...base, lot: { ...lot, inventoryLotId: 'otro' } })).toBe('borrador');
  expect(draftStatusFor({ ...base, plan: { ...marCanarias053, landValue: 1 } })).toBe('borrador');
  expect(draftStatusFor({ ...base, status: 'preventa_en_firma' as const })).toBe('preventa_en_firma');
});

test('canEditDealBuyers: borrador/plan_listo todos, en firma solo admin, anulado nadie', async () => {
  const { canEditDealBuyers } = await import('./dealStatus');
  expect(canEditDealBuyers('borrador', false)).toBe(true);
  expect(canEditDealBuyers('plan_listo', false)).toBe(true);
  expect(canEditDealBuyers('preventa_en_firma', false)).toBe(false);
  expect(canEditDealBuyers('preventa_en_firma', true)).toBe(true);
  expect(canEditDealBuyers('preventa_firmada', true)).toBe(true);
  expect(canEditDealBuyers('promesa_en_firma', true)).toBe(true);
  expect(canEditDealBuyers('promesa_firmada', true)).toBe(true);
  expect(canEditDealBuyers('anulado', false)).toBe(false);
  expect(canEditDealBuyers('anulado', true)).toBe(false);
});

test('canEditDealConditions: editable antes de promesa_firmada, admin en promesa_firmada, nunca en anulado', async () => {
  const { canEditDealConditions } = await import('./dealStatus');
  expect(canEditDealConditions('borrador', false)).toBe(true);
  expect(canEditDealConditions('plan_listo', false)).toBe(true);
  expect(canEditDealConditions('preventa_en_firma', false)).toBe(true);
  expect(canEditDealConditions('preventa_firmada', false)).toBe(true);
  expect(canEditDealConditions('promesa_en_firma', false)).toBe(true);
  expect(canEditDealConditions('promesa_firmada', false)).toBe(false);
  expect(canEditDealConditions('promesa_firmada', true)).toBe(true);
  expect(canEditDealConditions('anulado', false)).toBe(false);
  expect(canEditDealConditions('anulado', true)).toBe(false);
});

// ── Plazo: todas las cuotas deben caber desde la primera ordinaria ───────────

const plazo30 = expandRows([
  { kind: 'separacion', count: 2, amount: 3_000_000, firstDate: '2026-11-09' },
  { kind: 'ordinaria', count: 30, amount: 2_716_392, firstDate: '2027-01-09' },
  { kind: 'extraordinaria', count: 1, amount: 30_000_000, firstDate: '2027-07-09' },
  { kind: 'bono', count: 1, amount: 50_000_000, firstDate: '2029-07-09' },
]);

test('termIssue: 30 ordinarias desde ene 2027 caben en 30 meses (separación y bono no cuentan)', () => {
  expect(termIssue(plazo30, 30)).toBeNull();
});

test('termIssue: el último mes del plazo cuenta completo; el siguiente ya se pasa', () => {
  const extra = (date: string) => [...plazo30, { kind: 'extraordinaria' as const, amount: 10_000_000, date }];
  expect(termIssue(extra('2029-06-20'), 30)).toBeNull();
  expect(termIssue(extra('2029-07-01'), 30)).toBe(
    'Se pasa del plazo de 30 meses: 1 cuota queda después de jun 2029 (el plazo va de ene 2027 a jun 2029).',
  );
  expect(termIssue(extra('2032-10-12'), 30)).toContain('1 cuota queda después de jun 2029');
});

test('termIssue: más ordinarias que meses del plazo', () => {
  const rows = expandRows([{ kind: 'ordinaria', count: 32, amount: 1_000_000, firstDate: '2027-01-09' }]);
  expect(termIssue(rows, 30)).toContain('2 cuotas quedan después de jun 2029');
});

test('termIssue: sin plazo (de contado o manual) o sin ordinarias no revisa', () => {
  expect(termIssue(plazo30, 0)).toBeNull();
  expect(termIssue(expandRows([{ kind: 'separacion', count: 1, amount: 1, firstDate: '2026-11-09' }]), 30)).toBeNull();
});
