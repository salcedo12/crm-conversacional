import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, MapPin, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { DealField as Field, DealSheet, dealInputCls as inputCls } from './DealSheet';
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
  referralName,
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

  const setExtraordinary = (list: SimpleInputs['extraordinary']) => setSimple({ ...simple, extraordinary: list });
  const setRanges = (list: NonNullable<SimpleInputs['ordinaryRanges']>) => setSimple({ ...simple, ordinaryRanges: list });

  return (
    <DealSheet
      title="Plan de negocio"
      icon={<Calculator size={18} />}
      subtitle={lot && (
        <span className="flex items-center gap-1 truncate">
          <MapPin size={11} className="shrink-0 text-emerald-400" />
          <span className="truncate">{lot.sector} · Lote {lot.lotNumber} · {formatArea(lot.areaM2)} · {lot.corner ? 'Esquinero' : 'Medianero'}</span>
        </span>
      )}
      onClose={onClose}
      width="xl"
      bodyClassName="space-y-4"
      footer={
        <div className="space-y-2.5">
          {/* Cuadre siempre visible: en celular el resumen queda muy abajo. */}
          <PlanBalance totalLand={summary.totalLand} paid={summary.installmentsTotal + severanceAmount} difference={summary.difference} />
          {error && <p className="text-xs text-red-300">{error}</p>}
          {summary.issues.length > 0 && !error && (
            <p className="line-clamp-2 text-xs text-amber-300/90 sm:text-[11px]">{summary.issues[0]}{summary.issues.length > 1 ? ` (+${summary.issues.length - 1} más)` : ''}</p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:justify-end">
            <Button variant="ghost" onClick={onClose} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">Cancelar</Button>
            <Button onClick={handleSave} loading={saving} disabled={summary.issues.length > 0} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
              Guardar plan
            </Button>
          </div>
        </div>
      }
    >
      {/* Cierre del negocio */}
      <Section title="Cierre del negocio">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Plazo (lista de precios)"
            hint={loadingPrices ? (
              <p className="mt-1 text-[11px] text-zinc-500">Cargando precios…</p>
            ) : !options.length && (
              <p className="mt-1 text-[11px] text-zinc-500">Este lote no está en la lista de precios: escribe el valor.</p>
            )}
          >
            <select className={inputCls} value={termMonths ?? ''} onChange={(e) => pickTerm(e.target.value)}>
              <option value="">Valor manual</option>
              {options.map((o) => (
                <option key={o.termMonths} value={o.termMonths}>
                  {o.termMonths === 0 ? 'De contado' : `${o.termMonths} meses`} · {formatPesos(o.price)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Valor del terreno"
            hint={listPrice !== null && listPrice !== landValue && (
              <p className="mt-1 text-[11px] text-amber-300/90">Distinto al de lista ({formatPesos(listPrice)}).</p>
            )}
          >
            <MoneyInput value={landValue} onChange={setLandValue} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <Field label="Beneficio">
              <MoneyInput value={benefit} onChange={setBenefit} />
            </Field>
            <Field label="Cesantías">
              <MoneyInput value={severanceAmount} onChange={setSeveranceAmount} />
            </Field>
          </div>
          {severanceAmount > 0 && (
            <Field label="Fondo de cesantías">
              <input className={inputCls} value={severanceFund} onChange={(e) => setSeveranceFund(e.target.value)} placeholder="Ej: Porvenir" />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 sm:block sm:py-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80 sm:text-[10px]">Total terreno</p>
              <p className="text-lg font-bold text-emerald-200 sm:text-sm sm:font-semibold">{formatPesos(summary.totalLand)}</p>
            </div>
            <p className="text-right text-xs text-zinc-400 sm:text-left sm:text-[10px] sm:text-zinc-500">Arras ({earnestPercent}%)<br className="sm:hidden" /><span className="hidden sm:inline">: </span>{formatPesos(earnest)}</p>
          </div>
        </div>
      </Section>

      {/* Cuotas */}
      <Section
        title="Plan de pagos"
        right={
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[{ value: 'simple', label: 'Simple' }, { value: 'especifico', label: 'Específico' }]}
          />
        }
      >
        {mode === 'simple' ? (
          <div className="space-y-5 sm:space-y-4">
            <div>
              <SubTitle right={<span className="text-xs font-medium normal-case tracking-normal text-zinc-300 sm:text-[11px]">Total: {formatPesos(simple.separationTotal)}</span>}>
                Pagos de separación
              </SubTitle>
              <div className="space-y-2">
                {(simple.separationPayments ?? []).map((payment, i) => (
                  <AmountDateRow
                    key={i}
                    index={i + 1}
                    amount={payment.amount}
                    date={payment.date}
                    removeLabel="Quitar pago de separación"
                    onAmount={(amount) => setSeparationPayments((simple.separationPayments ?? []).map((item, index) => (index === i ? { ...item, amount } : item)))}
                    onDate={(date) => setSeparationPayments((simple.separationPayments ?? []).map((item, index) => (index === i ? { ...item, date } : item)))}
                    onRemove={() => setSeparationPayments((simple.separationPayments ?? []).filter((_, index) => index !== i))}
                  />
                ))}
              </div>
              <AddButton
                onClick={() => {
                  const payments = simple.separationPayments ?? [];
                  const nextDate = payments.length ? addMonths(payments[payments.length - 1].date, 1) : start;
                  setSeparationPayments([...payments, { amount: 0, date: nextDate }]);
                }}
              >
                Agregar separación
              </AddButton>
            </div>

            <div>
              <SubTitle
                right={
                  <Segmented
                    small
                    value={simple.ordinaryMode ?? 'automatico'}
                    onChange={switchOrdinaryMode}
                    options={[{ value: 'automatico', label: 'Automáticas' }, { value: 'rangos', label: 'Por rangos' }]}
                  />
                }
              >
                Cuotas ordinarias
              </SubTitle>
              {simple.ordinaryMode === 'rangos' ? (
                <div className="space-y-2">
                  {(simple.ordinaryRanges ?? []).map((range, i) => {
                    const count = monthlyInstallmentCount(range.fromDate, range.toDate);
                    const patchRange = (patch: Partial<typeof range>) =>
                      setRanges((simple.ordinaryRanges ?? []).map((item, index) => (index === i ? { ...item, ...patch } : item)));
                    return (
                      <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:border-0 sm:bg-transparent sm:p-0">
                        <div className="mb-2 flex items-center justify-between sm:hidden">
                          <span className="text-xs font-semibold text-zinc-300">Rango {i + 1}{count > 0 ? ` · ${count} cuota${count === 1 ? '' : 's'}` : ''}</span>
                          <RemoveButton label="Quitar rango de cuotas ordinarias" onClick={() => setRanges((simple.ordinaryRanges ?? []).filter((_, index) => index !== i))} />
                        </div>
                        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                          <Field label="Valor mensual" className="col-span-2 sm:col-span-1">
                            <MoneyInput value={range.amount} onChange={(amount) => patchRange({ amount })} />
                          </Field>
                          <Field label="Desde">
                            <input type="date" className={inputCls} value={range.fromDate} onChange={(event) => patchRange({ fromDate: event.target.value })} />
                          </Field>
                          <Field label={<>Hasta<span className="hidden sm:inline">{count > 0 ? ` · ${count} cuota${count === 1 ? '' : 's'}` : ''}</span></>}>
                            <input type="date" className={inputCls} value={range.toDate} onChange={(event) => patchRange({ toDate: event.target.value })} />
                          </Field>
                          <div className="hidden sm:block">
                            <RemoveButton label="Quitar rango de cuotas ordinarias" onClick={() => setRanges((simple.ordinaryRanges ?? []).filter((_, index) => index !== i))} />
                          </div>
                        </div>
                        {count === 0 && range.fromDate && range.toDate && (
                          <p className="mt-1.5 text-[11px] text-amber-300">La fecha final debe coincidir con una mensualidad calculada desde la fecha inicial.</p>
                        )}
                      </div>
                    );
                  })}
                  <AddButton
                    onClick={() => {
                      const ranges = simple.ordinaryRanges ?? [];
                      const previous = ranges[ranges.length - 1];
                      const fromDate = previous ? addMonths(previous.toDate, 1) : simple.ordinaryFirstDate;
                      setRanges([...ranges, { amount: previous?.amount ?? 0, fromDate, toDate: fromDate }]);
                    }}
                  >
                    Agregar rango ordinario
                  </AddButton>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Número de cuotas">
                    <input type="number" inputMode="numeric" min={0} max={240} className={inputCls} value={simple.ordinaryCount}
                      onChange={(e) => setSimple({ ...simple, ordinaryCount: Math.max(0, Number(e.target.value) || 0) })} />
                  </Field>
                  <Field label="Primera cuota">
                    <input type="date" className={inputCls} value={simple.ordinaryFirstDate}
                      onChange={(e) => setSimple({ ...simple, ordinaryFirstDate: e.target.value })} />
                  </Field>
                  {/* Valor calculado: tarjeta informativa, no parece un campo editable. */}
                  <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 sm:col-span-1 sm:py-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]">Valor cuota ordinaria</p>
                    {automaticOrdinaryRows.length === 0 ? (
                      <p className="text-sm text-zinc-400 sm:text-xs">—</p>
                    ) : automaticOrdinaryRows.length === 1 ? (
                      <p className="text-base font-semibold text-zinc-100 sm:text-xs">{formatPesos(automaticOrdinaryRows[0].amount)}</p>
                    ) : (
                      <p className="text-sm text-zinc-200 sm:text-xs">
                        <span className="font-semibold text-zinc-100">{formatPesos(automaticOrdinaryRows[1].amount)}</span> mensual
                        <span className="block text-xs text-zinc-500 sm:inline sm:text-[11px]"><span className="hidden sm:inline"> · </span>la primera {formatPesos(automaticOrdinaryRows[0].amount)}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <SubTitle>Cuotas extraordinarias</SubTitle>
              {simple.extraordinary.length > 0 && (
                <div className="space-y-2">
                  {simple.extraordinary.map((e, i) => (
                    <AmountDateRow
                      key={i}
                      index={i + 1}
                      amount={e.amount}
                      date={e.date}
                      removeLabel="Quitar extraordinaria"
                      onAmount={(v) => setExtraordinary(simple.extraordinary.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                      onDate={(d) => setExtraordinary(simple.extraordinary.map((x, j) => (j === i ? { ...x, date: d } : x)))}
                      onRemove={() => setExtraordinary(simple.extraordinary.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              )}
              <AddButton onClick={() => setExtraordinary([...simple.extraordinary, { amount: 0, date: addMonths(simple.ordinaryFirstDate, 6) }])}>
                Agregar extraordinaria
              </AddButton>
            </div>
            <p className="text-xs text-zinc-500 sm:text-[11px]">
              {simple.ordinaryMode === 'rangos'
                ? 'En cada rango se crea una cuota mensual del valor indicado, incluyendo las fechas inicial y final.'
                : 'Las ordinarias se calculan solas con lo que falta del total (el residuo va en la primera, como en SmartHome).'}
              {benefit > 0 && ' El beneficio queda como cuota bono descuento al final.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Encabezados solo en computador; en celular cada fila es una tarjeta con sus etiquetas. */}
            {rows.length > 0 && (
              <div className="hidden grid-cols-[1.2fr_0.6fr_1.2fr_1.1fr_32px] gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid">
                <span>Tipo</span><span>Cuotas</span><span>Valor cuota</span><span>Primera fecha</span><span />
              </div>
            )}
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:border-0 sm:bg-transparent sm:p-0">
                <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1.2fr_0.6fr_1.2fr_1.1fr_32px] sm:items-center">
                  <MobileLabel label="Tipo" className="col-span-1">
                    <select className={inputCls} value={r.kind} onChange={(e) => updateRow(i, { kind: e.target.value as InstallmentKind })}>
                      {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </MobileLabel>
                  <div className="sm:hidden">
                    <RemoveButton label="Quitar fila" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} />
                  </div>
                  <div className="col-span-2 grid grid-cols-[5rem_1fr] gap-2 sm:contents">
                    <MobileLabel label="Cuotas">
                      <input type="number" inputMode="numeric" min={1} className={inputCls} value={r.count} aria-label="Número de cuotas"
                        onChange={(e) => updateRow(i, { count: Math.max(0, Number(e.target.value) || 0) })} />
                    </MobileLabel>
                    <MobileLabel label="Valor cuota">
                      <MoneyInput value={r.amount} onChange={(v) => updateRow(i, { amount: v })} />
                    </MobileLabel>
                  </div>
                  <MobileLabel label="Primera fecha" className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={r.firstDate} onChange={(e) => updateRow(i, { firstDate: e.target.value })} />
                  </MobileLabel>
                  <div className="hidden sm:block">
                    <RemoveButton label="Quitar fila" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} />
                  </div>
                </div>
                {r.count > 1 && r.amount > 0 && (
                  <p className="mt-1.5 text-[11px] text-zinc-500 sm:hidden">{r.count} × {formatPesos(r.amount)} = {formatPesos(r.count * r.amount)}</p>
                )}
              </div>
            ))}
            <AddButton onClick={() => setRows((prev) => [...prev, { kind: 'ordinaria', count: 1, amount: 0, firstDate: start }])}>
              Agregar fila
            </AddButton>
            <p className="text-xs text-zinc-500 sm:text-[11px]">Cada fila son N cuotas mensuales del mismo valor desde la fecha indicada. Las cuotas en 0 se ignoran.</p>
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
            className="min-h-[40px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 sm:min-h-0"
          >
            <CheckCircle2 size={14} /> {isVerified ? 'Plan comprobado' : 'Comprobar plan'}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Total label="Separación" value={summary.separationTotal} />
          <Total label="Ordinarias" value={summary.ordinaryTotal} />
          <Total label="Extraordinarias" value={summary.extraordinaryTotal} />
          <Total label="Valor total" value={summary.installmentsTotal} strong />
        </div>
        {(severanceAmount > 0 || summary.bonusTotal > 0) && (
          <p className="mt-2 text-xs text-zinc-400 sm:text-[11px]">
            {severanceAmount > 0 && <>Cesantías: {formatPesos(severanceAmount)}. </>}
            {summary.bonusTotal > 0 && <>Cuota bono descuento: {formatPesos(summary.bonusTotal)}.</>}
          </p>
        )}
        {isVerified && (
          <div className={`mt-3 rounded-lg border px-3 py-2.5 ${
            summary.issues.length
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
          }`}>
            <p className="flex items-center gap-1.5 text-sm font-semibold sm:text-xs">
              {summary.issues.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {summary.issues.length ? 'La comprobación encontró diferencias' : 'Comprobación correcta: todos los valores cuadran'}
            </p>
            {/* Cuentas en filas (etiqueta / valor) para que se lean en pantallas angostas. */}
            <dl className="mt-2 space-y-1 text-xs text-zinc-300 sm:text-[11px]">
              <CheckLine label="Valor del terreno" value={formatPesos(landValue)} />
              <CheckLine label="− Beneficio" value={formatPesos(benefit)} />
              <CheckLine label="= Total terreno" value={formatPesos(summary.totalLand)} strong />
              <div className="my-1.5 border-t border-white/10" />
              <CheckLine label="Separación" value={formatPesos(summary.separationTotal)} />
              <CheckLine label="+ Ordinarias" value={formatPesos(summary.ordinaryTotal)} />
              <CheckLine label="+ Extraordinarias" value={formatPesos(summary.extraordinaryTotal)} />
              <CheckLine label="+ Cesantías" value={formatPesos(severanceAmount)} />
              <CheckLine label="= Pagos" value={formatPesos(summary.installmentsTotal + severanceAmount)} strong />
              <div className="my-1.5 border-t border-white/10" />
              <CheckLine
                label="Diferencia"
                value={<span className={summary.difference === 0 ? 'text-emerald-300' : 'text-amber-300'}>{formatPesos(Math.abs(summary.difference))}</span>}
                strong
              />
            </dl>
            {benefit > 0 && (
              <p className="mt-2 text-[11px] text-zinc-400">El beneficio se valida como bono descuento y no se suma a los pagos del cliente.</p>
            )}
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['separacion', 'ordinaria', 'extraordinaria'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-zinc-800">
              <p className="border-b border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:px-2.5 sm:py-1.5 sm:text-[10px]">{KIND_LABELS[k]}</p>
              {byKind(k).length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-600 sm:px-2.5 sm:text-[11px]">—</p>
              ) : byKind(k).map((g, i) => (
                <div key={i} className="flex justify-between gap-2 px-3 py-1.5 text-xs text-zinc-300 sm:px-2.5 sm:py-1 sm:text-[11px]">
                  <span>{g.count} · {formatDMY(g.from)}{g.count > 1 ? ` a ${formatDMY(g.to)}` : ''}</span>
                  <span className="shrink-0 font-medium">{formatPesos(g.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {summary.issues.length > 0 ? (
          <div className="mt-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 sm:text-[11px]">
            {summary.issues.map((issue) => <p key={issue} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {issue}</p>)}
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-300 sm:text-[11px]"><CheckCircle2 size={13} /> El plan cuadra con el total del terreno.</p>
        )}
      </Section>

      <Section title="Referido y observaciones">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Referido por"
            hint={
              <p className="mt-1 text-[11px] text-zinc-500">
                {referredBy.trim() && !referralName(referredBy)
                  ? 'Se toma como sin referido: no se pedirá evidencia.'
                  : referralName(referredBy)
                    ? 'Se pedirá la evidencia del referido en los soportes.'
                    : 'Déjalo vacío (o escribe N/A) si no hay referido.'}
              </p>
            }
          >
            <input className={inputCls} value={referredBy} placeholder="Nombre de quien lo refirió" onChange={(e) => setReferredBy(e.target.value)} />
          </Field>
          <Field label="Observaciones">
            <textarea rows={3} className={`${inputCls} resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Section>
    </DealSheet>
  );
}

/** Barra de cuadre del pie: total del terreno vs. lo que suman los pagos. */
function PlanBalance({ totalLand, paid, difference }: { totalLand: number; paid: number; difference: number }) {
  const ok = difference === 0;
  const pct = totalLand > 0 ? Math.min(100, Math.max(0, (paid / totalLand) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs sm:text-[11px]">
        <span className={`flex items-center gap-1 font-semibold ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {ok ? 'El plan cuadra' : difference > 0 ? `Faltan ${formatPesos(difference)}` : `Sobran ${formatPesos(-difference)}`}
        </span>
        <span className="truncate text-zinc-500">{formatPesos(paid)} de {formatPesos(totalLand)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${ok ? 'bg-emerald-400' : difference < 0 ? 'bg-red-400' : 'bg-amber-400'}`}
          style={{ width: `${difference < 0 ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-200 sm:text-xs">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

function SubTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]">{children}</p>
      {right}
    </div>
  );
}

/** Etiqueta visible solo en celular (en computador la tabla tiene encabezados). */
function MobileLabel({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:hidden">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({ value, onChange, options, small = false }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  small?: boolean;
}) {
  return (
    <div className={`flex rounded-lg border border-zinc-700 p-0.5 ${small ? 'text-xs sm:text-[10px]' : 'text-sm sm:text-[11px]'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-3 py-1.5 sm:px-2.5 sm:py-1 ${value === o.value ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Fila valor + fecha + quitar (separaciones y extraordinarias). */
function AmountDateRow({ index, amount, date, removeLabel, onAmount, onDate, onRemove }: {
  index: number;
  amount: number;
  date: string;
  removeLabel: string;
  onAmount: (v: number) => void;
  onDate: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden w-4 shrink-0 text-center text-[11px] text-zinc-600 sm:block">{index}</span>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 sm:grid-cols-2">
        <MoneyInput value={amount} onChange={onAmount} />
        <input type="date" className={`${inputCls} max-sm:!px-2`} value={date} onChange={(e) => onDate(e.target.value)} aria-label={`Fecha ${index}`} />
      </div>
      <RemoveButton label={removeLabel} onClick={onRemove} />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="-mx-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-300 sm:h-8 sm:w-8"
    >
      <Trash2 size={15} />
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-emerald-300 hover:text-emerald-200 sm:min-h-0 sm:text-[11px]"
    >
      <Plus size={14} /> {children}
    </button>
  );
}

function CheckLine({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-zinc-200' : ''}>{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-zinc-100' : ''}`}>{value}</dd>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 sm:px-2.5 ${strong ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-zinc-800'}`}>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 sm:text-[10px]">{label}</p>
      <p className={`text-sm font-semibold sm:text-xs ${strong ? 'text-emerald-200' : 'text-zinc-200'}`}>{formatPesos(value)}</p>
    </div>
  );
}

/** Pesos con separador de miles mientras se escribe. */
function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 sm:left-2.5 sm:text-xs">$</span>
      <input
        className={`${inputCls} pl-6 sm:pl-5`}
        inputMode="numeric"
        enterKeyHint="next"
        value={value ? value.toLocaleString('es-CO').replace(/,/g, '.') : ''}
        placeholder="0"
        onChange={(e) => onChange(parsePesos(e.target.value))}
      />
    </div>
  );
}
