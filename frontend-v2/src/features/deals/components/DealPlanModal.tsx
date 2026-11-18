import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Calculator, Check, CheckCircle2, ChevronDown, Clock, Loader2, MapPin, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { InfoTip } from '@/shared/components/Tooltip';
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
  isValidDate,
  monthlyInstallmentCount,
  nextRangeStartDate,
  parsePesos,
  rangeEndDate,
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

const INVALID_CALENDAR_MSG = 'Esa fecha no existe en el calendario (revisa los días del mes; ej. febrero solo tiene 28 días, o 29 en año bisiesto).';

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
  const [approverName] = useState(deal.planApproval?.approverName || 'Don Jhon (Gerencia)');
  const [requestingApproval, setRequestingApproval] = useState(false);
  const rawApprStatus = deal.planApproval?.status;
  const initialApprovalStatus: 'none' | 'pending' | 'approved' | 'rejected' =
    rawApprStatus === 'pending' || rawApprStatus === 'approved' || rawApprStatus === 'rejected'
      ? rawApprStatus
      : (deal.plan?.specialTerm?.approvedBy ? 'approved' : 'none');
  const [approvalStatus, setApprovalStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>(initialApprovalStatus);
  const planFingerprint = `${termMonths ?? ''}|${landValue}|${benefit}|${severanceAmount}`;
  const requestedFingerprintRef = useRef<string | null>(
    initialApprovalStatus === 'pending' ? planFingerprint : null,
  );
  const [approvedFingerprint, setApprovedFingerprint] = useState<string | null>(
    initialApprovalStatus === 'approved' ? planFingerprint : null,
  );
  const [approvalNotes, setApprovalNotes] = useState<string>(deal.planApproval?.responseNotes ?? '');
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [quickActionUrl, setQuickActionUrl] = useState<string | null>(
    (deal.planApproval as any)?.quickActionUrl ?? null
  );
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [badDates, setBadDates] = useState<Record<string, boolean>>({});
  const markBadDate = (key: string, bad: boolean) => {
    setBadDates((prev) => {
      if (Boolean(prev[key]) === bad) return prev;
      if (bad) return { ...prev, [key]: true };
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const clearBadDatePrefix = (prefix: string) => {
    setBadDates((prev) => {
      const entries = Object.entries(prev).filter(([k]) => !k.startsWith(prefix));
      return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
    });
  };
  const hasBadDates = Object.keys(badDates).length > 0;

  type PlanStep = 1 | 2 | 3 | 4;
  const [activeStep, setActiveStep] = useState<PlanStep>(1);
  const [openSteps, setOpenSteps] = useState<Set<PlanStep>>(() => new Set([1]));
  const [step3Visited, setStep3Visited] = useState(() => Boolean(deal.plan));
  const stepRefs = useRef<Record<PlanStep, HTMLElement | null>>({ 1: null, 2: null, 3: null, 4: null });

  const goToStep = (next: PlanStep, collapsePrev?: PlanStep) => {
    if (next === 3 || collapsePrev === 3) setStep3Visited(true);
    setActiveStep(next);
    setOpenSteps((prev) => {
      const copy = new Set(prev);
      if (collapsePrev) copy.delete(collapsePrev);
      copy.add(next);
      return copy;
    });
    window.requestAnimationFrame(() => {
      stepRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const toggleStep = (step: PlanStep) => {
    if (step === 3) setStep3Visited(true);
    setActiveStep(step);
    setOpenSteps((prev) => {
      const copy = new Set(prev);
      if (copy.has(step)) copy.delete(step);
      else copy.add(step);
      return copy;
    });
  };

  // Sondeo cada 4 segundos mientras la aprobación esté pendiente
  useEffect(() => {
    if (approvalStatus !== 'pending') return;
    const interval = setInterval(async () => {
      try {
        const res = await checkPlanApprovalStatus(companyId, deal.id);
        if (res.quickActionUrl) setQuickActionUrl(res.quickActionUrl);
        if (res.status === 'approved') {
          setApprovalStatus('approved');
          setApprovedFingerprint(requestedFingerprintRef.current ?? planFingerprint);
          const who = res.approvedBy || `Gerencia (${approverPhone})`;
          setApprovedBy(who);
          if (res.responseNotes) setApprovalNotes(res.responseNotes);
          setCheckNotice('✅ ¡Autorizado por Gerencia! El plan quedó desbloqueado.');
        } else if (res.status === 'rejected') {
          setApprovalStatus('rejected');
          setApprovedFingerprint(null);
          if (res.responseNotes) setApprovalNotes(res.responseNotes);
          setCheckNotice('❌ El plan fue rechazado por Gerencia.');
        } else if (res.status === 'cancelled' || res.status === 'superseded' || res.status === 'none') {
          setApprovalStatus('none');
          setApprovedFingerprint(null);
          setCheckNotice('La solicitud pendiente anterior fue anulada o reemplazada.');
        }
      } catch {
        // sondeo silencioso
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalStatus, companyId, deal.id, approverPhone]);

  const handleCheckStatus = async (): Promise<boolean> => {
    setCheckingApproval(true);
    setCheckNotice(null);
    try {
      const res = await checkPlanApprovalStatus(companyId, deal.id);
      if (res.quickActionUrl) setQuickActionUrl(res.quickActionUrl);
      if (res.status === 'approved') {
        setApprovalStatus('approved');
        setApprovedFingerprint(requestedFingerprintRef.current ?? planFingerprint);
        const who = res.approvedBy || `Gerencia (${approverPhone})`;
        setApprovedBy(who);
        if (res.responseNotes) setApprovalNotes(res.responseNotes);
        setCheckNotice('✅ ¡Autorizado por Gerencia! El plan quedó desbloqueado.');
        return true;
      } else if (res.status === 'rejected') {
        setApprovalStatus('rejected');
        setApprovedFingerprint(null);
        if (res.responseNotes) setApprovalNotes(res.responseNotes);
        setCheckNotice('❌ El plan fue rechazado por Gerencia.');
        return false;
      } else if (res.status === 'cancelled' || res.status === 'superseded' || res.status === 'none') {
        setApprovalStatus('none');
        setApprovedFingerprint(null);
        setCheckNotice('La solicitud pendiente anterior fue anulada o reemplazada.');
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
    if (summary.issues.length > 0) {
      setError(`Ajusta el plan antes de enviarlo a Gerencia: ${summary.issues[0]}`);
      return;
    }
    if (termAlert) {
      setError(`${termAlert} Corrige las fechas antes de solicitar aprobación.`);
      return;
    }
    setError(null);
    setRequestingApproval(true);
    setCheckNotice(null);
    try {
      const sepGroups = groupInstallments(summary.installments.filter((i) => i.kind === 'separacion'));
      const sepParts = sepGroups.length
        ? sepGroups.map((g) => (g.count > 1 ? `${g.count} cuotas de ${formatPesos(g.amount)} (${formatDMY(g.from)} a ${formatDMY(g.to)})` : `${formatPesos(g.amount)} (${formatDMY(g.from)})`))
        : [`${formatPesos(summary.separationTotal)}`];

      const ordGroups = groupInstallments(summary.installments.filter((i) => i.kind === 'ordinaria'));
      const ordSummary = ordGroups.length > 0
        ? `${ordGroups.map((g) => `${g.count} de ${formatPesos(g.amount)}`).join(' + ')} (total: ${formatPesos(summary.ordinaryTotal)})`
        : 'Sin cuotas ordinarias';

      const extraInsts = summary.installments.filter((i) => i.kind === 'extraordinaria');
      const extraParts = extraInsts.map((e) => `• ${formatPesos(e.amount)} (${e.date})`);

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
      requestedFingerprintRef.current = planFingerprint;
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
    if (next === 'simple' && mode === 'especifico' && rows.length > 0) {
      if (!window.confirm('Al volver a modo automático se recalcularán las cuotas desde cero y se descartarán los ajustes manuales de la tabla. ¿Continuar?')) {
        return;
      }
    }
    // Al pasar a específico se parte de las filas que generó el modo simple.
    if (next === 'especifico' && mode === 'simple') setRows(buildSimpleRows(simple, amounts));
    setBadDates({});
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
    clearBadDatePrefix('ord-');
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
  const approvalStale = approvalMethod === 'whatsapp'
    && approvalStatus === 'approved'
    && approvedFingerprint !== null
    && approvedFingerprint !== planFingerprint;

  // Plazo especial: hay que escribir los meses y, si el lote está en la lista, quién lo aprobó.
  const specialIssue = !special ? null
    : termMonths === null ? 'Escribe los meses negociados del plazo especial.'
      : approvalStale ? 'Modificaste plazo, valor o beneficio después de la autorización; solicita nuevamente la aprobación por WhatsApp.'
        : options.length > 0 && !approvedBy.trim()
          ? approvalMethod === 'whatsapp'
            ? (approvalStatus === 'pending'
                ? 'Esperando que gerencia autorice el plan por WhatsApp...'
                : approvalStatus === 'rejected'
                  ? 'El plan fue rechazado por gerencia. Ajusta los valores o plazo.'
                  : 'Solicita la autorización por WhatsApp a gerencia antes de guardar.')
            : 'Escribe quién aprobó el plazo especial.'
          : null;
  // Pasarse del plazo o dejar una fecha inexistente (ej. 30 de febrero) bloquea guardar.
  const canSave = summary.issues.length === 0 && !termAlert && !specialIssue && !hasBadDates;

  const setExtraordinary = (list: SimpleInputs['extraordinary']) => setSimple({ ...simple, extraordinary: list });
  const setRanges = (list: NonNullable<SimpleInputs['ordinaryRanges']>) => setSimple({ ...simple, ordinaryRanges: list });

  const step1Complete = landValue > 0 && termMonths !== null && !specialIssue && !(severanceAmount > 0 && !severanceFund.trim());
  const step2Complete = !hasBadDates && !termAlert && summary.separationTotal > 0 && summary.difference === 0 && summary.issues.length === 0;
  const step3Complete = step3Visited || Boolean(deal.plan);
  const step4Complete = step1Complete && step2Complete && isVerified && canSave;

  const termLabel = special
    ? `Especial (${termMonths ?? '?'} m)`
    : termMonths === 0
      ? 'De contado'
      : termMonths !== null
        ? `${termMonths} meses`
        : 'Sin plazo';
  const netInstallmentsTarget = Math.max(0, summary.totalLand - severanceAmount);
  const step1Summary = `${termLabel} · Total cliente: ${formatPesos(summary.totalLand)}${benefit > 0 ? ` · Bono ${formatPesos(benefit)}` : ''}${severanceAmount > 0 ? ` · Cesantías ${formatPesos(severanceAmount)} · En cuotas: ${formatPesos(netInstallmentsTarget)}` : ''}`;
  const step2Summary = `Sep. ${formatPesos(summary.separationTotal)} · Ord. ${formatPesos(summary.ordinaryTotal)}${summary.extraordinaryTotal > 0 ? ` · Extra ${formatPesos(summary.extraordinaryTotal)}` : ''} · ${summary.difference === 0 ? 'Cuadra' : summary.difference > 0 ? `Faltan ${formatPesos(summary.difference)}` : `Sobran ${formatPesos(-summary.difference)}`}`;
  const step3Summary = `${referralName(referredBy) ? `Referido: ${referralName(referredBy)}` : 'Sin referido'}${notes.trim() ? ' · Con observaciones' : ''}`;
  const step4Summary = isVerified
    ? (canSave ? 'Plan comprobado y listo para guardar' : 'Comprobación con alertas pendientes')
    : 'Revisa el resumen final y pulsa "Comprobar plan"';

  const stepItems: Array<{ step: PlanStep; label: string; complete: boolean }> = [
    { step: 1, label: 'Plazo y valor', complete: step1Complete },
    { step: 2, label: 'Plan de pagos', complete: step2Complete },
    { step: 3, label: 'Referido y notas', complete: step3Complete },
    { step: 4, label: 'Comprobación', complete: step4Complete },
  ];

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
      bodyClassName="space-y-3"
      toolbar={
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {stepItems.map(({ step, label, complete }) => {
            const isActive = activeStep === step;
            return (
              <button
                key={step}
                type="button"
                onClick={() => goToStep(step)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                  isActive
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100'
                    : complete
                      ? 'border-emerald-500/30 bg-zinc-950/60 text-emerald-300 hover:border-emerald-500/50'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  complete
                    ? 'bg-emerald-500 text-zinc-950'
                    : isActive
                      ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50'
                      : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {complete ? <Check size={11} strokeWidth={3} /> : step}
                </span>
                <span className="truncate font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
      }
      footer={
        <div className="space-y-2.5">
          {/* Cuadre siempre visible: en celular el resumen queda muy abajo. */}
          <PlanBalance totalLand={summary.totalLand} paid={summary.installmentsTotal + severanceAmount} difference={summary.difference} />
          {error && <p className="text-xs text-red-300">{error}</p>}
          {hasBadDates && !error && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 sm:text-[11px]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{INVALID_CALENDAR_MSG}</span>
            </p>
          )}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                {activeStep < 4 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => goToStep((activeStep + 1) as PlanStep, activeStep)}
                    className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                  >
                    Siguiente etapa <ArrowRight size={13} />
                  </Button>
                )}
                <Button onClick={handleSave} loading={saving} disabled={!canSave} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
                  Guardar plan
                </Button>
              </div>
            </div>
          )}
        </div>
      }
    >
      {/* Etapa 1: Cierre del negocio */}
      <StepSection
        step={1}
        title="Plazo y valor del terreno"
        summary={step1Summary}
        complete={step1Complete}
        active={activeStep === 1}
        open={openSteps.has(1)}
        onToggle={() => toggleStep(1)}
        sectionRef={(el) => { stepRefs.current[1] = el; }}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Field
              label="Valor total del terreno (Precio lista)"
              hint={
                <div className="mt-1 space-y-0.5 text-[11px]">
                  {listPrice !== null && listPrice !== landValue && (
                    <p className="text-amber-300/90">Distinto al de lista ({formatPesos(listPrice)}).</p>
                  )}
                  <p className="flex items-center gap-1 text-zinc-400">
                    <span className="font-semibold text-emerald-300">Arras ({earnestPercent}%): {formatPesos(earnest)}</span>
                    <InfoTip text="Porcentaje contractual de arras calculado sobre el valor total del terreno antes de descuentos/bono." />
                  </p>
                </div>
              }
            >
              <MoneyInput value={landValue} onChange={setLandValue} />
            </Field>
          </div>
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
                      <input
                        className={inputCls}
                        value={approverPhone}
                        placeholder="Ej: 3148209662"
                        onChange={(e) => setApproverPhone(e.target.value)}
                      />
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
                    <div className={`rounded-lg border p-3 ${approvalStale ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
                      <div className="flex items-center gap-2">
                        <span className={approvalStale ? 'text-amber-400' : 'text-emerald-400'}>{approvalStale ? '⚠️' : '✅'}</span>
                        <div className="flex-1">
                          <p className={`text-xs font-bold ${approvalStale ? 'text-amber-200' : 'text-emerald-200'}`}>
                            {approvalStale ? 'Condiciones modificadas tras la autorización' : '¡Plan Especial Autorizado por Gerencia!'}
                          </p>
                          <p className={`text-[11px] ${approvalStale ? 'text-amber-300/80' : 'text-emerald-300/80'}`}>
                            {approvalStale
                              ? 'Cambiaste valor, plazo o beneficio. Solicita una nueva aprobación antes de guardar.'
                              : `${approvedBy ? `Registrado como: ${approvedBy}` : 'Autorizado vía WhatsApp'}${approvalNotes ? ` · Respuesta: "${approvalNotes}"` : ''}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setApprovalStatus('none');
                            setApprovedFingerprint(null);
                            setApprovedBy('');
                          }}
                          className="text-[10px] text-zinc-400 underline hover:text-zinc-200"
                        >
                          {approvalStale ? 'Solicitar de nuevo' : 'Cambiar'}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={<span className="inline-flex items-center gap-1">Beneficio / Bono descuento <InfoTip text="Descuento pactado con el cliente. Se registra como cuota bono descuento al final y no se cobra en cuotas." /></span>}>
              <MoneyInput value={benefit} onChange={setBenefit} />
            </Field>
            <Field label={<span className="inline-flex items-center gap-1">Cesantías <InfoTip text="Valor cubierto con cesantías del comprador. Se resta del total a pagar para calcular el saldo en cuotas." /></span>}>
              <MoneyInput value={severanceAmount} onChange={setSeveranceAmount} />
            </Field>
          </div>
          {severanceAmount > 0 && (
            <Field label="Fondo de cesantías">
              <input className={inputCls} value={severanceFund} onChange={(e) => setSeveranceFund(e.target.value)} placeholder="Ej: Porvenir" />
            </Field>
          )}

          <div className="space-y-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  Total a pagar por el cliente
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {formatPesos(landValue)} (Total terreno) − {formatPesos(benefit)} (Bono)
                  {benefit > 0 && <span className="ml-2 font-semibold text-amber-300">· Bono aplicado</span>}
                </p>
              </div>
              <span className="whitespace-nowrap text-xl font-extrabold text-white">
                {formatPesos(summary.totalLand)}
              </span>
            </div>
            {severanceAmount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-500/20 pt-2">
                <div>
                  <p className="text-[11px] font-semibold text-zinc-200">
                    Saldo a financiar en cuotas (descontando cesantías)
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {formatPesos(summary.totalLand)} − {formatPesos(severanceAmount)} ({severanceFund.trim() || 'Cesantías'})
                  </p>
                </div>
                <span className="whitespace-nowrap text-base font-extrabold text-emerald-300">
                  {formatPesos(netInstallmentsTarget)}
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              onClick={() => goToStep(2, 1)}
              className="h-10 sm:h-auto sm:px-4 sm:py-2 sm:text-xs"
            >
              Continuar a Etapa 2: Plan de pagos <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </StepSection>

      {/* Etapa 2: Cuotas */}
      <StepSection
        step={2}
        title="Plan de pagos"
        summary={step2Summary}
        complete={step2Complete}
        active={activeStep === 2}
        open={openSteps.has(2)}
        onToggle={() => toggleStep(2)}
        sectionRef={(el) => { stepRefs.current[2] = el; }}
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
                    onInvalidChange={(bad) => markBadDate(`sep-${i}`, bad)}
                    onRemove={() => {
                      clearBadDatePrefix('sep-');
                      setSeparationPayments((simple.separationPayments ?? []).filter((_, index) => index !== i));
                    }}
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
                <span className="inline-flex items-center gap-1.5">
                  Cuotas ordinarias
                  <InfoTip
                    text={
                      simple.ordinaryMode === 'rangos'
                        ? 'En cada rango se crea una cuota mensual del valor indicado, incluyendo las fechas inicial y final.'
                        : 'En modo Automáticas las cuotas se calculan con el saldo pendiente; en Por rangos defines bloques de meses con valor fijo.'
                    }
                  />
                </span>
              </SubTitle>
              {simple.ordinaryMode === 'rangos' ? (
                <div className="space-y-2.5">
                  {(simple.ordinaryRanges ?? []).map((range, i) => (
                    <OrdinaryRangeRow
                      key={i}
                      index={i}
                      range={range}
                      termEnd={term?.end}
                      isOutsideTerm={Boolean(term && range.toDate && isOutsideTerm(range.toDate))}
                      onChange={(patch) =>
                        setRanges((simple.ordinaryRanges ?? []).map((item, index) => (index === i ? { ...item, ...patch } : item)))
                      }
                      onInvalidFrom={(bad) => markBadDate(`ord-from-${i}`, bad)}
                      onInvalidTo={(bad) => markBadDate(`ord-to-${i}`, bad)}
                      onRemove={() => {
                        clearBadDatePrefix('ord-');
                        setRanges((simple.ordinaryRanges ?? []).filter((_, index) => index !== i));
                      }}
                    />
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <AddButton
                      onClick={() => {
                        const ranges = simple.ordinaryRanges ?? [];
                        const previous = ranges[ranges.length - 1];
                        const fromDate = nextRangeStartDate(ranges, simple.ordinaryFirstDate);
                        setRanges([...ranges, { amount: previous?.amount ?? 0, fromDate, toDate: fromDate }]);
                      }}
                    >
                      Agregar rango ordinario
                    </AddButton>
                    {(simple.ordinaryRanges ?? []).length > 0 && (() => {
                      const stats = (simple.ordinaryRanges ?? []).reduce(
                        (acc, r) => {
                          const c = monthlyInstallmentCount(r.fromDate, r.toDate);
                          return { count: acc.count + c, amount: acc.amount + c * r.amount };
                        },
                        { count: 0, amount: 0 },
                      );
                      return (
                        <p className="text-[11px] text-zinc-400">
                          Total rangos: <span className="font-semibold text-zinc-200">{stats.count} cuota{stats.count === 1 ? '' : 's'}</span> · <span className="font-semibold text-emerald-300">{formatPesos(stats.amount)}</span>
                        </p>
                      );
                    })()}
                  </div>
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
                    <PlanDateInput
                      value={simple.ordinaryFirstDate}
                      onChange={(v) => setSimple({ ...simple, ordinaryFirstDate: v })}
                      onInvalidChange={(bad) => markBadDate('ord-first', bad)}
                    />
                  </Field>
                  {/* Valor calculado: tarjeta informativa, no parece un campo editable. */}
                  <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 sm:col-span-1 sm:py-1.5">
                    <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]">
                      <span>Valor cuota ordinaria</span>
                      <InfoTip
                        size={11}
                        text="Se calcula automáticamente con lo que falta del total. Si la división no es exacta, el residuo se suma a la primera cuota (igual que en SmartHome)."
                      />
                    </p>
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
                      onInvalidChange={(bad) => markBadDate(`extra-${i}`, bad)}
                      onRemove={() => {
                        clearBadDatePrefix('extra-');
                        setExtraordinary(simple.extraordinary.filter((_, j) => j !== i));
                      }}
                    />
                  ))}
                </div>
              )}
              <AddButton onClick={() => setExtraordinary([...simple.extraordinary, { amount: 0, date: addMonths(simple.ordinaryFirstDate, 6) }])}>
                Agregar extraordinaria
              </AddButton>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                Filas manuales de cuotas
                <InfoTip text="Cada fila crea N cuotas mensuales del mismo valor desde la primera fecha indicada. Las filas en $0 se ignoran." />
              </span>
            </div>
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
                    <RemoveButton label="Quitar fila" onClick={() => {
                      clearBadDatePrefix('spec-');
                      setRows((prev) => prev.filter((_, j) => j !== i));
                    }} />
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
                    <PlanDateInput
                      value={r.firstDate}
                      showInlineMessage={false}
                      onChange={(v) => updateRow(i, { firstDate: v })}
                      onInvalidChange={(bad) => markBadDate(`spec-${i}`, bad)}
                    />
                  </MobileLabel>
                  <div className="hidden sm:block">
                    <RemoveButton label="Quitar fila" onClick={() => {
                      clearBadDatePrefix('spec-');
                      setRows((prev) => prev.filter((_, j) => j !== i));
                    }} />
                  </div>
                </div>
                {badDates[`spec-${i}`] && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} className="shrink-0" /> {INVALID_CALENDAR_MSG}</p>
                )}
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
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
          <span className={`text-xs font-medium ${summary.difference === 0 && !hasBadDates ? 'text-emerald-300' : 'text-amber-300'}`}>
            {hasBadDates
              ? 'Corrige las fechas inválidas'
              : summary.difference === 0
                ? 'Las cuotas cuadran con el valor total ✓'
                : summary.difference > 0
                  ? `Faltan ${formatPesos(summary.difference)} por asignar`
                  : `Sobran ${formatPesos(-summary.difference)}`}
          </span>
          <Button
            type="button"
            onClick={() => goToStep(3, 2)}
            className="h-10 sm:h-auto sm:px-4 sm:py-2 sm:text-xs"
          >
            Continuar a Etapa 3: Referido y notas <ArrowRight size={14} />
          </Button>
        </div>
      </StepSection>

      {/* Etapa 3: Referido y observaciones */}
      <StepSection
        step={3}
        title="Referido y observaciones"
        summary={step3Summary}
        complete={step3Complete}
        active={activeStep === 3}
        open={openSteps.has(3)}
        onToggle={() => toggleStep(3)}
        sectionRef={(el) => { stepRefs.current[3] = el; }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Referido por
                <InfoTip text="Si lo dejas vacío o escribes N/A, no se pedirá evidencia. Si indicas un nombre, el sistema solicitará el soporte en la pestaña Soportes." />
              </span>
            }
            hint={
              referralName(referredBy) ? (
                <p className="mt-1 text-[11px] text-emerald-300">
                  Se solicitará evidencia de referido en Soportes.
                </p>
              ) : undefined
            }
          >
            <input className={inputCls} value={referredBy} placeholder="Nombre de quien lo refirió" onChange={(e) => setReferredBy(e.target.value)} />
          </Field>
          <Field label="Observaciones">
            <textarea rows={3} className={`${inputCls} resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end border-t border-zinc-800/80 pt-3">
          <Button
            type="button"
            onClick={() => goToStep(4, 3)}
            className="h-10 sm:h-auto sm:px-4 sm:py-2 sm:text-xs"
          >
            Ir a Etapa 4: Comprobación y cierre <ArrowRight size={14} />
          </Button>
        </div>
      </StepSection>

      {/* Etapa 4: Resumen y comprobación final */}
      <StepSection
        step={4}
        title="Comprobación y resumen final"
        summary={step4Summary}
        complete={step4Complete}
        active={activeStep === 4}
        open={openSteps.has(4)}
        onToggle={() => toggleStep(4)}
        sectionRef={(el) => { stepRefs.current[4] = el; }}
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
            className="min-h-[36px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 sm:min-h-0"
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
        {!isVerified && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
            <p className="text-xs text-zinc-300">Pulsa <strong>Comprobar plan</strong> para verificar la cuenta detallada antes de guardar.</p>
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
              className="border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
            >
              {checkingApproval ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Comprobar plan
            </Button>
          </div>
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
      </StepSection>
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

function StepSection({ step, title, summary, complete, active, open, onToggle, right, sectionRef, children }: {
  step: number;
  title: string;
  summary: string;
  complete: boolean;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
  sectionRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={sectionRef}
      className={`scroll-mt-2 rounded-xl border transition-colors ${
        active
          ? 'border-emerald-500/45 bg-zinc-950/60 shadow-lg shadow-emerald-950/20'
          : complete
            ? 'border-emerald-500/25 bg-zinc-950/40'
            : 'border-zinc-800 bg-zinc-950/40'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left select-none hover:bg-zinc-900/50 ${open ? 'rounded-t-xl border-b border-zinc-800/80' : 'rounded-xl'}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              complete
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : active
                  ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40'
                  : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {complete ? <Check size={14} /> : step}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-100 sm:text-xs">{title}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                complete
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : active
                    ? 'bg-amber-500/15 text-amber-200'
                    : 'bg-zinc-800 text-zinc-400'
              }`}>
                {complete ? 'Completo' : active ? 'En curso' : 'Pendiente'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">{summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {open && right}
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? `Contraer etapa ${step}` : `Abrir etapa ${step}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <div className="p-4">{children}</div>}
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

/** Input de fecha con detección de fechas inexistentes en calendario (p. ej. 30 de febrero). */
function PlanDateInput({ value, onChange, className = '', invalid = false, showInlineMessage = true, onInvalidChange, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  invalid?: boolean;
  showInlineMessage?: boolean;
  onInvalidChange?: (isInvalid: boolean) => void;
  ariaLabel?: string;
}) {
  const [badInput, setBadInput] = useState(false);

  useEffect(() => {
    if (value && isValidDate(value) && badInput) {
      setBadInput(false);
      onInvalidChange?.(false);
    }
  }, [value, badInput, onInvalidChange]);

  const setBad = (next: boolean) => {
    setBadInput(next);
    onInvalidChange?.(next);
  };

  return (
    <div className="min-w-0">
      <input
        type="date"
        aria-label={ariaLabel}
        aria-invalid={badInput || invalid || undefined}
        className={`${inputCls} ${className} ${(badInput || invalid) ? '!border-amber-500/80' : ''}`}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next) {
            setBad(false);
            onChange(next);
            return;
          }
          if (e.target.validity.badInput) {
            setBad(true);
            onChange('');
            return;
          }
          setBad(false);
          onChange('');
        }}
        onBlur={(e) => {
          if (e.currentTarget.validity.badInput) {
            setBad(true);
          }
        }}
      />
      {showInlineMessage && badInput && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-300">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{INVALID_CALENDAR_MSG}</span>
        </p>
      )}
    </div>
  );
}

/** Input de cantidad de cuotas que permite borrar y reescribir sin bloquear el dígito. */
function RangeCountInput({ count, disabled, onChange }: {
  count: number;
  disabled?: boolean;
  onChange: (nextCount: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(count > 0 ? String(count) : '');

  useEffect(() => {
    if (!focused) setDraft(count > 0 ? String(count) : '');
  }, [count, focused]);

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={240}
      disabled={disabled}
      placeholder="1"
      className={inputCls}
      value={focused ? draft : (count > 0 ? String(count) : '')}
      onFocus={() => {
        setFocused(true);
        setDraft(count > 0 ? String(count) : '');
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(count > 0 ? String(count) : '');
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 240) {
          onChange(parsed);
        }
      }}
    />
  );
}

/** Rango mensual de cuotas ordinarias: permite elegir N cuotas o editar fechas con cálculo automático. */
function OrdinaryRangeRow({ index, range, termEnd, isOutsideTerm, onChange, onInvalidFrom, onInvalidTo, onRemove }: {
  index: number;
  range: { amount: number; fromDate: string; toDate: string };
  termEnd?: string;
  isOutsideTerm: boolean;
  onChange: (patch: Partial<{ amount: number; fromDate: string; toDate: string }>) => void;
  onInvalidFrom: (bad: boolean) => void;
  onInvalidTo: (bad: boolean) => void;
  onRemove: () => void;
}) {
  const [badFrom, setBadFrom] = useState(false);
  const [badTo, setBadTo] = useState(false);
  const count = monthlyInstallmentCount(range.fromDate, range.toDate);
  const validPair = isValidDate(range.fromDate) && isValidDate(range.toDate);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:border-0 sm:bg-transparent sm:p-0">
      <div className="mb-2 flex items-center justify-between sm:hidden">
        <span className="text-xs font-semibold text-zinc-300">
          Rango {index + 1}{count > 0 ? ` · ${count} cuota${count === 1 ? '' : 's'}` : ''}
        </span>
        <RemoveButton label="Quitar rango de cuotas ordinarias" onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.15fr_0.55fr_1fr_1fr_auto]">
        <Field label="Valor mensual" className="col-span-2 sm:col-span-1">
          <MoneyInput value={range.amount} onChange={(amount) => onChange({ amount })} />
        </Field>
        <Field label="Cuotas">
          <RangeCountInput
            count={count}
            disabled={!isValidDate(range.fromDate)}
            onChange={(nextCount) => {
              const nextTo = rangeEndDate(range.fromDate, nextCount);
              if (nextTo) onChange({ toDate: nextTo });
            }}
          />
        </Field>
        <Field label="Desde">
          <PlanDateInput
            value={range.fromDate}
            showInlineMessage={false}
            onInvalidChange={(bad) => { setBadFrom(bad); onInvalidFrom(bad); }}
            onChange={(newFrom) => {
              if (newFrom && isValidDate(newFrom) && count > 0) {
                onChange({ fromDate: newFrom, toDate: rangeEndDate(newFrom, count) });
              } else {
                onChange({ fromDate: newFrom, ...(!range.toDate && newFrom ? { toDate: newFrom } : {}) });
              }
            }}
          />
        </Field>
        <Field label="Hasta" className="col-span-2 sm:col-span-1">
          <PlanDateInput
            value={range.toDate}
            showInlineMessage={false}
            onInvalidChange={(bad) => { setBadTo(bad); onInvalidTo(bad); }}
            onChange={(toDate) => onChange({ toDate })}
          />
        </Field>
        <div className="hidden sm:block">
          <RemoveButton label="Quitar rango de cuotas ordinarias" onClick={onRemove} />
        </div>
      </div>

      {(badFrom || badTo) && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-300">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{INVALID_CALENDAR_MSG}</span>
        </p>
      )}
      {!badFrom && !badTo && count > 0 && validPair && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-200">{count} cuota{count === 1 ? '' : 's'}</span>
          {' · '}
          {count === 1 ? formatMonthYear(range.fromDate) : `${formatMonthYear(range.fromDate)} → ${formatMonthYear(range.toDate)}`}
          {range.amount > 0 && <>{' · '}Total: <span className="font-medium text-emerald-300">{formatPesos(count * range.amount)}</span></>}
        </p>
      )}
      {!badFrom && !badTo && range.fromDate && range.toDate && validPair && range.toDate < range.fromDate && (
        <p className="mt-1.5 text-[11px] text-amber-300">La fecha final debe ser igual o posterior a la fecha inicial.</p>
      )}
      {!badFrom && !badTo && range.fromDate && range.toDate && validPair && range.toDate >= range.fromDate && count === 0 && (
        <p className="mt-1.5 text-[11px] text-amber-300">La fecha final debe coincidir con una mensualidad desde &quot;Desde&quot;, o ajusta el campo Cuotas.</p>
      )}
      {isOutsideTerm && termEnd && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
          <AlertTriangle size={11} className="shrink-0" /> Fuera del plazo: va hasta {formatMonthYear(termEnd)}.
        </p>
      )}
    </div>
  );
}

/** Fila valor + fecha + quitar (separaciones y extraordinarias). */
function AmountDateRow({ index, amount, date, removeLabel, warning, onAmount, onDate, onInvalidChange, onRemove }: {
  index: number;
  /** Aviso bajo la fila (p. ej. la fecha se sale del plazo). */
  warning?: string;
  amount: number;
  date: string;
  removeLabel: string;
  onAmount: (v: number) => void;
  onDate: (v: string) => void;
  onInvalidChange?: (bad: boolean) => void;
  onRemove: () => void;
}) {
  const [badDate, setBadDate] = useState(false);
  const effectiveWarning = badDate ? INVALID_CALENDAR_MSG : warning;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="hidden w-4 shrink-0 text-center text-[11px] text-zinc-600 sm:block">{index}</span>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 sm:grid-cols-2">
          <MoneyInput value={amount} onChange={onAmount} />
          <PlanDateInput
            className="max-sm:!px-2"
            value={date}
            invalid={Boolean(warning)}
            showInlineMessage={false}
            ariaLabel={`Fecha ${index}`}
            onInvalidChange={(bad) => { setBadDate(bad); onInvalidChange?.(bad); }}
            onChange={onDate}
          />
        </div>
        <RemoveButton label={removeLabel} onClick={onRemove} />
      </div>
      {effectiveWarning && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300 sm:pl-6"><AlertTriangle size={11} className="shrink-0" /> {effectiveWarning}</p>}
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
