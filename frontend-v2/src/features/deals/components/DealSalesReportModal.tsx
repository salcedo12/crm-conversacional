import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  History,
  Loader2,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import type { DealSummary } from '../services/deals.service';
import {
  extractDealSalesReportInitialValues,
  formatCopCurrency,
  generateDealSalesReportDocx,
  downloadBlobAsFile,
  parseCopCurrency,
  type CommissionRowItem,
  type DealSalesReportFormValues,
} from '../utils/dealSalesReportDoc';
import {
  getSalesReportDocument,
  saveSalesReportDocument,
} from '@/features/reports/services/reports.service';

interface DealSalesReportModalProps {
  deal: DealSummary;
  companyId: string;
  currentUserName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function DealSalesReportModal({
  deal,
  companyId,
  currentUserName,
  onClose,
  onSaved,
}: DealSalesReportModalProps) {
  const initial = useMemo(() => extractDealSalesReportInitialValues(deal), [deal]);

  const [dateStr, setDateStr] = useState(initial.dateStr);
  const [clientName, setClientName] = useState(initial.clientName);
  const [documentNumber, setDocumentNumber] = useState(initial.documentNumber);
  const [lotValue, setLotValue] = useState(initial.lotValue);
  const [deposit, setDeposit] = useState(initial.deposit);
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms);
  const [lotNumber, setLotNumber] = useState(initial.lotNumber);
  const [sectorStage, setSectorStage] = useState(initial.sectorStage);
  const [projectName, setProjectName] = useState(initial.projectName);
  const [area, setArea] = useState(initial.area);
  const [discount, setDiscount] = useState(initial.discount);
  const [referralApplies, setReferralApplies] = useState<'SI' | 'NO'>(initial.referralApplies);
  const [referralName, setReferralName] = useState(initial.referralName);
  const [saleType, setSaleType] = useState(initial.saleType);
  const [commissions, setCommissions] = useState<CommissionRowItem[]>(initial.commissions);

  const [history, setHistory] = useState<any[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [lastSavedDateStr, setLastSavedDateStr] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'download' | 'save' | 'both' | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Escuchar escape para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cargar si ya existía un reporte previamente guardado para este negocio
  useEffect(() => {
    let active = true;
    async function fetchSaved() {
      try {
        const res = await getSalesReportDocument(companyId, deal.id);
        if (active && res?.exists && res.data) {
          const d = res.data;
          if (d.clientName) setClientName(d.clientName);
          if (d.documentNumber) setDocumentNumber(d.documentNumber);
          if (d.paymentTerms) setPaymentTerms(String(d.paymentTerms));
          if (d.deposit !== undefined && d.deposit !== null) setDeposit(formatCopCurrency(d.deposit));
          if (d.source) setSaleType(d.source);
          if (d.referralApplies) {
            const applies = d.referralApplies === 'SI' ? 'SI' : 'NO';
            setReferralApplies(applies);
          }
          if (d.referralName !== undefined) setReferralName(d.referralName);
          if (d.lotNumber) setLotNumber(d.lotNumber);
          if (d.sectorStage) setSectorStage(d.sectorStage);
          if (d.projectName) setProjectName(d.projectName);
          if (d.area !== undefined && d.area !== null) setArea(String(d.area));
          if (d.discount !== undefined && d.discount !== null) setDiscount(formatCopCurrency(d.discount));
          if (d.landValue !== undefined && d.landValue !== null) setLotValue(formatCopCurrency(d.landValue));
          if (Array.isArray(d.commissions) && d.commissions.length > 0) {
            setCommissions(d.commissions);
          }
          if (Array.isArray(d.history)) {
            setHistory(d.history);
          }
          if (d.documentGeneratedDateStr) {
            setLastSavedDateStr(d.documentGeneratedDateStr);
          }
        }
      } catch (err) {
        console.warn('[DealSalesReportModal] No se cargó reporte previo:', err);
      } finally {
        if (active) setLoadingSaved(false);
      }
    }
    void fetchSaved();
    return () => {
      active = false;
    };
  }, [companyId, deal.id]);

  // Manejar cambio en porcentaje de una comisión para recalcular su valor
  const handleCommissionRateChange = (role: string, newRateStr: string) => {
    const rawLand = parseCopCurrency(lotValue);
    setCommissions((prev) =>
      prev.map((item) => {
        if (item.role !== role) return item;
        const cleanRate = newRateStr.replace('%', '').trim();
        const numRate = parseFloat(cleanRate.replace(',', '.'));
        const calcVal = !isNaN(numRate) && numRate >= 0 ? Math.round(rawLand * (numRate / 100)) : 0;
        return {
          ...item,
          ratePct: newRateStr,
          value: formatCopCurrency(calcVal),
        };
      })
    );
  };

  const handleCommissionNameChange = (role: string, newName: string) => {
    setCommissions((prev) =>
      prev.map((item) => (item.role === role ? { ...item, name: newName } : item))
    );
  };

  const handleCommissionValueChange = (role: string, newValueStr: string) => {
    setCommissions((prev) =>
      prev.map((item) => (item.role === role ? { ...item, value: newValueStr } : item))
    );
  };

  // Totales de comisión
  const totalCommissionVal = commissions.reduce(
    (sum, c) => sum + parseCopCurrency(c.value),
    0
  );
  const totalCommissionPct = commissions.reduce((sum, c) => {
    const num = parseFloat(c.ratePct.replace('%', '').replace(',', '.').trim());
    return sum + (isNaN(num) ? 0 : num);
  }, 0);

  const getFormValues = (): DealSalesReportFormValues => ({
    dateStr: dateStr.trim(),
    clientName: clientName.trim(),
    documentNumber: documentNumber.trim(),
    lotValue: lotValue.trim(),
    deposit: deposit.trim(),
    paymentTerms: paymentTerms.trim(),
    lotNumber: lotNumber.trim(),
    sectorStage: sectorStage.trim(),
    projectName: projectName.trim(),
    area: area.trim(),
    discount: discount.trim(),
    referralApplies,
    referralName: referralApplies === 'SI' ? referralName.trim() : 'NO APLICA',
    saleType: saleType.trim(),
    commissions,
  });

  // Descarga del archivo Word
  const handleDownloadWord = async () => {
    setBusyAction('download');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const values = getFormValues();
      const blob = await generateDealSalesReportDocx(values);
      const safeProj = (projectName || 'PROYECTO').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
      const safeLot = (lotNumber || 'LOTE').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
      const filename = `REPORTE_VENTA_${safeProj}_LOTE_${safeLot}.docx`;
      downloadBlobAsFile(blob, filename);
      setSuccessMsg('Reporte de venta descargado en formato Word correctamente.');
    } catch (err) {
      console.error('[DealSalesReportModal] Error descargando Word:', err);
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo generar el archivo Word.');
    } finally {
      setBusyAction(null);
    }
  };

  // Guardar en Firestore
  const handleSaveToFirestore = async (): Promise<boolean> => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const values = getFormValues();
      const cap = commissions.find((c) => c.role === 'CAPTACIÓN');
      const lin = commissions.find((c) => c.role === 'LINEA');
      const cie = commissions.find((c) => c.role === 'CIERRE');
      const dir = commissions.find((c) => c.role === 'DIRECTOR');

      const res = await saveSalesReportDocument({
        companyId,
        saleId: deal.id,
        module: `${sectorStage} ${lotNumber}`.trim(),
        clientName: values.clientName,
        documentNumber: values.documentNumber,
        deposit: parseCopCurrency(values.deposit),
        paymentTerms: values.paymentTerms,
        source: values.saleType,
        agentCr: cap?.name || '',
        agentLinea: lin?.name || '',
        agentCierre: cie?.name || '',
        director: dir?.name || 'Claudia Patricia Bolaños Vega',
        referralApplies: values.referralApplies,
        referralName: values.referralName,
        createdByName: currentUserName,
        landValue: parseCopCurrency(values.lotValue),
        lotNumber: values.lotNumber,
        sectorStage: values.sectorStage,
        projectName: values.projectName,
        area: values.area,
        discount: parseCopCurrency(values.discount),
        commissions: values.commissions,
      });

      if (res.documentGeneratedDateStr) {
        setLastSavedDateStr(res.documentGeneratedDateStr);
      }
      if (Array.isArray(res.history)) {
        setHistory(res.history);
      }
      setSuccessMsg(`Reporte guardado en el sistema con fecha ${res.documentGeneratedDateStr}.`);
      onSaved?.();
      return true;
    } catch (err) {
      console.error('[DealSalesReportModal] Error guardando:', err);
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar el reporte de venta.');
      return false;
    }
  };

  const handleSaveOnly = async () => {
    setBusyAction('save');
    await handleSaveToFirestore();
    setBusyAction(null);
  };

  const handleSaveAndDownload = async () => {
    setBusyAction('both');
    const ok = await handleSaveToFirestore();
    if (ok) {
      try {
        const values = getFormValues();
        const blob = await generateDealSalesReportDocx(values);
        const safeProj = (projectName || 'PROYECTO').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
        const safeLot = (lotNumber || 'LOTE').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
        const filename = `REPORTE_VENTA_${safeProj}_LOTE_${safeLot}.docx`;
        downloadBlobAsFile(blob, filename);
        setSuccessMsg('Reporte guardado en el sistema y descargado en Word.');
      } catch (err) {
        console.error('[DealSalesReportModal] Error al descargar tras guardar:', err);
      }
    }
    setBusyAction(null);
  };

  const handleDownloadVersionWord = async (ver: any) => {
    try {
      const initial = extractDealSalesReportInitialValues(deal);
      const values: DealSalesReportFormValues = {
        dateStr: ver.createdDateStr || initial.dateStr,
        clientName: ver.clientName || initial.clientName,
        documentNumber: ver.documentNumber || initial.documentNumber,
        lotValue: ver.landValue ? formatCopCurrency(ver.landValue) : initial.lotValue,
        deposit: ver.deposit ? formatCopCurrency(ver.deposit) : initial.deposit,
        paymentTerms: ver.paymentTerms ? String(ver.paymentTerms) : initial.paymentTerms,
        lotNumber: ver.lotNumber || initial.lotNumber,
        sectorStage: ver.sectorStage || initial.sectorStage,
        projectName: ver.projectName || initial.projectName,
        area: ver.area ? String(ver.area) : initial.area,
        discount: ver.discount !== undefined ? formatCopCurrency(ver.discount) : initial.discount,
        referralApplies: ver.referralApplies === 'SI' ? 'SI' : initial.referralApplies,
        referralName: ver.referralName || initial.referralName,
        saleType: ver.source || initial.saleType,
        commissions: Array.isArray(ver.commissions) && ver.commissions.length > 0 ? ver.commissions : initial.commissions,
      };
      const blob = await generateDealSalesReportDocx(values);
      const safeProj = (values.projectName || 'PROYECTO').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
      const safeLot = (values.lotNumber || 'LOTE').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_');
      const filename = `REPORTE_VENTA_${safeProj}_LOTE_${safeLot}_v${ver.id || 'hist'}.docx`;
      downloadBlobAsFile(blob, filename);
    } catch (err) {
      console.error('[DealSalesReportModal] Error descargando versión de reporte:', err);
      setErrorMsg('No se pudo generar el archivo Word de esta versión.');
    }
  };

  return createPortal(
    <div
      className="deal-touch fixed inset-0 z-[200] flex items-stretch justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4 overflow-x-hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-zinc-950 shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-2xl sm:border sm:border-zinc-800"
      >
        {/* Encabezado */}
        <header className="flex items-start justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Formato Oficial
                </span>
                <h2 className="text-base font-bold text-zinc-100 sm:text-lg">Reporte de Venta</h2>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
                {projectName} · {sectorStage ? `${sectorStage} · ` : ''}Lote {lotNumber || '—'}
                {lastSavedDateStr && (
                  <span className="ml-2 text-emerald-400 font-medium">
                    (Último registro: {lastSavedDateStr})
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </header>

        {/* Mensajes de éxito / error */}
        {successMsg && (
          <div className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300 sm:px-6">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300 sm:px-6">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Cuerpo del formulario */}
        <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-6 text-xs text-zinc-200">
          {loadingSaved && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900/60 p-2 text-xs text-zinc-400">
              <Loader2 size={13} className="animate-spin text-emerald-400" />
              <span>Verificando si existen datos previos guardados...</span>
            </div>
          )}

          {/* Banner de datos automáticos */}
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles size={14} className="text-emerald-400" />
              Los datos del cliente, lote y condiciones fueron cargados automáticamente del negocio.
            </span>
            <span className="text-zinc-500 hidden sm:inline">Puedes editarlos si es necesario</span>
          </div>

          {/* FORMATO TABULAR TIPO REPORTE DE VENTA */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
            {/* Fila Encabezado Fecha */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  REPORTE DE VENTA
                </span>
                <p className="text-xs text-zinc-500">Planilla de legalización y comisiones</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-zinc-400">Fecha de elaboración:</label>
                <input
                  type="text"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  className="h-8 w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-center font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  placeholder="DD/MM/AAAA"
                />
              </div>
            </div>

            {/* SECCIÓN 1: DATOS CLIENTE Y LOTE */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Nombre Cliente:
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nombres y apellidos del comprador"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  No. Documento:
                </label>
                <input
                  type="text"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  placeholder="C.C. / C.E. / NIT"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Valor Lote:
                </label>
                <input
                  type="text"
                  value={lotValue}
                  onChange={(e) => setLotValue(e.target.value)}
                  placeholder="$ 0"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Valor Separación:
                </label>
                <input
                  type="text"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="$ 0"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Plazo de Pago:
                </label>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="p. ej. 40 meses"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  No. Lote:
                </label>
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="p. ej. 16"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Sector / Etapa:
                </label>
                <input
                  type="text"
                  value={sectorStage}
                  onChange={(e) => setSectorStage(e.target.value)}
                  placeholder="p. ej. SAN ANTONIO"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Proyecto:
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Nombre del proyecto"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Área:
                </label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="p. ej. 1.000 m²"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Descuento o Bono:
                </label>
                <input
                  type="text"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="$ 0"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-amber-300 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Referido:
                </label>
                <select
                  value={referralApplies}
                  onChange={(e) => {
                    const next = e.target.value as 'SI' | 'NO';
                    setReferralApplies(next);
                    if (next === 'NO') setReferralName('NO APLICA');
                    else if (referralName === 'NO APLICA') setReferralName('');
                  }}
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="NO">NO APLICA</option>
                  <option value="SI">SI APLICA</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                  Nombre Referido:
                </label>
                <input
                  type="text"
                  disabled={referralApplies === 'NO'}
                  value={referralName}
                  onChange={(e) => setReferralName(e.target.value)}
                  placeholder={referralApplies === 'SI' ? 'Nombre de quien refirió' : 'NO APLICA'}
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 disabled:opacity-50 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* SECCIÓN 2: COMISIÓN Y TIPO DE VENTA (EDITABLE Y RESPONSIVE) */}
            <div className="mt-4 rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold uppercase tracking-wider text-amber-400 text-xs">
                    Comisión
                  </span>
                  <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    Editable por asesoría
                  </span>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                  <label className="text-[11px] font-semibold text-zinc-300 shrink-0">Tipo de Venta:</label>
                  <input
                    type="text"
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value)}
                    placeholder="DIRECTA, CORFERIAS, etc."
                    className="h-8 flex-1 sm:w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-semibold text-zinc-100 focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* VISTA MÓVIL: Tarjetas individuales y cómodas para tocar en celular */}
              <div className="mt-3 space-y-3 sm:hidden">
                {commissions.map((comm) => {
                  const roleBadges: Record<string, string> = {
                    'CAPTACIÓN': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
                    'LINEA': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
                    'CIERRE': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                    'DIRECTOR': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                  };
                  return (
                    <div
                      key={comm.role}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-2.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ${
                            roleBadges[comm.role] || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                          }`}
                        >
                          {comm.role}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-zinc-400 font-bold uppercase">Porcentaje:</span>
                          <input
                            type="text"
                            value={comm.ratePct}
                            onChange={(e) => handleCommissionRateChange(comm.role, e.target.value)}
                            placeholder="0.0 %"
                            className="h-8 w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-center font-mono text-xs font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                          Nombre Asesor / Beneficiario:
                        </label>
                        <input
                          type="text"
                          value={comm.name}
                          onChange={(e) => handleCommissionNameChange(comm.role, e.target.value)}
                          placeholder={`Nombre para ${comm.role.toLowerCase()}`}
                          className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-100 focus:border-amber-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                          Valor Comisión:
                        </label>
                        <input
                          type="text"
                          value={comm.value}
                          onChange={(e) => handleCommissionValueChange(comm.role, e.target.value)}
                          placeholder="$ 0"
                          className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs font-bold text-emerald-300 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Resumen de totales en móvil */}
                <div className="rounded-xl border border-zinc-700 bg-zinc-900/90 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wide text-zinc-400 text-[10px]">
                      Total Porcentaje:
                    </span>
                    <span className="font-mono font-bold text-amber-300">
                      {totalCommissionPct.toFixed(2)} %
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-2">
                    <span className="font-bold uppercase tracking-wide text-zinc-400 text-[10px]">
                      Total Comisiones:
                    </span>
                    <span className="font-mono text-sm font-extrabold text-emerald-400">
                      {formatCopCurrency(totalCommissionVal)}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 italic text-right">
                    Calculadas dinámicamente sobre el valor del lote
                  </p>
                </div>
              </div>

              {/* VISTA ESCRITORIO: Tabla tradicional espaciosa */}
              <div className="mt-3 hidden sm:block overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-900 text-[10px] uppercase text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 w-32">Estado / Rol</th>
                      <th className="px-3 py-2 w-28 text-center">Porcentaje</th>
                      <th className="px-3 py-2">Nombre Asesor / Director</th>
                      <th className="px-3 py-2 w-36 text-right">Valor Comisión</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80 bg-zinc-950/40">
                    {commissions.map((comm) => (
                      <tr key={comm.role} className="hover:bg-zinc-900/40">
                        <td className="px-3 py-2 font-bold text-zinc-200">{comm.role}</td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="text"
                            value={comm.ratePct}
                            onChange={(e) => handleCommissionRateChange(comm.role, e.target.value)}
                            placeholder="0.0 %"
                            className="h-8 w-20 rounded border border-zinc-700 bg-zinc-900 px-2 text-center font-mono text-xs text-amber-300 focus:border-amber-400 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={comm.name}
                            onChange={(e) => handleCommissionNameChange(comm.role, e.target.value)}
                            placeholder="Nombre del beneficiario"
                            className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 focus:border-amber-400 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="text"
                            value={comm.value}
                            onChange={(e) => handleCommissionValueChange(comm.role, e.target.value)}
                            placeholder="$ 0"
                            className="h-8 w-32 rounded border border-zinc-700 bg-zinc-900 px-2 text-right font-mono text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-zinc-700 bg-zinc-900/60 font-bold text-xs">
                    <tr>
                      <td className="px-3 py-2.5 text-zinc-400 uppercase text-[10px]">Total Comisiones:</td>
                      <td className="px-3 py-2.5 text-center font-mono text-amber-300">
                        {totalCommissionPct.toFixed(2)} %
                      </td>
                      <td className="px-3 py-2.5 text-zinc-500 text-[10px] italic">
                        Calculadas sobre valor del lote
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-400">
                        {formatCopCurrency(totalCommissionVal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* SECCIÓN 3: ESPACIO PARA REVISIÓN (SE DEJA EN BLANCO) */}
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-3.5 space-y-2 opacity-80">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  ESPACIO PARA REVISIÓN (Se deja en blanco para otra área)
                </p>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400">
                  No editable aquí · Uso interno de verificación
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] text-zinc-400 sm:grid-cols-3">
                <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
                  <span className="text-zinc-500 text-[10px] block">FV:</span>
                  <span className="font-mono text-zinc-600">[ Espacio en blanco ]</span>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
                  <span className="text-zinc-500 text-[10px] block">PROMESA FIRMADA:</span>
                  <span className="font-mono text-zinc-600">[ ] SI &nbsp; [ ] NO</span>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 col-span-2 sm:col-span-1">
                  <span className="text-zinc-500 text-[10px] block">PAGOS DE SEPARACIÓN:</span>
                  <span className="font-mono text-zinc-600">[ Espacio en blanco ]</span>
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-[11px]">
                <span className="text-zinc-500 text-[10px] block">OBSERVACIONES:</span>
                <span className="font-mono text-zinc-600 italic">[ Espacio en blanco para revisión ]</span>
              </div>
            </div>

            {/* SECCIÓN 4: HISTORIAL DE REPORTES GUARDADOS */}
            {history.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <History size={15} className="text-emerald-400" />
                    <p className="text-xs font-bold text-zinc-100">
                      Historial de reportes guardados en el sistema ({history.length})
                    </p>
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    Último guardado: {history[0]?.createdDateStr || 'Reciente'}
                  </span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {history.map((ver, idx) => {
                    const versionNum = history.length - idx;
                    const commTotal = Array.isArray(ver.commissions)
                      ? ver.commissions.reduce((s: number, c: any) => s + parseCopCurrency(c.value), 0)
                      : 0;
                    return (
                      <div
                        key={ver.id || idx}
                        className="flex flex-col gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3 sm:flex-row sm:items-center sm:justify-between transition hover:border-zinc-700"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                              v{versionNum}
                            </span>
                            <p className="text-xs font-semibold text-zinc-200">
                              {ver.createdDateStr || (ver.createdAt ? new Date(ver.createdAt).toLocaleString('es-CO') : 'Versión guardada')}
                            </p>
                          </div>
                          <p className="mt-1 text-[10px] text-zinc-400">
                            Registrado por: <strong className="text-zinc-300">{ver.createdByName || 'Asesor'}</strong>
                            {ver.landValue && ` · Valor lote: ${formatCopCurrency(ver.landValue)}`}
                            {commTotal > 0 && ` · Comisión: ${formatCopCurrency(commTotal)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleDownloadVersionWord(ver)}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm"
                          >
                            <Download size={12} /> Word (.docx)
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pie de acciones */}
        <footer className="flex flex-col gap-2 border-t border-zinc-800 bg-zinc-900/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[11px] text-zinc-500">
            Genera 2 talones oficiales por página para impresión y archivo.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!!busyAction}
              onClick={() => void handleSaveOnly()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              {busyAction === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Guardar en sistema
            </button>
            <button
              type="button"
              disabled={!!busyAction}
              onClick={() => void handleDownloadWord()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {busyAction === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Descargar Word (.docx)
            </button>
            <button
              type="button"
              disabled={!!busyAction}
              onClick={() => void handleSaveAndDownload()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md shadow-emerald-950"
            >
              {busyAction === 'both' ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
              Guardar y Descargar Word
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
