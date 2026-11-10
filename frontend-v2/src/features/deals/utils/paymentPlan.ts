/**
 * Copia para la vista previa del plan de functions/src/modules/deals/paymentPlan.ts
 * (y addMonths de civilDate.ts). El backend revalida todo al guardar con `summarizePlan`,
 * así que si algo difiere manda el backend. Mantener ambas en sincronía.
 */

export type InstallmentKind = 'separacion' | 'ordinaria' | 'extraordinaria' | 'bono';

export interface PlanRow {
  kind:      InstallmentKind;
  count:     number;
  amount:    number;
  firstDate: string;   // 'YYYY-MM-DD'
}

export interface Installment {
  kind:   InstallmentKind;
  amount: number;
  date:   string;
}

export interface SimpleInputs {
  separationTotal:     number;
  separationCount:     number;
  separationFirstDate: string;
  /** Pagos de separación con valor y fecha propios. Ausente en planes antiguos. */
  separationPayments?: Array<{ amount: number; date: string }>;
  ordinaryCount:       number;
  ordinaryFirstDate:   string;
  ordinaryMode?:       'automatico' | 'rangos';
  ordinaryRanges?:     Array<{ amount: number; fromDate: string; toDate: string }>;
  extraordinary:       Array<{ amount: number; date: string }>;
}

const KIND_ORDER: Record<InstallmentKind, number> = { separacion: 0, ordinaria: 1, extraordinaria: 2, bono: 3 };
const pad = (n: number) => String(n).padStart(2, '0');

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function addMonths(value: string, months: number): string {
  const [y, m, d] = value.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

export function formatDMY(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

export function splitIntoInstallments(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const amounts = Array<number>(count).fill(base);
  amounts[0] += total - base * count;
  return amounts;
}

export function rowsForEvenSplit(kind: InstallmentKind, total: number, count: number, firstDate: string): PlanRow[] {
  const amounts = splitIntoInstallments(total, count);
  if (count === 1 || amounts[0] === amounts[1]) {
    return [{ kind, count, amount: amounts[1] ?? amounts[0], firstDate }];
  }
  return [
    { kind, count: 1, amount: amounts[0], firstDate },
    { kind, count: count - 1, amount: amounts[1], firstDate: addMonths(firstDate, 1) },
  ];
}

/** Número de pagos mensuales entre dos fechas, ambas incluidas. Retorna 0 si no pertenecen a la misma secuencia mensual. */
export function monthlyInstallmentCount(fromDate: string, toDate: string): number {
  if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) return 0;
  for (let index = 0; index < 240; index++) {
    const date = addMonths(fromDate, index);
    if (date === toDate) return index + 1;
    if (date > toDate) return 0;
  }
  return 0;
}

export function expandRows(rows: PlanRow[]): Installment[] {
  const out: Installment[] = [];
  for (const row of rows) {
    if (row.count <= 0 || row.amount <= 0 || !isValidDate(row.firstDate)) continue;
    for (let i = 0; i < row.count; i++) out.push({ kind: row.kind, amount: row.amount, date: addMonths(row.firstDate, i) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export interface InstallmentGroup { count: number; amount: number; from: string; to: string }

export function groupInstallments(installments: Installment[]): InstallmentGroup[] {
  const groups: InstallmentGroup[] = [];
  for (const item of installments) {
    const last = groups[groups.length - 1];
    if (last && last.amount === item.amount && addMonths(last.from, last.count) === item.date) {
      last.count += 1;
      last.to = item.date;
    } else {
      groups.push({ count: 1, amount: item.amount, from: item.date, to: item.date });
    }
  }
  return groups;
}

export function buildSimpleRows(
  inputs: SimpleInputs,
  amounts: { landValue: number; benefit: number; severance: number },
): PlanRow[] {
  const rows: PlanRow[] = [];
  const separationPayments = inputs.separationPayments;
  if (separationPayments !== undefined) {
    for (const payment of separationPayments) {
      if (payment.amount > 0 && isValidDate(payment.date)) {
        rows.push({ kind: 'separacion', count: 1, amount: payment.amount, firstDate: payment.date });
      }
    }
  } else if (inputs.separationTotal > 0 && inputs.separationCount > 0 && isValidDate(inputs.separationFirstDate)) {
    rows.push(...rowsForEvenSplit('separacion', inputs.separationTotal, inputs.separationCount, inputs.separationFirstDate));
  }
  const separationTotal = separationPayments !== undefined
    ? separationPayments.reduce((acc, payment) => acc + payment.amount, 0)
    : inputs.separationTotal;
  const extraTotal = inputs.extraordinary.reduce((acc, e) => acc + e.amount, 0);
  for (const e of inputs.extraordinary) {
    if (e.amount > 0 && isValidDate(e.date)) rows.push({ kind: 'extraordinaria', count: 1, amount: e.amount, firstDate: e.date });
  }
  const ordinaryTotal = amounts.landValue - amounts.benefit - separationTotal - extraTotal - amounts.severance;
  if (inputs.ordinaryMode === 'rangos') {
    for (const range of inputs.ordinaryRanges ?? []) {
      const count = monthlyInstallmentCount(range.fromDate, range.toDate);
      if (range.amount > 0 && count > 0) {
        rows.push({ kind: 'ordinaria', count, amount: range.amount, firstDate: range.fromDate });
      }
    }
  } else if (ordinaryTotal > 0 && inputs.ordinaryCount > 0 && isValidDate(inputs.ordinaryFirstDate)) {
    rows.push(...rowsForEvenSplit('ordinaria', ordinaryTotal, inputs.ordinaryCount, inputs.ordinaryFirstDate));
  }
  if (amounts.benefit > 0) {
    const last = expandRows(rows).map((i) => i.date).sort().pop();
    const date = last ? addMonths(last, 1) : inputs.ordinaryFirstDate;
    if (isValidDate(date)) rows.push({ kind: 'bono', count: 1, amount: amounts.benefit, firstDate: date });
  }
  return rows;
}

export interface PlanSummary {
  totalLand:          number;
  separationTotal:    number;
  ordinaryTotal:      number;
  extraordinaryTotal: number;
  bonusTotal:         number;
  installmentsTotal:  number;
  difference:         number;
  installments:       Installment[];
  issues:             string[];
}

export function summarizePlan(p: {
  landValue: number; benefit: number; severance: { fundName: string; amount: number } | null; rows: PlanRow[];
}): PlanSummary {
  const installments = expandRows(p.rows);
  const sum = (k: InstallmentKind) => installments.filter((i) => i.kind === k).reduce((a, i) => a + i.amount, 0);
  const separationTotal = sum('separacion');
  const ordinaryTotal = sum('ordinaria');
  const extraordinaryTotal = sum('extraordinaria');
  const bonusTotal = sum('bono');
  const severance = p.severance?.amount ?? 0;
  const totalLand = p.landValue - p.benefit;
  const installmentsTotal = separationTotal + ordinaryTotal + extraordinaryTotal;
  const difference = totalLand - installmentsTotal - severance;

  const issues: string[] = [];
  if (p.landValue <= 0) issues.push('El valor del terreno debe ser mayor que cero.');
  if (p.benefit < 0 || p.benefit >= p.landValue) issues.push('El beneficio debe estar entre cero y el valor del terreno.');
  if (separationTotal <= 0) issues.push('Falta la separación.');
  if (difference !== 0) {
    issues.push(difference > 0
      ? `Faltan ${difference} pesos por asignar en cuotas.`
      : `Las cuotas superan el total del terreno en ${-difference} pesos.`);
  }
  if (bonusTotal !== 0 && bonusTotal !== p.benefit) issues.push('La cuota bono descuento debe ser igual al beneficio.');
  if (p.severance && p.severance.amount > 0 && !p.severance.fundName.trim()) issues.push('Falta el nombre del fondo de cesantías.');

  return { totalLand, separationTotal, ordinaryTotal, extraordinaryTotal, bonusTotal, installmentsTotal, difference, installments, issues };
}

/** '$ 145.000.000' */
export function formatPesos(n: number): string {
  return `$ ${Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')}`;
}

/** '145.000.000' → 145000000 (para inputs de dinero). */
export function parsePesos(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}
