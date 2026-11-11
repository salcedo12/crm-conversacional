import { addMonths } from './civilDate';
import type { Installment, InstallmentKind, PaymentPlan, PlanRow } from './deals.types';

/**
 * Cálculos del plan de pagos ("CIERRE DEL NEGOCIO") que alimentan la preventa y la promesa.
 *
 * Reglas (supuestos a confirmar con comercial/jurídica, ver PLAN-gestion-comercial-contratos.md):
 *   - TOTAL TERRENO = valor del terreno − beneficio. Es lo que el cliente paga con separación,
 *     ordinarias, extraordinarias y cesantías.
 *   - El beneficio aparece en la promesa como la última "cuota bono descuento" (filas `bono`),
 *     que solo se abona si el cliente pagó todo sin mora; no suma a lo pagado.
 *   - Al repartir un valor en cuotas, el residuo va a la primera (como SmartHome).
 */

const KIND_ORDER: Record<InstallmentKind, number> = { separacion: 0, ordinaria: 1, extraordinaria: 2, bono: 3 };

/** Reparte `total` en `count` cuotas enteras; el residuo va a la primera. 134.272.461 / 4 → [33.568.116, 33.568.115 ×3]. */
export function splitIntoInstallments(total: number, count: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`Total inválido: ${total}`);
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Número de cuotas inválido: ${count}`);
  const base = Math.floor(total / count);
  const amounts = Array<number>(count).fill(base);
  amounts[0] += total - base * count;
  return amounts;
}

/**
 * Filas para repartir `total` en `count` cuotas mensuales desde `firstDate`:
 * una fila con la primera cuota (que lleva el residuo) y otra con las demás.
 * Así lo muestra SmartHome: "1 | 33.568.116 | 26/11/2026" y "3 | 33.568.115 | 26/12/2026".
 */
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

/** Expande las filas a cuotas individuales mensuales, ordenadas por fecha. Filas con 0 cuotas o valor 0 se ignoran. */
export function expandRows(rows: PlanRow[]): Installment[] {
  const installments: Installment[] = [];
  for (const row of rows) {
    if (row.count <= 0 || row.amount <= 0) continue;
    for (let i = 0; i < row.count; i++) {
      installments.push({ kind: row.kind, amount: row.amount, date: addMonths(row.firstDate, i) });
    }
  }
  return installments.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export interface InstallmentGroup {
  count:  number;
  amount: number;
  from:   string;
  to:     string;
}

/**
 * Agrupa cuotas iguales en meses consecutivos, como la tabla de la promesa:
 * "5 | 30/07/2026 a 30/11/2026 | $ 2.241.935". Un mes sin cuota (p. ej. el de una
 * extraordinaria) corta el grupo.
 */
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

export interface PlanSummary {
  landValue:          number;
  benefit:            number;
  totalLand:          number;   // TOTAL TERRENO
  separationTotal:    number;
  ordinaryTotal:      number;
  extraordinaryTotal: number;
  bonusTotal:         number;
  severanceTotal:     number;
  /** VALOR TOTAL de la tabla de cuotas: separación + ordinarias + extraordinarias. */
  installmentsTotal:  number;
  /** TOTAL TERRENO − (cuotas + cesantías). Debe ser 0. */
  difference:         number;
  installments:       Installment[];
  issues:             string[];
}

export function summarizePlan(plan: PaymentPlan): PlanSummary {
  const installments = expandRows(plan.rows);
  const sum = (kind: InstallmentKind) =>
    installments.filter((i) => i.kind === kind).reduce((acc, i) => acc + i.amount, 0);

  const separationTotal = sum('separacion');
  const ordinaryTotal = sum('ordinaria');
  const extraordinaryTotal = sum('extraordinaria');
  const bonusTotal = sum('bono');
  const severanceTotal = plan.severance?.amount ?? 0;
  const totalLand = plan.landValue - plan.benefit;
  const installmentsTotal = separationTotal + ordinaryTotal + extraordinaryTotal;
  const difference = totalLand - installmentsTotal - severanceTotal;

  const issues: string[] = [];
  if (plan.landValue <= 0) issues.push('El valor del terreno debe ser mayor que cero.');
  if (plan.benefit < 0 || plan.benefit >= plan.landValue) issues.push('El beneficio debe estar entre cero y el valor del terreno.');
  if (separationTotal <= 0) issues.push('Falta la separación.');
  if (difference !== 0) {
    issues.push(difference > 0
      ? `Faltan ${difference} pesos por asignar en cuotas.`
      : `Las cuotas superan el total del terreno en ${-difference} pesos.`);
  }
  if (bonusTotal !== 0 && bonusTotal !== plan.benefit) {
    issues.push('La cuota bono descuento debe ser igual al beneficio.');
  }
  if (plan.severance && plan.severance.amount > 0 && !plan.severance.fundName.trim()) {
    issues.push('Falta el nombre del fondo de cesantías.');
  }
  for (const row of plan.rows) {
    if (!Number.isInteger(row.amount) || !Number.isInteger(row.count) || row.amount < 0 || row.count < 0) {
      issues.push('Las cuotas deben ser valores enteros positivos.');
      break;
    }
  }

  return {
    landValue: plan.landValue,
    benefit: plan.benefit,
    totalLand,
    separationTotal,
    ordinaryTotal,
    extraordinaryTotal,
    bonusTotal,
    severanceTotal,
    installmentsTotal,
    difference,
    installments,
    issues,
  };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthYear = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/**
 * Cuotas que se salen del plazo escogido en la lista de precios. El plazo arranca con la
 * primera cuota ordinaria (esa es el mes 1): 30 meses desde ene 2027 llegan hasta jun 2029.
 * La separación (va antes) y la cuota bono (no la paga el cliente) no cuentan. Se compara
 * por mes. Sin plazo (de contado / valor manual) o sin ordinarias no hay nada que revisar.
 * Va aparte de `summarizePlan` para no cambiar el estado de negocios ya guardados.
 * Misma regla que `checkTerm` en frontend-v2/src/features/deals/utils/paymentPlan.ts.
 */
export function termIssue(installments: Installment[], termMonths: number): string | null {
  if (!termMonths || termMonths <= 0) return null;
  const start = installments.filter((i) => i.kind === 'ordinaria').map((i) => i.date).sort()[0];
  if (!start) return null;
  const end = addMonths(start, termMonths - 1);
  const outside = installments.filter((i) =>
    (i.kind === 'ordinaria' || i.kind === 'extraordinaria') && i.date.slice(0, 7) > end.slice(0, 7));
  if (!outside.length) return null;
  return `Se pasa del plazo de ${termMonths} meses: ${outside.length === 1 ? '1 cuota queda' : `${outside.length} cuotas quedan`} después de ${monthYear(end)} (el plazo va de ${monthYear(start)} a ${monthYear(end)}).`;
}

/** Arras = porcentaje del precio total (30 % según la promesa de ejemplo: 43.500.000 de 145.000.000). */
export function computeEarnestMoney(price: number, percent = 30): number {
  return Math.round((price * percent) / 100);
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

/** Número de pagos mensuales entre dos fechas, ambas incluidas. */
export function monthlyInstallmentCount(fromDate: string, toDate: string): number {
  if (toDate < fromDate) return 0;
  for (let index = 0; index < 240; index++) {
    const date = addMonths(fromDate, index);
    if (date === toDate) return index + 1;
    if (date > toDate) return 0;
  }
  return 0;
}

/**
 * Modo "simple" (como SmartHome): separación en N cuotas, extraordinarias puntuales y
 * el resto del TOTAL TERRENO (menos cesantías) repartido en ordinarias. Si hay
 * beneficio, se agrega al final la "cuota bono descuento" por ese valor.
 * El frontend tiene una copia de esta función para la vista previa; el backend
 * siempre revalida con `summarizePlan`.
 */
export function buildSimpleRows(
  inputs: SimpleInputs,
  amounts: { landValue: number; benefit: number; severance: number },
): PlanRow[] {
  const rows: PlanRow[] = [];
  const separationPayments = inputs.separationPayments;
  if (separationPayments !== undefined) {
    for (const payment of separationPayments) {
      if (payment.amount > 0) rows.push({ kind: 'separacion', count: 1, amount: payment.amount, firstDate: payment.date });
    }
  } else if (inputs.separationTotal > 0 && inputs.separationCount > 0) {
    rows.push(...rowsForEvenSplit('separacion', inputs.separationTotal, inputs.separationCount, inputs.separationFirstDate));
  }
  const separationTotal = separationPayments !== undefined
    ? separationPayments.reduce((acc, payment) => acc + payment.amount, 0)
    : inputs.separationTotal;
  const extraTotal = inputs.extraordinary.reduce((acc, e) => acc + e.amount, 0);
  for (const e of inputs.extraordinary) {
    if (e.amount > 0) rows.push({ kind: 'extraordinaria', count: 1, amount: e.amount, firstDate: e.date });
  }
  const ordinaryTotal = amounts.landValue - amounts.benefit - separationTotal - extraTotal - amounts.severance;
  if (inputs.ordinaryMode === 'rangos') {
    for (const range of inputs.ordinaryRanges ?? []) {
      const count = monthlyInstallmentCount(range.fromDate, range.toDate);
      if (range.amount > 0 && count > 0) {
        rows.push({ kind: 'ordinaria', count, amount: range.amount, firstDate: range.fromDate });
      }
    }
  } else if (ordinaryTotal > 0 && inputs.ordinaryCount > 0) {
    rows.push(...rowsForEvenSplit('ordinaria', ordinaryTotal, inputs.ordinaryCount, inputs.ordinaryFirstDate));
  }
  if (amounts.benefit > 0) {
    const last = expandRows(rows).map((i) => i.date).sort().pop();
    rows.push({ kind: 'bono', count: 1, amount: amounts.benefit, firstDate: last ? addMonths(last, 1) : inputs.ordinaryFirstDate });
  }
  return rows;
}
