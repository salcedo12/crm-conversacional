import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  formatArea,
  getDealPriceOptions,
  saveDealPlan,
  type DealSummary,
  type PriceOption,
} from '../services/deals.service';
import {
  addMonths,
  buildSimpleRows,
  formatDMY,
  formatPesos,
  groupInstallments,
  monthlyInstallmentCount,
  parsePesos,
  splitIntoInstallments,
  summarizePlan,
  type InstallmentKind,
  type PlanRow,
  type SimpleInputs,
} from '../utils/paymentPlan';

interface DealPlanModalProps {
  companyId: string;
  deal:      DealSummary;
  onClose:   () => void;
  onSaved:   () => void;
}

const KIND_LABELS: Record<InstallmentKind, string> = {
  separacion: 'Separación',
  ordinaria: 'Ordinaria',
  extraordinaria: 'Extraordinaria',
  bono: 'Bono descuento',
};

/** Separación por defecto de los contratos de ejemplo ($6.000.000 en 2 cuotas). */
const DEFAULT_SEPARATION = 6_000_000;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Convierte el formato simple antiguo (cuotas mensuales iguales) en filas editables. */
function normalizeSimpleInputs(inputs: SimpleInputs): SimpleInputs {
  const payments = inputs.separationPayments ?? (inputs.separationCount > 0
    ? splitIntoInstallments(inputs.separationTotal, inputs.separationCount).map((amount, index) => ({
        amount,
        date: addMonths(inputs.separationFirstDate, index),
      }))
    : []);
  return {
    ...inputs,
    separationPayments: payments,
    ordinaryMode: inputs.ordinaryMode ?? (inputs.ordinaryRanges ? 'rangos' : 'automatico'),
    ordinaryRanges: inputs.ordinaryRanges ?? [],
  };
}

const inputCls =
  'w-full rounded-md border border-zinc-700 bg-zinc-800/90 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500';

/**
 * Plan de negocio ("CIERRE DEL NEGOCIO" de la preventa), como en SmartHome:
 * valor del terreno según plazo, beneficio, cesantías, separación y cuotas
 * (modo simple o específico), referido y observaciones. El plan debe cuadrar
 * con el total del terreno para poder guardarlo.
 */
export function DealPlanModal({ companyId, deal, onClose, onSaved }: DealPlanModalProps) {
  const saved = deal.plan && deal.plan.lotId === deal.lot?.inventoryLotId ? deal.plan : null;
  const start = today();

  const [options, setOptions] = useState<PriceOption[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [earnestPercent, setEarnestPercent] = useState(30);
  const [termMonths, setTermMonths] = useState<number | null>(saved?.termMonths ?? null);
  const [listPrice, setListPrice] = useState<number | null>(saved?.listPrice ?? null);
  const [landValue, setLandValue] = useState(saved?.landValue ?? 0);
  const [benefit, setBenefit] = useState(saved?.benefit ?? 0);
  const [severanceAmount, setSeveranceAmount] = useState(saved?.severance?.amount ?? 0);
  const [severanceFund, setSeveranceFund] = useState(saved?.severance?.fundName ?? '');
  const [mode, setMode] = useState<'simple' | 'especifico'>(saved?.mode ?? 'simple');
  const [simple, setSimple] = useState<SimpleInputs>(() => normalizeSimpleInputs(saved?.simple ?? {
    separationTotal: DEFAULT_SEPARATION,
    separationCount: 2,
    separationFirstDate: start,
    separationPayments: [
      { amount: DEFAULT_SEPARATION / 2, date: start },
      { amount: DEFAULT_SEPARATION / 2, date: addMonths(start, 1) },
    ],
    ordinaryCount: 1,
    ordinaryFirstDate: addMonths(start, 2),
    ordinaryMode: 'automatico',
    ordinaryRanges: [],
    extraordinary: [],
  }));
  const [rows, setRows] = useState<PlanRow[]>(saved?.rows ?? []);
  const [referredBy, setReferredBy] = useState(saved?.referredBy ?? '');
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedSignature, setVerifiedSignature] = useState<string | null>(null);

  useEffect(() => {
    getDealPriceOptions(companyId, deal.id)
      .then((res) => {
        setOptions(res.options);
        setEarnestPercent(res.earnestPercent);
        // Plan nuevo: tomar el precio de contado (o el primero) como sugerencia.
        if (!saved && res.options.length) {
          const first = res.options[0];
          setTermMonths(first.termMonths);
          setListPrice(first.price);
          setLandValue(first.price);
          setSimple((s) => ({ ...s, ordinaryCount: Math.max(1, first.termMonths) }));
        }
      })
      .catch(() => setOptions([]))
      .finally(() => setLoadingPrices(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, deal.id]);

  const severance = severanceAmount > 0 ? { fundName: severanceFund, amount: severanceAmount } : null;
  const amounts = { landValue, benefit, severance: severanceAmount };
  const effectiveRows = mode === 'simple' ? buildSimpleRows(simple, amounts) : rows;
  const summary = useMemo(
    () => summarizePlan({ landValue, benefit, severance, rows: effectiveRows }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landValue, benefit, severanceAmount, severanceFund, JSON.stringify(effectiveRows)],
  );
  const verificationSignature = JSON.stringify({ landValue, benefit, severanceAmount, severanceFund, rows: effectiveRows });
  const isVerified = verifiedSignature === verificationSignature;

  const pickTerm = (value: string) => {
    if (value === '') { setTermMonths(null); setListPrice(null); return; }
    const opt = options.find((o) => o.termMonths === Number(value));
    if (!opt) return;
    setTermMonths(opt.termMonths);
    setListPrice(opt.price);
    setLandValue(opt.price);
    if (mode === 'simple') setSimple((s) => ({ ...s, ordinaryCount: Math.max(1, opt.termMonths) }));
  };

  const switchMode = (next: 'simple' | 'especifico') => {
    // Al pasar a específico se parte de las filas que generó el modo simple.
    if (next === 'especifico' && mode === 'simple') setRows(buildSimpleRows(simple, amounts));
    setMode(next);
  };

  const updateRow = (i: number, patch: Partial<PlanRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const setSeparationPayments = (payments: Array<{ amount: number; date: string }>) => {
    const total = payments.reduce((acc, payment) => acc + payment.amount, 0);
    setSimple((prev) => ({
      ...prev,
      separationPayments: payments,
      // Se conservan estos campos para que los negocios antiguos y las integraciones sigan siendo compatibles.
      separationTotal: total,
      separationCount: payments.length,
      separationFirstDate: payments[0]?.date ?? prev.separationFirstDate,
    }));
  };

  const switchOrdinaryMode = (next: 'automatico' | 'rangos') => {
    if (next === 'rangos' && !(simple.ordinaryRanges?.length)) {
      const generated = buildSimpleRows({ ...simple, ordinaryMode: 'automatico' }, amounts)
        .filter((row) => row.kind === 'ordinaria')
        .map((row) => ({
          amount: row.amount,
          fromDate: row.firstDate,
          toDate: addMonths(row.firstDate, row.count - 1),
        }));
      setSimple({ ...simple, ordinaryMode: next, ordinaryRanges: generated });
      return;
    }
    setSimple({ ...simple, ordinaryMode: next });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDealPlan(companyId, deal.id, {
        mode,
        ...(mode === 'simple' ? { simple } : {}),
        listPrice,
        landValue,
        termMonths: termMonths ?? 0,
        benefit,
        severance,
        rows: effectiveRows,
        referredBy,
        notes,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el plan.');
    } finally {
      setSaving(false);
    }
  };

  const lot = deal.lot;
  const earnest = Math.round((landValue * earnestPercent) / 100);
  const byKind = (k: InstallmentKind) => groupInstallments(summary.installments.filter((i) => i.kind === k));
  const automaticOrdinaryRows = effectiveRows.filter((row) => row.kind === 'ordinaria');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">Plan de negocio</h2>
            {lot && (
              <p className="flex items-center gap-1 truncate text-[11px] text-zinc-500">
                <MapPin size={11} className="text-emerald-400" />
                {lot.sector} · Lote {lot.lotNumber} · {formatArea(lot.areaM2)} · {lot.corner ? 'Esquinero' : 'Medianero'}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Cierre del negocio */}
          <Section title="Cierre del negocio">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Plazo (lista de precios)">
                <select className={inputCls} value={termMonths ?? ''} onChange={(e) => pickTerm(e.target.value)}>
                  <option value="">Valor manual</option>
                  {options.map((o) => (
                    <option key={o.termMonths} value={o.termMonths}>
                      {o.termMonths === 0 ? 'De contado' : `${o.termMonths} meses`} · {formatPesos(o.price)}
                    </option>
                  ))}
                </select>
                {loadingPrices ? (
                  <p className="mt-1 text-[10px] text-zinc-500">Cargando precios…</p>
                ) : !options.length && (
                  <p className="mt-1 text-[10px] text-zinc-500">Este lote no está en la lista de precios: escribe el valor.</p>
                )}
              </Field>
              <Field label="Valor del terreno">
                <MoneyInput value={landValue} onChange={setLandValue} />
                {listPrice !== null && listPrice !== landValue && (
                  <p className="mt-1 text-[10px] text-amber-300/90">Distinto al de lista ({formatPesos(listPrice)}).</p>
                )}
              </Field>
              <Field label="Beneficio">
                <MoneyInput value={benefit} onChange={setBenefit} />
              </Field>
              <Field label="Cesantías">
                <MoneyInput value={severanceAmount} onChange={setSeveranceAmount} />
              </Field>
              {severanceAmount > 0 && (
                <Field label="Fondo de cesantías">
                  <input className={inputCls} value={severanceFund} onChange={(e) => setSeveranceFund(e.target.value)} placeholder="Ej: Porvenir" />
                </Field>
              )}
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Total terreno</p>
                <p className="text-sm font-semibold text-emerald-200">{formatPesos(summary.totalLand)}</p>
                <p className="text-[10px] text-zinc-500">Arras ({earnestPercent}%): {formatPesos(earnest)}</p>
              </div>
            </div>
          </Section>

          {/* Cuotas */}
          <Section
            title="Plan de pagos"
            right={
              <div className="flex rounded-md border border-zinc-700 p-0.5 text-[11px]">
                {(['simple', 'especifico'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    className={`rounded px-2.5 py-1 ${mode === m ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {m === 'simple' ? 'Simple' : 'Específico'}
                  </button>
                ))}
              </div>
            }
          >
            {mode === 'simple' ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Pagos de separación</p>
                    <p className="text-[11px] font-medium text-zinc-300">Total: {formatPesos(simple.separationTotal)}</p>
                  </div>
                  {(simple.separationPayments ?? []).map((payment, i) => (
                    <div key={i} className="mb-2 flex items-center gap-2">
                      <div className="flex-1">
                        <MoneyInput
                          value={payment.amount}
                          onChange={(amount) => setSeparationPayments((simple.separationPayments ?? []).map((item, index) => (
                            index === i ? { ...item, amount } : item
                          )))}
                        />
                      </div>
                      <input
                        type="date"
                        className={`${inputCls} flex-1`}
                        value={payment.date}
                        onChange={(event) => setSeparationPayments((simple.separationPayments ?? []).map((item, index) => (
                          index === i ? { ...item, date: event.target.value } : item
                        )))}
                      />
                      <button
                        type="button"
                        aria-label="Quitar pago de separación"
                        className="text-zinc-500 hover:text-red-300"
                        onClick={() => setSeparationPayments((simple.separationPayments ?? []).filter((_, index) => index !== i))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const payments = simple.separationPayments ?? [];
                      const nextDate = payments.length ? addMonths(payments[payments.length - 1].date, 1) : start;
                      setSeparationPayments([...payments, { amount: 0, date: nextDate }]);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                  >
                    <Plus size={12} /> Agregar separación
                  </button>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cuotas ordinarias</p>
                    <div className="flex rounded-md border border-zinc-700 p-0.5 text-[10px]">
                      {(['automatico', 'rangos'] as const).map((ordinaryMode) => (
                        <button
                          key={ordinaryMode}
                          type="button"
                          onClick={() => switchOrdinaryMode(ordinaryMode)}
                          className={`rounded px-2 py-1 ${simple.ordinaryMode === ordinaryMode ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
                        >
                          {ordinaryMode === 'automatico' ? 'Automáticas' : 'Por rangos'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {simple.ordinaryMode === 'rangos' ? (
                    <div>
                      {(simple.ordinaryRanges ?? []).map((range, i) => {
                        const count = monthlyInstallmentCount(range.fromDate, range.toDate);
                        return (
                          <div key={i} className="mb-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                            <Field label="Valor mensual">
                              <MoneyInput value={range.amount} onChange={(amount) => setSimple({
                                ...simple,
                                ordinaryRanges: (simple.ordinaryRanges ?? []).map((item, index) => index === i ? { ...item, amount } : item),
                              })} />
                            </Field>
                            <Field label="Desde">
                              <input type="date" className={inputCls} value={range.fromDate} onChange={(event) => setSimple({
                                ...simple,
                                ordinaryRanges: (simple.ordinaryRanges ?? []).map((item, index) => index === i ? { ...item, fromDate: event.target.value } : item),
                              })} />
                            </Field>
                            <Field label={`Hasta${count > 0 ? ` · ${count} cuota${count === 1 ? '' : 's'}` : ''}`}>
                              <input type="date" className={inputCls} value={range.toDate} onChange={(event) => setSimple({
                                ...simple,
                                ordinaryRanges: (simple.ordinaryRanges ?? []).map((item, index) => index === i ? { ...item, toDate: event.target.value } : item),
                              })} />
                            </Field>
                            <button
                              type="button"
                              aria-label="Quitar rango de cuotas ordinarias"
                              className="mb-2 text-zinc-500 hover:text-red-300 sm:mb-2.5"
                              onClick={() => setSimple({ ...simple, ordinaryRanges: (simple.ordinaryRanges ?? []).filter((_, index) => index !== i) })}
                            >
                              <Trash2 size={13} />
                            </button>
                            {count === 0 && range.fromDate && range.toDate && (
                              <p className="text-[10px] text-amber-300 sm:col-span-4">La fecha final debe coincidir con una mensualidad calculada desde la fecha inicial.</p>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          const ranges = simple.ordinaryRanges ?? [];
                          const previous = ranges[ranges.length - 1];
                          const fromDate = previous ? addMonths(previous.toDate, 1) : simple.ordinaryFirstDate;
                          setSimple({
                            ...simple,
                            ordinaryRanges: [...ranges, { amount: previous?.amount ?? 0, fromDate, toDate: fromDate }],
                          });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                      >
                        <Plus size={12} /> Agregar rango ordinario
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Field label="Número de cuotas">
                        <input type="number" min={0} max={240} className={inputCls} value={simple.ordinaryCount}
                          onChange={(e) => setSimple({ ...simple, ordinaryCount: Math.max(0, Number(e.target.value) || 0) })} />
                      </Field>
                      <Field label="Primera cuota ordinaria">
                        <input type="date" className={inputCls} value={simple.ordinaryFirstDate}
                          onChange={(e) => setSimple({ ...simple, ordinaryFirstDate: e.target.value })} />
                      </Field>
                      <Field label="Valor cuota ordinaria">
                        <div className={`${inputCls} min-h-[30px] bg-zinc-900 text-zinc-200`}>
                          {automaticOrdinaryRows.length === 0 ? '—' : automaticOrdinaryRows.length === 1 ? (
                            formatPesos(automaticOrdinaryRows[0].amount)
                          ) : (
                            <span>
                              {formatPesos(automaticOrdinaryRows[0].amount)} la primera · {formatPesos(automaticOrdinaryRows[1].amount)} las demás
                            </span>
                          )}
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cuotas extraordinarias</p>
                  {simple.extraordinary.map((e, i) => (
                    <div key={i} className="mb-2 flex items-center gap-2">
                      <div className="flex-1"><MoneyInput value={e.amount} onChange={(v) => setSimple({ ...simple, extraordinary: simple.extraordinary.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} /></div>
                      <input type="date" className={`${inputCls} flex-1`} value={e.date}
                        onChange={(ev) => setSimple({ ...simple, extraordinary: simple.extraordinary.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)) })} />
                      <button type="button" aria-label="Quitar extraordinaria" className="text-zinc-500 hover:text-red-300"
                        onClick={() => setSimple({ ...simple, extraordinary: simple.extraordinary.filter((_, j) => j !== i) })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSimple({ ...simple, extraordinary: [...simple.extraordinary, { amount: 0, date: addMonths(simple.ordinaryFirstDate, 6) }] })}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                  >
                    <Plus size={12} /> Agregar extraordinaria
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {simple.ordinaryMode === 'rangos'
                    ? 'En cada rango se crea una cuota mensual del valor indicado, incluyendo las fechas inicial y final.'
                    : 'Las ordinarias se calculan solas con lo que falta del total (el residuo va en la primera, como en SmartHome).'}
                  {benefit > 0 && ' El beneficio queda como cuota bono descuento al final.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1.2fr_0.6fr_1.2fr_1.1fr_auto]">
                    <select className={inputCls} value={r.kind} onChange={(e) => updateRow(i, { kind: e.target.value as InstallmentKind })}>
                      {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <input type="number" min={1} className={inputCls} value={r.count} aria-label="Número de cuotas"
                      onChange={(e) => updateRow(i, { count: Math.max(0, Number(e.target.value) || 0) })} />
                    <MoneyInput value={r.amount} onChange={(v) => updateRow(i, { amount: v })} />
                    <input type="date" className={inputCls} value={r.firstDate} onChange={(e) => updateRow(i, { firstDate: e.target.value })} />
                    <button type="button" aria-label="Quitar fila" className="justify-self-start text-zinc-500 hover:text-red-300"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRows((prev) => [...prev, { kind: 'ordinaria', count: 1, amount: 0, firstDate: start }])}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                >
                  <Plus size={12} /> Agregar fila
                </button>
                <p className="text-[11px] text-zinc-500">Cada fila son N cuotas mensuales del mismo valor desde la fecha indicada. Las cuotas en 0 se ignoran.</p>
              </div>
            )}
          </Section>

          {/* Resumen como en la preventa */}
          <Section
            title="Resumen"
            right={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setVerifiedSignature(verificationSignature)}
                className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              >
                <CheckCircle2 size={13} /> {isVerified ? 'Plan comprobado' : 'Comprobar plan'}
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Total label="Total separación" value={summary.separationTotal} />
              <Total label="Total ordinarias" value={summary.ordinaryTotal} />
              <Total label="Total extraordinarias" value={summary.extraordinaryTotal} />
              <Total label="Valor total" value={summary.installmentsTotal} strong />
            </div>
            {(severanceAmount > 0 || summary.bonusTotal > 0) && (
              <p className="mt-2 text-[11px] text-zinc-400">
                {severanceAmount > 0 && <>Cesantías: {formatPesos(severanceAmount)}. </>}
                {summary.bonusTotal > 0 && <>Cuota bono descuento: {formatPesos(summary.bonusTotal)}.</>}
              </p>
            )}
            {isVerified && (
              <div className={`mt-3 rounded-md border px-3 py-2.5 ${
                summary.issues.length
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
              }`}>
                <p className="flex items-center gap-1 text-xs font-semibold">
                  {summary.issues.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                  {summary.issues.length ? 'La comprobación encontró diferencias' : 'Comprobación correcta: todos los valores cuadran'}
                </p>
                <div className="mt-2 space-y-1 text-[11px] text-zinc-300">
                  <p>
                    Total terreno: {formatPesos(landValue)} − beneficio {formatPesos(benefit)} = <strong>{formatPesos(summary.totalLand)}</strong>
                  </p>
                  <p>
                    Pagos: separación {formatPesos(summary.separationTotal)} + ordinarias {formatPesos(summary.ordinaryTotal)} + extraordinarias {formatPesos(summary.extraordinaryTotal)} + cesantías {formatPesos(severanceAmount)} = <strong>{formatPesos(summary.installmentsTotal + severanceAmount)}</strong>
                  </p>
                  <p>
                    Diferencia: <strong className={summary.difference === 0 ? 'text-emerald-300' : 'text-amber-300'}>{formatPesos(Math.abs(summary.difference))}</strong>
                  </p>
                  {benefit > 0 && (
                    <p className="text-zinc-400">El beneficio se valida como bono descuento y no se suma a los pagos del cliente.</p>
                  )}
                </div>
              </div>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['separacion', 'ordinaria', 'extraordinaria'] as const).map((k) => (
                <div key={k} className="rounded-md border border-zinc-800">
                  <p className="border-b border-zinc-800 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{KIND_LABELS[k]}</p>
                  {byKind(k).length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-zinc-600">—</p>
                  ) : byKind(k).map((g, i) => (
                    <div key={i} className="flex justify-between gap-2 px-2.5 py-1 text-[11px] text-zinc-300">
                      <span>{g.count} · {formatDMY(g.from)}{g.count > 1 ? ` a ${formatDMY(g.to)}` : ''}</span>
                      <span className="font-medium">{formatPesos(g.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {summary.issues.length > 0 ? (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                {summary.issues.map((issue) => <p key={issue} className="flex items-center gap-1"><AlertTriangle size={11} /> {issue}</p>)}
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 size={12} /> El plan cuadra con el total del terreno.</p>
            )}
          </Section>

          <Section title="Referido y observaciones">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Referido por">
                <input className={inputCls} value={referredBy} onChange={(e) => setReferredBy(e.target.value)} />
              </Field>
              <Field label="Observaciones">
                <textarea rows={2} className={`${inputCls} resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </Section>
        </div>

        <footer className="flex flex-col gap-2 border-t border-zinc-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          {error ? <p className="text-xs text-red-300">{error}</p> : <span className="text-[11px] text-zinc-500">Valor total: {formatPesos(summary.installmentsTotal)}</span>}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={summary.issues.length > 0}>
              Guardar plan
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Total({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-md border px-2.5 py-2 ${strong ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-zinc-800'}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-xs font-semibold ${strong ? 'text-emerald-200' : 'text-zinc-200'}`}>{formatPesos(value)}</p>
    </div>
  );
}

/** Pesos con separador de miles mientras se escribe. */
function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
      <input
        className={`${inputCls} pl-5`}
        inputMode="numeric"
        value={value ? value.toLocaleString('es-CO').replace(/,/g, '.') : ''}
        placeholder="0"
        onChange={(e) => onChange(parsePesos(e.target.value))}
      />
    </div>
  );
}
