import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Clock, Loader2, MapPin, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { DealField as Field, DealSheet, dealInputCls as inputCls } from './DealSheet';
import {
  formatArea,
  getDealPriceOptions,
  saveDealPlan,
  requestPlanApproval,
  checkPlanApprovalStatus,
  type DealSummary,
  type PriceOption,
} from '../services/deals.service';
import {
  addMonths,
  buildSimpleRows,
  formatDMY,
  formatMonthYear,
  formatPesos,
  checkTerm,
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

/** Valor del selector de plazo para el plazo especial (por fuera de la lista de precios). */
const SPECIAL = 'especial';

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
  const draftCandidate = (deal as any).draftPlan || (deal.planApproval as any)?.planDraft;
  const draftMatches = draftCandidate && (!deal.lot || !draftCandidate.lotId || draftCandidate.lotId === deal.lot.inventoryLotId);
  const saved = (deal.plan && deal.plan.lotId === deal.lot?.inventoryLotId ? deal.plan : null) || (draftMatches ? draftCandidate : null);
  const start = today();

  const [options, setOptions] = useState<PriceOption[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [earnestPercent, setEarnestPercent] = useState(30);
  const [termMonths, setTermMonths] = useState<number | null>(saved?.termMonths ?? null);
  const [listPrice, setListPrice] = useState<number | null>(saved?.listPrice ?? null);
  // Plazo especial: meses y valor negociados por fuera de la lista (los aprueba gerencia).
  // Los planes viejos con "Valor manual" (sin precio de lista) o con solicitud pendiente se abren como especiales.
  const [special, setSpecial] = useState(
    saved
      ? !!saved.specialTerm || saved.listPrice == null || !!deal.planApproval
      : !!deal.planApproval
  );
  const [approvedBy, setApprovedBy] = useState(saved?.specialTerm?.approvedBy ?? '');
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
        // Lote que no está en la lista: el plazo y el valor se escriben a mano.
        if (!saved && !res.options.length) setSpecial(true);
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

  // ─── Aprobación de plazo especial por WhatsApp (Gerencia) ───
  const [approvalMethod, setApprovalMethod] = useState<'whatsapp' | 'manual'>('whatsapp');
  const initialPhone = (deal.planApproval?.approverPhone?.replace(/^\+57/, '') || '3148209662');
  const [approverPhone, setApproverPhone] = useState(initialPhone === '3148209692' ? '3148209662' : initialPhone);
  const [approverName, setApproverName] = useState(deal.planApproval?.approverName || 'Don Jhon (Gerencia)');
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>(
    deal.planApproval?.status ?? (deal.plan?.specialTerm?.approvedBy ? 'approved' : 'none')
  );
  const [approvalNotes, setApprovalNotes] = useState<string>(deal.planApproval?.responseNotes ?? '');
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [quickActionUrl, setQuickActionUrl] = useState<string | null>(
    (deal.planApproval as any)?.quickActionUrl ?? null
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);

  // Sondeo cada 4 segundos mientras la aprobación esté pendiente
  useEffect(() => {
    if (approvalStatus !== 'pending') return;
    const interval = setInterval(async () => {
      try {
        const res = await checkPlanApprovalStatus(companyId, deal.id);
        if (res.quickActionUrl) setQuickActionUrl(res.quickActionUrl);
        if (res.status === 'approved') {
          setApprovalStatus('approved');
          const who = res.approvedBy || `Gerencia (${approverPhone})`;
          setApprovedBy(who);
          if (res.responseNotes) setApprovalNotes(res.responseNotes);
          setCheckNotice('✅ ¡Autorizado por Gerencia! El plan quedó desbloqueado.');
        } else if (res.status === 'rejected') {
          setApprovalStatus('rejected');
          if (res.responseNotes) setApprovalNotes(res.responseNotes);
          setCheckNotice('❌ El plan fue rechazado por Gerencia.');
        }
      } catch {
        // sondeo silencioso
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [approvalStatus, companyId, deal.id, approverPhone]);

  const handleCheckStatus = async (): Promise<boolean> => {
    setCheckingApproval(true);
    setCheckNotice(null);
    try {
      const res = await checkPlanApprovalStatus(companyId, deal.id);
      if (res.quickActionUrl) setQuickActionUrl(res.quickActionUrl);
      if (res.status === 'approved') {
        setApprovalStatus('approved');
        const who = res.approvedBy || `Gerencia (${approverPhone})`;
        setApprovedBy(who);
        if (res.responseNotes) setApprovalNotes(res.responseNotes);
        setCheckNotice('✅ ¡Autorizado por Gerencia! El plan quedó desbloqueado.');
        return true;
      } else if (res.status === 'rejected') {
        setApprovalStatus('rejected');
        if (res.responseNotes) setApprovalNotes(res.responseNotes);
        setCheckNotice('❌ El plan fue rechazado por Gerencia.');
        return false;
      } else {
        setCheckNotice(`⏳ Aún pendiente: Esperando que el jefe toque "AUTORIZADO" en WhatsApp (${approverPhone}).`);
        return false;
      }
    } catch {
      setCheckNotice('Error al verificar el estado con el servidor.');
      return false;
    } finally {
      setCheckingApproval(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!deal.lot) {
      setError('Debes tener un lote seleccionado para solicitar aprobación.');
      return;
    }
    if (landValue <= 0) {
      setError('Escribe el valor del terreno antes de solicitar aprobación.');
      return;
    }
    setError(null);
    setRequestingApproval(true);
    setCheckNotice(null);
    try {
      const sepParts: string[] = [];
      if (simple.separationPayments && simple.separationPayments.length) {
        simple.separationPayments.forEach((p) => {
          sepParts.push(`${formatPesos(p.amount)} (${p.date})`);
        });
      } else {
        sepParts.push(`${formatPesos(summary.separationTotal)} en ${simple.separationCount} pago(s) desde ${simple.separationFirstDate}`);
      }

      const ordinaryInsts = summary.installments.filter((i) => i.kind === 'ordinaria');
      let ordSummary = '';
      if (ordinaryInsts.length > 0) {
        const ordVal = Math.round(summary.ordinaryTotal / ordinaryInsts.length);
        ordSummary = `${ordinaryInsts.length} cuota${ordinaryInsts.length === 1 ? '' : 's'} de ${formatPesos(ordVal)} (total: ${formatPesos(summary.ordinaryTotal)})`;
      } else {
        ordSummary = 'Sin cuotas ordinarias';
      }

      const extraParts = (simple.extraordinary || []).map((e) => `• ${formatPesos(e.amount)} (${e.date})`);

      const planDraft = {
        lotId: deal.lot?.inventoryLotId || '',
        mode,
        simple,
        listPrice,
        landValue,
        termMonths: termMonths ?? 0,
        benefit,
        severance,
        rows: effectiveRows,
        referredBy,
        notes,
      };

      const res = await requestPlanApproval(
        companyId,
        deal.id,
        approverPhone,
        {
          termMonths: termMonths ?? 0,
          landValue,
          listPrice,
          benefit,
          totalLand: summary.totalLand,
          separationSummary: sepParts.join(' + '),
          ordinarySummary: ordSummary,
          extraordinarySummary: extraParts.join('\n'),
          severanceSummary: severanceAmount > 0 ? `${formatPesos(severanceAmount)}${severanceFund ? ` (${severanceFund})` : ''}` : '',
          referredBy,
          notes,
        },
        approverName,
        planDraft,
      );
      setApprovalStatus('pending');
      (deal as any).draftPlan = planDraft;
      (deal as any).planApproval = {
        status: 'pending',
        approverPhone,
        approverName,
        quickActionUrl: res?.quickActionUrl,
        planDraft,
      };
      if (res?.quickActionUrl) setQuickActionUrl(res.quickActionUrl);
      setCheckNotice('📲 Propuesta enviada a WhatsApp. El borrador quedó guardado y seguro en el sistema.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al enviar la solicitud por WhatsApp.');
    } finally {
      setRequestingApproval(false);
    }
  };

  const pickTerm = (value: string) => {
    if (value === SPECIAL) {
      // Se conserva lo que había (meses y valor) como punto de partida para negociar.
      setSpecial(true);
      setListPrice(null);
      return;
    }
    const opt = options.find((o) => o.termMonths === Number(value));
    if (!opt) return;
    setSpecial(false);
    setTermMonths(opt.termMonths);
    setListPrice(opt.price);
    setLandValue(opt.price);
    if (mode === 'simple') setSimple((s) => ({ ...s, ordinaryCount: Math.max(1, opt.termMonths) }));
  };

  /** Meses negociados del plazo especial ('' = sin escribir). Ajusta las ordinarias como la lista. */
  const setSpecialMonths = (value: string) => {
    if (value.trim() === '') { setTermMonths(null); return; }
    const months = Math.min(240, Math.max(0, Math.round(Number(value) || 0)));
    setTermMonths(months);
    if (mode === 'simple' && months > 0) setSimple((s) => ({ ...s, ordinaryCount: months }));
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
        listPrice: special ? null : listPrice,
        landValue,
        termMonths: termMonths ?? 0,
        specialTerm: special ? { approvedBy: approvedBy.trim() } : null,
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
  // Plazo de la lista de precios: todas las cuotas deben caber desde la primera ordinaria.
  const term = checkTerm(summary.installments, termMonths);
  const termEndMonth = term?.end.slice(0, 7);
  const isOutsideTerm = (date: string) => !!termEndMonth && !!date && date.slice(0, 7) > termEndMonth;
  const termAlert = term && term.outside.length > 0
    ? `Se pasa del plazo de ${term.termMonths} meses: ${term.outside.length === 1 ? '1 cuota queda' : `${term.outside.length} cuotas quedan`} después de ${formatMonthYear(term.end)} (el plazo va de ${formatMonthYear(term.start)} a ${formatMonthYear(term.end)}).`
    : null;
  // Plazo especial: hay que escribir los meses y, si el lote está en la lista, quién lo aprobó.
  const specialIssue = !special ? null
    : termMonths === null ? 'Escribe los meses negociados del plazo especial.'
      : options.length > 0 && !approvedBy.trim()
        ? approvalMethod === 'whatsapp'
          ? (approvalStatus === 'pending'
              ? 'Esperando que gerencia autorice el plan por WhatsApp...'
              : approvalStatus === 'rejected'
                ? 'El plan fue rechazado por gerencia. Ajusta los valores o plazo.'
                : 'Solicita la autorización por WhatsApp a gerencia antes de guardar.')
          : 'Escribe quién aprobó el plazo especial.'
        : null;
  // Pasarse del plazo bloquea guardar, igual que si el plan no cuadra (el servidor también lo revisa).
  const canSave = summary.issues.length === 0 && !termAlert && !specialIssue;

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
          {termAlert && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 sm:text-[11px]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{termAlert} Corrige las fechas para poder guardar.</span>
            </p>
          )}
          {specialIssue && !error && (
            <p className="text-xs font-medium text-amber-300 sm:text-[11px]">{specialIssue}</p>
          )}
          {summary.issues.length > 0 && !error && (
            <p className="line-clamp-2 text-xs text-amber-300/90 sm:text-[11px]">{summary.issues[0]}{summary.issues.length > 1 ? ` (+${summary.issues.length - 1} más)` : ''}</p>
          )}
          {approvalStatus === 'pending' ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
              <span className="text-[11px] text-amber-200 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                Propuesta de {termMonths} meses guardada en borrador esperando respuesta de Gerencia.
              </span>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSaved();
                    onClose();
                  }}
                  className="h-10 sm:h-auto sm:px-3 sm:py-1.5 text-xs border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                >
                  Cerrar y esperar
                </Button>
                <Button
                  onClick={handleCheckStatus}
                  loading={checkingApproval}
                  className="h-10 sm:h-auto sm:px-3 sm:py-1.5 text-xs bg-amber-600 text-white hover:bg-amber-500"
                >
                  Comprobar WhatsApp
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  if (draftCandidate) {
                    onSaved();
                  }
                  onClose();
                }}
                className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs"
              >
                Cancelar
              </Button>
              <Button onClick={handleSave} loading={saving} disabled={!canSave} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
                Guardar plan
              </Button>
            </div>
          )}
        </div>
      }
    >
      {/* Cierre del negocio */}
      <Section title="Cierre del negocio">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Plazo"
            hint={loadingPrices ? (
              <p className="mt-1 text-[11px] text-zinc-500">Cargando precios…</p>
            ) : !options.length && (
              <p className="mt-1 text-[11px] text-zinc-500">Este lote no está en la lista de precios: escribe el plazo y el valor.</p>
            )}
          >
            <select className={inputCls} value={special ? SPECIAL : (termMonths ?? '')} onChange={(e) => pickTerm(e.target.value)}>
              {!special && termMonths === null && <option value="">Seleccionar</option>}
              {options.map((o) => (
                <option key={o.termMonths} value={o.termMonths}>
                  {o.termMonths === 0 ? 'De contado' : `${o.termMonths} meses`} · {formatPesos(o.price)}
                </option>
              ))}
              <option value={SPECIAL}>{options.length ? 'Plazo especial (aprobado por gerencia)' : 'Plazo y valor a mano'}</option>
            </select>
          </Field>
          {special && (
            <div className="rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-amber-950/20 p-3.5 sm:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs">⭐</span>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-200">Plazo / Plan Especial</h4>
                    <p className="text-[11px] text-amber-300/70">Requiere autorización de gerencia general</p>
                  </div>
                </div>

                <div className="flex items-center rounded-lg border border-amber-500/30 bg-zinc-900/80 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setApprovalMethod('whatsapp')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                      approvalMethod === 'whatsapp' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>📲 WhatsApp (Recomendado)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovalMethod('manual')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                      approvalMethod === 'manual' ? 'bg-amber-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>✍️ Firma física / Feria</span>
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Meses negociados">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={240}
                    className={inputCls}
                    value={termMonths ?? ''}
                    placeholder="Ej: 36 (0 = contado)"
                    onChange={(e) => setSpecialMonths(e.target.value)}
                  />
                </Field>

                {approvalMethod === 'manual' ? (
                  <div className="sm:col-span-2">
                    <Field label="Aprobado por (Nombre de quien firmó)">
                      <input
                        className={inputCls}
                        value={approvedBy}
                        placeholder="Ej: Don Jhon / Formato feria firmado"
                        autoComplete="off"
                        onChange={(e) => setApprovedBy(e.target.value)}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <Field label="Celular para autorización WhatsApp (Gerencia)">
                      <div className="flex gap-2">
                        <input
                          className={inputCls}
                          value={approverPhone}
                          placeholder="Ej: 3148209662"
                          onChange={(e) => setApproverPhone(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setApproverPhone('3148209662');
                            setApproverName('Gerencia (3148209662)');
                          }}
                          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-[10px] text-zinc-300 hover:bg-zinc-700"
                          title="Número de pruebas asignado"
                        >
                          🧪 Prueba
                        </button>
                      </div>
                    </Field>
                  </div>
                )}
              </div>

              {approvalMethod === 'whatsapp' && (
                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/90 p-3">
                  {approvalStatus === 'none' && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-[12px] text-zinc-300">
                        <p className="font-semibold text-white">Solicitar autorización a Don Jhon por WhatsApp</p>
                        <p className="text-[11px] text-zinc-400">
                          Se enviará la propuesta detallada por la Línea 317 al <span className="font-mono text-emerald-400">{approverPhone}</span>.
                          Él podrá responder directamente <b>AUTORIZADO</b> o pulsar 1 botón.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRequestApproval}
                        disabled={requestingApproval || (!termMonths && termMonths !== 0)}
                        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {requestingApproval ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Enviando WhatsApp...</span>
                          </>
                        ) : (
                          <>
                            <span>📲 Solicitar por WhatsApp</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {approvalStatus === 'pending' && (
                    <div className="flex flex-col gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                          </span>
                          <span className="text-xs font-bold text-amber-200">
                            Esperando autorización de Gerencia en WhatsApp ({approverPhone})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCheckStatus}
                            disabled={checkingApproval}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30"
                          >
                            <Loader2 className={`h-3 w-3 ${checkingApproval ? 'animate-spin' : ''}`} />
                            <span>Comprobar</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleRequestApproval}
                            disabled={requestingApproval}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                          >
                            {requestingApproval && <Loader2 className="h-3 w-3 animate-spin" />}
                            <span>Reenviar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setApprovalStatus('none')}
                            className="text-[11px] text-zinc-400 underline hover:text-zinc-200"
                            title="Cambiar número o condiciones"
                          >
                            Cambiar número
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-amber-300/90 leading-relaxed">
                        El mensaje con la propuesta fue enviado. Cuando el jefe responda <strong>"AUTORIZADO"</strong> en WhatsApp o abra el enlace, esta ventana se desbloqueará automáticamente.
                      </p>

                      {checkNotice && (
                        <div className={`rounded-md p-2 text-xs font-semibold ${
                          checkNotice.includes('✅')
                            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                            : checkNotice.includes('❌')
                              ? 'bg-red-500/20 text-red-200 border border-red-500/40'
                              : 'bg-amber-500/20 text-amber-100 border border-amber-500/30'
                        }`}>
                          {checkNotice}
                        </div>
                      )}

                      {quickActionUrl && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 pt-2 border-t border-amber-500/20">
                          <a
                            href={quickActionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-600/30 px-2.5 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-600/40 transition"
                          >
                            ⚡ Abrir pantalla de autorización directa
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(quickActionUrl);
                              setCopiedUrl(true);
                              setTimeout(() => setCopiedUrl(false), 2500);
                            }}
                            className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-300 hover:text-white"
                          >
                            {copiedUrl ? '✓ Enlace copiado' : 'Copiar enlace'}
                          </button>
                        </div>
                      )}

                      <div className="rounded-md bg-zinc-950/40 p-2 text-[10px] text-zinc-400 leading-snug">
                        💡 <strong>¿No te llega el WhatsApp?</strong> Por políticas de Meta (WhatsApp), si tu número nunca le ha escrito a la línea oficial (+57 317 682 0728), WhatsApp bloquea los mensajes salientes. Pide a gerencia que envíe un <em>"Hola"</em> desde su WhatsApp al <strong>317 682 0728</strong> y toca <strong>Reenviar</strong>. La autorización solo la puede dar gerencia.
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-amber-500/20">
                        <span className="text-[11px] text-amber-200/90">
                          💾 <strong>Propuesta guardada:</strong> El plazo de <b>{termMonths} meses</b>, valores y cuotas no se perderán si cierras esta ventana.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onSaved();
                            onClose();
                          }}
                          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition"
                        >
                          Cerrar y esperar en segundo plano
                        </button>
                      </div>
                    </div>
                  )}

                  {approvalStatus === 'approved' && (
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400">✅</span>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-emerald-200">¡Plan Especial Autorizado por Gerencia!</p>
                          <p className="text-[11px] text-emerald-300/80">
                            {approvedBy ? `Registrado como: ${approvedBy}` : 'Autorizado vía WhatsApp'}
                            {approvalNotes ? ` · Respuesta: "${approvalNotes}"` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setApprovalStatus('none')}
                          className="text-[10px] text-zinc-400 underline hover:text-zinc-200"
                        >
                          Cambiar
                        </button>
                      </div>
                    </div>
                  )}

                  {approvalStatus === 'rejected' && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-red-400">❌</span>
                          <div>
                            <p className="text-xs font-bold text-red-200">Propuesta rechazada por Gerencia</p>
                            {approvalNotes && <p className="text-[11px] text-red-300/80">Motivo: "{approvalNotes}"</p>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setApprovalStatus('none')}
                          className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                        >
                          Ajustar y reintentar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300">
                Valor total del terreno (Precio lista)
              </label>
              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                Arras ({earnestPercent}%): {formatPesos(earnest)}
              </span>
            </div>
            <MoneyInput value={landValue} onChange={setLandValue} />
            {listPrice !== null && listPrice !== landValue && (
              <p className="text-[11px] text-amber-300/90">Distinto al de lista ({formatPesos(listPrice)}).</p>
            )}
            <p className="text-[10px] text-zinc-400">
              * Las arras del {earnestPercent}% se liquidan sobre el valor total ({formatPesos(landValue)}), sin restar el bono.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:contents">
            <Field label="Beneficio / Bono descuento">
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

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Total a pagar por el cliente
              </span>
              <span className="text-lg sm:text-base font-extrabold text-white">
                {formatPesos(summary.totalLand)}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400 pt-0.5 border-t border-emerald-500/20">
              <span>{formatPesos(landValue)} (Total terreno) − {formatPesos(benefit)} (Bono)</span>
              {benefit > 0 && (
                <span className="font-semibold text-amber-300">Bono aplicado: −{formatPesos(benefit)}</span>
              )}
            </div>
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
                        {term && isOutsideTerm(range.toDate) && (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} className="shrink-0" /> Fuera del plazo: va hasta {formatMonthYear(term.end)}.</p>
                        )}
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
                  <Field
                    label="Primera cuota"
                    hint={term && (
                      <p className={`mt-1 text-[11px] ${term.outside.length ? 'text-amber-300' : 'text-zinc-500'}`}>
                        Plazo de {term.termMonths} meses: hasta {formatMonthYear(term.end)}.
                      </p>
                    )}
                  >
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
                      warning={isOutsideTerm(e.date) && term ? `Fuera del plazo: va hasta ${formatMonthYear(term.end)}.` : undefined}
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
                {term && (r.kind === 'ordinaria' || r.kind === 'extraordinaria') && r.count > 0 && r.firstDate
                  && isOutsideTerm(addMonths(r.firstDate, r.count - 1)) && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} className="shrink-0" /> Termina {formatMonthYear(addMonths(r.firstDate, r.count - 1))}: fuera del plazo (hasta {formatMonthYear(term.end)}).</p>
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
            onClick={async () => {
              setVerifiedSignature(verificationSignature);
              if (special && approvalMethod === 'whatsapp' && approvalStatus !== 'approved') {
                await handleCheckStatus();
              }
            }}
            disabled={checkingApproval}
            className="min-h-[40px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 sm:min-h-0"
          >
            {checkingApproval ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {isVerified ? 'Plan comprobado' : 'Comprobar plan'}
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
            !canSave
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
          }`}>
            <p className="flex items-center gap-1.5 text-sm font-semibold sm:text-xs">
              {!canSave ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {summary.issues.length
                ? 'La comprobación encontró diferencias en los valores'
                : termAlert
                  ? 'Los valores cuadran, pero hay cuotas fuera del plazo'
                  : special && approvalStatus === 'pending'
                    ? 'Los valores cuadran perfectamente, pero está pendiente la autorización de Gerencia en WhatsApp'
                    : special && approvalStatus === 'rejected'
                      ? 'Los valores cuadran, pero el plazo especial fue rechazado por Gerencia'
                      : special && !approvedBy.trim()
                        ? 'Los valores cuadran, pero falta registrar la aprobación del plazo especial'
                        : 'Comprobación correcta: todos los valores cuadran y el plan está autorizado'}
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
              {special && (
                <>
                  <div className="my-1.5 border-t border-white/10" />
                  <div className="flex items-center justify-between py-1 text-xs">
                    <span className="font-semibold text-zinc-400">Autorización Gerencia</span>
                    <span className="font-bold">
                      {approvalStatus === 'approved' ? (
                        <span className="text-emerald-300 inline-flex items-center gap-1">
                          <CheckCircle2 size={13} /> Aprobado ({approvedBy || 'WhatsApp'})
                        </span>
                      ) : approvalStatus === 'rejected' ? (
                        <span className="text-red-400">❌ Rechazado</span>
                      ) : approvalStatus === 'pending' ? (
                        <span className="text-amber-300 inline-flex items-center gap-1">
                          <Clock size={13} className="animate-spin" /> Pendiente en WhatsApp ({approverPhone})
                        </span>
                      ) : (
                        <span className="text-amber-300">⚠️ Requiere solicitud</span>
                      )}
                    </span>
                  </div>
                </>
              )}
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
        {termAlert && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 sm:text-[11px]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {termAlert}
          </p>
        )}
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
function AmountDateRow({ index, amount, date, removeLabel, warning, onAmount, onDate, onRemove }: {
  index: number;
  /** Aviso bajo la fila (p. ej. la fecha se sale del plazo). */
  warning?: string;
  amount: number;
  date: string;
  removeLabel: string;
  onAmount: (v: number) => void;
  onDate: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="hidden w-4 shrink-0 text-center text-[11px] text-zinc-600 sm:block">{index}</span>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 sm:grid-cols-2">
          <MoneyInput value={amount} onChange={onAmount} />
          <input
            type="date"
            className={`${inputCls} max-sm:!px-2 ${warning ? '!border-amber-500/70' : ''}`}
            value={date}
            onChange={(e) => onDate(e.target.value)}
            aria-label={`Fecha ${index}`}
            aria-invalid={!!warning}
          />
        </div>
        <RemoveButton label={removeLabel} onClick={onRemove} />
      </div>
      {warning && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300 sm:pl-6"><AlertTriangle size={11} className="shrink-0" /> {warning}</p>}
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
