import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calculator,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FileText,
  History,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole, isViewerRole } from '@/features/auth/types';
import { listAdvisors, type Advisor } from '@/features/leads/services/advisors.service';
import {
  cancelDeal,
  canEditDealBuyers,
  createDeal,
  DEAL_STATUS_LABELS,
  deleteDealAttachment,
  deleteDealDocument,
  downloadDealAttachment,
  downloadDealDocument,
  fetchDealAttachmentBlob,
  fetchDealDocumentPdf,
  generateDealDocument,
  getDeal,
  listDealActivity,
  reassignDealAdvisor,
  saveDealDocument,
  uploadDealAttachment,
  type DealActivityEntry,
  type DealAttachment,
  type DealAttachmentCategory,
  type DealDocumentKind,
  type DealSummary,
} from '../services/deals.service';
import { isCurrentDocument, latestCurrentDocument, lotLabel } from '../utils/documentLot';
import { referralName } from '../utils/paymentPlan';
import { DealSignatureStatus } from '../components/DealSignatureStatus';
import { DealDocumentPreview } from '../components/DealDocumentPreview';
import { DealPlanModal } from '../components/DealPlanModal';
import { DealBuyersModal } from '../components/DealBuyersModal';
import { DealLotSection } from '../components/DealLotSection';
import { DealSalesReportModal } from '../components/DealSalesReportModal';
import { DealSteps } from '../components/LeadDealsPanel';
import {
  CATEGORY_LABELS,
  Checklist,
  dateTime,
  missingSupportsSummary,
  money,
  projectName,
  STATUS_STYLE,
  supportStats,
} from './DealsPage';

export function DealDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const { companyId, role, platformAdmin, user } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const readOnly = !platformAdmin && isViewerRole(role);

  const [deal, setDeal] = useState<DealSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<'negocio' | 'contratos' | 'soportes' | 'bitacora'>('negocio');
  const [planning, setPlanning] = useState(false);
  const [editingBuyers, setEditingBuyers] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState<DealDocumentKind | null>(null);

  const [canceling, setCanceling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busyCancel, setBusyCancel] = useState(false);

  const [preview, setPreview] = useState<{
    title: string;
    kind?: DealDocumentKind;
    version?: number;
    pdf: { fileName: string; blob: Blob };
  } | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    title: string;
    fileName: string;
    blob: Blob;
    url: string;
  } | null>(null);
  const [activities, setActivities] = useState<DealActivityEntry[] | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [reassigningAdvisor, setReassigningAdvisor] = useState(false);
  const [advisorsList, setAdvisorsList] = useState<Advisor[]>([]);
  const [nextAdvisorId, setNextAdvisorId] = useState('');
  const [busyReassign, setBusyReassign] = useState(false);
  const [creatingAnotherDeal, setCreatingAnotherDeal] = useState(false);

  const [category, setCategory] = useState<DealAttachmentCategory>('buyer_identification');
  const [buyerClientId, setBuyerClientId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingDocument, setDownloadingDocument] = useState<string | null>(null);

  const loadDealData = async () => {
    if (!companyId || !dealId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getDeal(companyId, dealId);
      setDeal(data);
      if (data.buyers[0]?.clientId) {
        setBuyerClientId(data.buyers[0].clientId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el negocio.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDealData();
  }, [companyId, dealId]);

  useEffect(() => {
    if (!deal?.buyers?.length) {
      setBuyerClientId('');
      return;
    }
    if (!buyerClientId || !deal.buyers.some((b) => b.clientId === buyerClientId)) {
      setBuyerClientId(deal.buyers[0].clientId);
    }
  }, [deal?.buyers, buyerClientId]);

  useEffect(() => {
    if (!imagePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        URL.revokeObjectURL(imagePreview.url);
        setImagePreview(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePreview]);

  const loadActivities = async () => {
    if (!companyId || !dealId) return;
    setLoadingActivities(true);
    try {
      setActivities(await listDealActivity(companyId, dealId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la bitácora del negocio.');
    } finally {
      setLoadingActivities(false);
    }
  };

  useEffect(() => {
    if (tab === 'bitacora' && companyId && dealId) {
      void loadActivities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, companyId, dealId]);

  const handleRefresh = async () => {
    if (!companyId || !dealId) return;
    setError(null);
    try {
      const updated = await getDeal(companyId, dealId);
      setDeal(updated);
      if (tab === 'bitacora') void loadActivities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el negocio.');
    }
  };

  const openReassignAdvisor = async () => {
    if (!companyId || !deal) return;
    setReassigningAdvisor(true);
    setNextAdvisorId(deal.advisorId);
    if (advisorsList.length === 0) {
      try {
        const list = await listAdvisors(companyId);
        setAdvisorsList(list.filter((a) => a.active && a.role !== 'viewer'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar la lista de asesores.');
      }
    }
  };

  const confirmReassignAdvisor = async () => {
    if (!companyId || !deal || !nextAdvisorId) return;
    setBusyReassign(true);
    setError(null);
    try {
      await reassignDealAdvisor(companyId, deal.id, nextAdvisorId);
      setReassigningAdvisor(false);
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reasignar el asesor.');
    } finally {
      setBusyReassign(false);
    }
  };

  const handleCreateAnotherDeal = async () => {
    if (!companyId || !deal) return;
    const who = deal.buyerNames?.join(', ') || deal.leadName || 'este cliente';
    if (!window.confirm(`¿Crear un nuevo negocio para comprar otro lote con los mismos compradores (${who})?`)) return;
    setCreatingAnotherDeal(true);
    setError(null);
    try {
      const newDealId = await createDeal(companyId, deal.leadId, isAdmin ? deal.advisorId : undefined);
      navigate(`/dashboard/deals/${newDealId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el nuevo negocio.');
    } finally {
      setCreatingAnotherDeal(false);
    }
  };

  const handleViewAttachment = async (attachment: DealAttachment) => {
    if (!companyId || !deal) return;
    const key = `att-${attachment.id}`;
    setDownloadingDocument(key);
    setError(null);
    try {
      const data = await fetchDealAttachmentBlob(companyId, deal.id, attachment.id);
      if (data.contentType === 'application/pdf' || attachment.fileName.toLowerCase().endsWith('.pdf')) {
        setPreview({ title: `${CATEGORY_LABELS[attachment.category]} · ${data.fileName}`, pdf: { fileName: data.fileName, blob: data.blob } });
      } else {
        const url = URL.createObjectURL(data.blob);
        setImagePreview({ title: CATEGORY_LABELS[attachment.category], fileName: data.fileName, blob: data.blob, url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la vista previa del soporte.');
    } finally {
      setDownloadingDocument(null);
    }
  };

  const handleGenerateDoc = async (kind: DealDocumentKind) => {
    if (!companyId || !deal) return;
    setGeneratingDoc(kind);
    setError(null);
    try {
      const res = await generateDealDocument(companyId, deal.id, kind);
      await handleRefresh();
      const pdf = await fetchDealDocumentPdf(companyId, deal.id, kind, res.version);
      setPreview({
        title: `${kind === 'preventa' ? 'Contrato de preventa' : 'Promesa de compraventa'} · v${res.version}`,
        kind,
        version: res.version,
        pdf,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el documento.');
    } finally {
      setGeneratingDoc(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!companyId || !deal || cancelReason.trim().length < 3) return;
    setBusyCancel(true);
    setError(null);
    try {
      await cancelDeal(companyId, deal.id, cancelReason.trim());
      await handleRefresh();
      setCanceling(false);
      setCancelReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anular el negocio.');
    } finally {
      setBusyCancel(false);
    }
  };

  const handleUpload = async () => {
    if (!companyId || !deal || !file) return;
    setBusy(true);
    setError(null);
    try {
      const attachment = await uploadDealAttachment({
        companyId,
        dealId: deal.id,
        category,
        file,
        ...(category === 'buyer_identification' ? { buyerClientId } : {}),
        ...(category === 'separation_payment'
          ? { paymentAmount: Number(paymentAmount.replace(/\D/g, '')), paymentDate }
          : {}),
        note,
      });
      setDeal((prev) => (prev ? { ...prev, attachments: [...(prev.attachments ?? []), attachment], updatedAt: Date.now() } : prev));
      setFile(null);
      setNote('');
      setPaymentAmount('');
      setPaymentDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el soporte.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (attachment: DealAttachment) => {
    if (!companyId || !deal || !window.confirm(`¿Eliminar “${attachment.fileName}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDealAttachment(companyId, deal.id, attachment.id);
      setDeal((prev) =>
        prev
          ? { ...prev, attachments: (prev.attachments ?? []).filter((item) => item.id !== attachment.id), updatedAt: Date.now() }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el soporte.');
    } finally {
      setBusy(false);
    }
  };

  const handleView = async (kind: DealDocumentKind, version: number, signed = false) => {
    if (!companyId || !deal) return;
    const key = `${signed ? 'signed' : 'view'}-${kind}-${version}`;
    setDownloadingDocument(key);
    setError(null);
    try {
      const pdf = await fetchDealDocumentPdf(companyId, deal.id, kind, version, signed);
      setPreview({
        title: `${kind === 'preventa' ? 'Contrato de preventa' : 'Promesa de compraventa'} · v${version}${signed ? ' · FIRMADO' : ''}`,
        kind,
        version,
        pdf,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el documento.');
    } finally {
      setDownloadingDocument(null);
    }
  };

  const handleDocumentDownload = async (kind: DealDocumentKind, version: number) => {
    if (!companyId || !deal) return;
    const key = `${kind}-${version}`;
    setDownloadingDocument(key);
    setError(null);
    try {
      await downloadDealDocument(companyId, deal.id, kind, version);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el documento.');
    } finally {
      setDownloadingDocument(null);
    }
  };

  const handleDeleteDocument = async (kind: DealDocumentKind, version: number) => {
    if (!companyId || !deal) return;
    const label = `${kind === 'preventa' ? 'el Contrato de preventa' : 'la Promesa de compraventa'} v${version}`;
    if (!window.confirm(`¿Seguro que deseas eliminar ${label}? Esta acción no se puede deshacer.`)) return;
    const key = `del-${kind}-${version}`;
    setDownloadingDocument(key);
    setError(null);
    try {
      await deleteDealDocument(companyId, deal.id, kind, version);
      await handleRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el documento.');
    } finally {
      setDownloadingDocument(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error && !deal) {
    return (
      <div className="h-full w-full overflow-y-auto bg-zinc-950 px-4 py-16 text-center">
        <p className="text-sm font-semibold text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard/deals')}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-700"
        >
          <ArrowLeft size={14} /> Volver a Negocios
        </button>
      </div>
    );
  }

  if (!deal) return null;

  const attachments = deal.attachments ?? [];
  const stats = supportStats(deal);
  const missingSupports = missingSupportsSummary(deal);
  const editable = !readOnly && (deal.status === 'borrador' || deal.status === 'plan_listo');
  const canEditBuyers = !readOnly && canEditDealBuyers(deal.status, isAdmin);
  const canCancelDeal = !readOnly && deal.status !== 'anulado' && (editable || isAdmin);
  const hasPendingSignatures = [...(deal.documents ?? []), ...(deal.extraSignatures ?? [])].some(
    (d) => d.docublockDocumentId && (d.signatureStatus === 'en_firma' || d.signatureStatus === 'firmado_parcial'),
  );
  const draftPlan = (deal as any).draftPlan || (deal.planApproval as any)?.planDraft;
  const activePlan = deal.plan || draftPlan;
  const isApprovalPending = deal.planApproval?.status === 'pending';
  const planStale = !!activePlan && activePlan.lotId !== deal.lot?.inventoryLotId;
  const hasPreventa = Boolean(latestCurrentDocument(deal, 'preventa'));
  const canGeneratePreventa =
    !readOnly && deal.status !== 'anulado' && (deal.status === 'plan_listo' || (hasPreventa && Boolean(deal.lot) && Boolean(deal.plan)));

  return (
    <div className="deal-touch h-full w-full overflow-y-auto bg-zinc-950 px-3.5 py-4 pb-32 sm:px-6 sm:py-6 sm:pb-20 lg:px-8 overscroll-contain">
      {preview && (
        <DealDocumentPreview
          title={preview.title}
          pdf={preview.pdf}
          allowPdfDownload={isAdmin || !preview.kind}
          onDownloadWord={
            isAdmin && companyId && preview.kind && preview.version
              ? () => downloadDealDocument(companyId, deal.id, preview.kind!, preview.version!)
              : undefined
          }
          onClose={() => setPreview(null)}
        />
      )}
      {imagePreview && createPortal(
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-zinc-950/95"
          onClick={() => { URL.revokeObjectURL(imagePreview.url); setImagePreview(null); }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 pb-2.5 pt-[max(0.625rem,var(--safe-top))]" onClick={(e) => e.stopPropagation()}>
            <p className="truncate text-sm font-semibold text-zinc-100">{imagePreview.title} · {imagePreview.fileName}</p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => saveDealDocument(imagePreview.fileName, imagePreview.blob)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <Download size={13} /> Descargar
              </button>
              <button
                type="button"
                onClick={() => { URL.revokeObjectURL(imagePreview.url); setImagePreview(null); }}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <img src={imagePreview.url} alt={imagePreview.fileName} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          </div>
        </div>,
        document.body,
      )}
      {planning && companyId && (
        <DealPlanModal
          companyId={companyId}
          deal={deal}
          onClose={() => setPlanning(false)}
          onSaved={() => {
            setPlanning(false);
            void handleRefresh();
          }}
        />
      )}
      {editingBuyers && companyId && (
        <DealBuyersModal
          companyId={companyId}
          deal={deal}
          lead={{ id: deal.leadId, name: deal.leadName ?? '' } as any}
          onClose={() => setEditingBuyers(false)}
          onSaved={() => {
            setEditingBuyers(false);
            void handleRefresh();
          }}
        />
      )}
      {showSalesReport && companyId && (
        <DealSalesReportModal
          deal={deal}
          companyId={companyId}
          currentUserName={user?.displayName || user?.email || deal.advisorName || 'Asesor'}
          onClose={() => setShowSalesReport(false)}
          onSaved={() => void handleRefresh()}
        />
      )}

      <div className="mx-auto max-w-7xl space-y-5">
        {/* ENCABEZADO DE PÁGINA COMPLETA */}
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5 shadow-xl shadow-black/40 backdrop-blur-md">
          {/* Fila superior: navegación y acciones */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate('/dashboard/deals')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-800/90 px-3 py-2 text-xs font-bold text-zinc-200 hover:border-zinc-600 hover:bg-zinc-700 hover:text-white transition shadow-sm"
              >
                <ArrowLeft size={14} /> Volver<span className="hidden sm:inline"> a Negocios</span>
              </button>
              <div className="h-4 w-px bg-zinc-800 hidden sm:block" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    <MapPin size={10} /> {projectName(deal.lot?.projectId)}
                  </span>
                  {deal.lot?.corner && (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      Esquinero
                    </span>
                  )}
                  {deal.lot?.areaM2 && (
                    <span className="text-[11px] font-semibold text-zinc-400">
                      {deal.lot.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²
                    </span>
                  )}
                </div>
                <h1 className="mt-1 text-xl sm:text-2xl font-black text-zinc-100 truncate">
                  {deal.lot ? `${deal.lot.sector} · Lote ${deal.lot.lotNumber}${deal.lot.lotCode ? ` · Cód. ${deal.lot.lotCode}` : ''}` : 'Sin lote asignado'}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className={`rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${STATUS_STYLE[deal.status]}`}>
                {DEAL_STATUS_LABELS[deal.status]}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  disabled={creatingAnotherDeal}
                  onClick={() => void handleCreateAnotherDeal()}
                  title="Crear otro negocio con estos mismos compradores para otro lote"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300 transition disabled:opacity-50"
                >
                  {creatingAnotherDeal ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  <span className="hidden sm:inline">Otro lote</span>
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setShowSalesReport(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 transition shadow-sm"
                >
                  <FileText size={14} /> <span className="hidden sm:inline">Reporte de venta</span><span className="sm:hidden">Reporte</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleRefresh()}
                title="Actualizar datos"
                className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {/* Fila media: datos del cliente, asesor y valor */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-zinc-300">
              <div className="flex items-center gap-1.5 font-bold text-zinc-100">
                <Users size={14} className="text-emerald-400" />
                <span>{deal.buyerNames?.join(', ') || deal.leadName || 'Sin compradores registrados'}</span>
              </div>
              <span className="text-zinc-600 hidden sm:inline">•</span>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <UserRound size={12} className="text-zinc-500" />
                <span>Asesor:</span>
                <strong className="text-zinc-200">{deal.advisorName || 'Sin asesor'}</strong>
                {isAdmin && !readOnly && deal.status !== 'anulado' && !reassigningAdvisor && (
                  <button
                    type="button"
                    onClick={() => void openReassignAdvisor()}
                    className="ml-1 rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/10"
                  >
                    Cambiar
                  </button>
                )}
              </div>
              {reassigningAdvisor && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={nextAdvisorId}
                    onChange={(e) => setNextAdvisorId(e.target.value)}
                    disabled={busyReassign}
                    className="h-7 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-[11px] text-zinc-200"
                  >
                    {advisorsList.map((a) => (
                      <option key={a.id} value={a.id}>{a.displayName || a.email}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busyReassign || !nextAdvisorId}
                    onClick={() => void confirmReassignAdvisor()}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {busyReassign ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    disabled={busyReassign}
                    onClick={() => setReassigningAdvisor(false)}
                    className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              <span className="text-zinc-600 hidden sm:inline">•</span>
              <span className="text-[11px] text-zinc-500">
                Actualizado: {dateTime(deal.updatedAt)}
              </span>
            </div>

            {activePlan && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-2.5 py-1 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  {deal.plan ? 'Total pactado:' : 'Total propuesto:'}
                </span>
                <strong className="font-extrabold text-white">{money(activePlan.landValue)}</strong>
                {isApprovalPending && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                    Pendiente
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Pestañas de navegación con contadores */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1 text-xs sm:text-sm">
            <button
              type="button"
              onClick={() => setTab('negocio')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs sm:text-sm font-bold transition ${
                tab === 'negocio'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users size={15} /> Negocio
            </button>
            <button
              type="button"
              onClick={() => setTab('contratos')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs sm:text-sm font-bold transition ${
                tab === 'contratos'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText size={15} />
              <span>Contratos</span>
              {deal.documents && deal.documents.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${tab === 'contratos' ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                  {deal.documents.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('soportes')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs sm:text-sm font-bold transition ${
                tab === 'soportes'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Paperclip size={15} />
              <span>Soportes</span>
              {attachments.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${tab === 'soportes' ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                  {attachments.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('bitacora')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs sm:text-sm font-bold transition ${
                tab === 'bitacora'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <History size={15} />
              <span>Bitácora</span>
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>}
        {deal.status === 'anulado' && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200 flex items-start gap-2.5">
            <Ban size={16} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              <p className="font-bold text-red-200">Negocio anulado</p>
              {deal.cancelReason && <p className="mt-0.5 text-red-300/90">Motivo: {deal.cancelReason}</p>}
            </div>
          </div>
        )}

        {/* TAB 1: NEGOCIO (Gestión, Resumen y Control Documental) */}
        {tab === 'negocio' && (
          <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start space-y-5 lg:space-y-0">
            {/* COLUMNA IZQUIERDA: GESTIÓN OPERATIVA */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-5">
              {/* Paso a paso del negocio */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400"></span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Flujo del negocio</h3>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${STATUS_STYLE[deal.status]}`}>
                    {DEAL_STATUS_LABELS[deal.status]}
                  </span>
                </div>
                <div className="pt-1">
                  <DealSteps deal={deal} />
                </div>
              </section>

              {/* Compradores */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
                      <Users size={15} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                        Compradores ({deal.buyers.length}/4)
                      </h3>
                      <p className="text-[11px] text-zinc-400">Titular y co-propietarios para la escrituración</p>
                    </div>
                  </div>
                  {canEditBuyers && (
                    <button
                      type="button"
                      onClick={() => setEditingBuyers(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm"
                    >
                      <Users size={13} /> {deal.buyers.length ? 'Editar / agregar' : 'Registrar compradores'}
                    </button>
                  )}
                </div>

                {deal.buyerProfiles && deal.buyerProfiles.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {deal.buyerProfiles.map((b, i) => (
                      <div key={b.id || i} className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-3 flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-bold text-emerald-300">
                          {b.firstNames?.[0] || 'C'}{b.lastNames?.[0] || b.firstNames?.[1] || (i + 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-zinc-100 truncate">{b.firstNames} {b.lastNames}</span>
                            <span className="rounded bg-zinc-800 px-1.5 py-0.2 text-[9px] font-bold text-zinc-400 shrink-0">
                              {i === 0 ? 'Titular' : 'Co-propietario'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-zinc-400 truncate">
                            {b.identificationKind} {b.identificationNumber}
                            {b.mobile ? ` · ${b.mobile}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : deal.buyerNames?.length ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <p className="text-sm font-bold text-zinc-100">{deal.buyerNames.join(', ')}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center">
                    <p className="text-xs text-amber-300">No hay compradores registrados todavía.</p>
                  </div>
                )}
              </section>

              {/* Lote */}
              {companyId && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg backdrop-blur-sm">
                  <DealLotSection
                    companyId={companyId}
                    deal={deal}
                    onChanged={() => void handleRefresh()}
                  />
                </div>
              )}

              {/* Plan financiero */}
              {deal.lot && (
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
                        <Calculator size={15} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                            {deal.plan ? 'Plan financiero pactado' : 'Plan financiero propuesto'}
                          </h3>
                          {isApprovalPending && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                              Esperando autorización
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400">Condiciones de pago, plazos y abonos</p>
                      </div>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => setPlanning(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm"
                      >
                        <Calculator size={13} /> {deal.plan ? 'Editar plan' : isApprovalPending ? 'Ver / Comprobar' : 'Armar plan'}
                      </button>
                    )}
                  </div>

                  {activePlan && !planStale ? (
                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-4 space-y-3">
                      {isApprovalPending && (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">⏳</span>
                            <span>Propuesta enviada por WhatsApp a Gerencia ({deal.planApproval?.approverPhone || '3148209662'}).</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPlanning(true)}
                            className="font-bold underline text-amber-300 hover:text-white shrink-0"
                          >
                            Comprobar estado
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            {deal.plan ? 'Valor terreno pactado' : 'Valor terreno propuesto'}
                          </span>
                          <p className="text-lg sm:text-xl font-extrabold text-white">{money(activePlan.landValue)}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Plazo</span>
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-sm font-bold text-zinc-200">
                              {activePlan.termMonths ? `${activePlan.termMonths} meses` : 'De contado'}
                            </span>
                            {activePlan.specialTerm ? (
                              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                Autorizado
                              </span>
                            ) : isApprovalPending ? (
                              <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                Especial (Por autorizar)
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const sep = activePlan.simple?.separationTotal ?? activePlan.rows?.filter((r: any) => r.kind === 'separacion').reduce((acc: number, r: any) => acc + (r.amount * r.count), 0) ?? 0;
                        const ord = activePlan.rows?.filter((r: any) => r.kind === 'ordinaria').reduce((acc: number, r: any) => acc + (r.amount * r.count), 0) ?? 0;
                        const sev = activePlan.severance?.amount ?? 0;
                        return (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="rounded-lg bg-zinc-900/60 p-2.5">
                              <span className="text-[10px] text-zinc-500 block">Separación</span>
                              <strong className="text-zinc-200 font-semibold">{money(sep)}</strong>
                            </div>
                            <div className="rounded-lg bg-zinc-900/60 p-2.5">
                              <span className="text-[10px] text-zinc-500 block">Cuotas ordinarias</span>
                              <strong className="text-zinc-200 font-semibold">{money(ord)}</strong>
                            </div>
                            <div className="rounded-lg bg-zinc-900/60 p-2.5">
                              <span className="text-[10px] text-zinc-500 block">Bono / Descuento</span>
                              <strong className="text-zinc-200 font-semibold">{activePlan.benefit ? money(activePlan.benefit) : 'No aplica'}</strong>
                            </div>
                            <div className="rounded-lg bg-zinc-900/60 p-2.5">
                              <span className="text-[10px] text-zinc-500 block">Cesantías</span>
                              <strong className="text-zinc-200 font-semibold">{sev ? money(sev) : 'No aplica'}</strong>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : planStale ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                      <div className="text-xs">
                        <p className="font-bold text-amber-200">El plan financiero era para otro lote</p>
                        <p className="text-amber-300/80">Por favor revisa y actualiza el plan para que coincida con el lote actual.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-5 text-center">
                      <Calculator size={22} className="mx-auto mb-1.5 text-zinc-600" />
                      <p className="text-xs text-zinc-400">Aún no se ha configurado el plan de pagos.</p>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setPlanning(true)}
                          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
                        >
                          <Calculator size={12} /> Armar plan de pagos
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Anular negocio */}
              {canCancelDeal && (
                <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3.5 text-center">
                  {canceling ? (
                    <div className="space-y-2 text-left max-w-md mx-auto">
                      <p className="text-xs font-bold text-red-300">Confirmar anulación del negocio</p>
                      {hasPendingSignatures && (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                          Este negocio tiene documentos en firma en DocuBlock. Al anular se liberará el lote y se detendrá el seguimiento en el CRM; recuerda anularlos también en el panel de DocuBlock.
                        </p>
                      )}
                      {deal.status === 'promesa_firmada' && (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                          Este negocio ya tiene promesa firmada. Anularlo liberará el lote si aún está en trámite y revertirá el estado del lead si no tiene otra venta cerrada.
                        </p>
                      )}
                      <textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Motivo para anular este negocio (mínimo 3 caracteres)..."
                        rows={2}
                        className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-red-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busyCancel || cancelReason.trim().length < 3}
                          onClick={() => void handleConfirmCancel()}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {busyCancel && <Loader2 size={11} className="animate-spin" />} Confirmar anulación
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCanceling(false);
                            setCancelReason('');
                          }}
                          className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          Volver
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCanceling(true)}
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 transition"
                    >
                      <Ban size={12} /> Anular este negocio
                    </button>
                  )}
                </section>
              )}
            </div>

            {/* COLUMNA DERECHA (STICKY EN DESKTOP): RESUMEN FINANCIERO Y CONTROL DOCUMENTAL */}
            <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-4 space-y-5">
              {/* TARJETA RESUMEN */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 sm:p-5 shadow-xl backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Resumen del negocio</h3>
                  <span className="text-[11px] font-semibold text-zinc-400">ID: {deal.id.slice(0, 8)}...</span>
                </div>

                {/* Destacado del valor */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    {deal.plan ? 'Total pactado' : 'Total propuesto (Borrador)'}
                  </span>
                  <p className="text-2xl font-black text-white mt-0.5">
                    {activePlan ? money(activePlan.landValue) : 'Sin plan'}
                  </p>
                  {isApprovalPending ? (
                    <p className="mt-1 text-[11px] text-amber-300">
                      Plazo especial: {activePlan?.termMonths} meses (Pendiente por autorizar)
                    </p>
                  ) : activePlan?.specialTerm ? (
                    <p className="mt-1 text-[11px] text-amber-300">
                      Plazo especial: {activePlan.termMonths} meses
                      {activePlan.specialTerm.approvedBy ? ` (aprobado por ${activePlan.specialTerm.approvedBy})` : ''}
                    </p>
                  ) : null}
                </div>

                {/* Tabla de atributos */}
                <div className="space-y-2 text-xs text-zinc-300">
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Estado</span>
                    <span className={`rounded-full border px-2 py-0.2 text-[10px] font-bold ${STATUS_STYLE[deal.status]}`}>
                      {DEAL_STATUS_LABELS[deal.status]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Plazo</span>
                    <span className="font-semibold text-zinc-200">
                      {activePlan?.termMonths ? `${activePlan.termMonths} meses` : activePlan ? 'De contado' : 'Sin plan'}
                      {isApprovalPending && <span className="ml-1 text-[10px] text-amber-300">(Pendiente)</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Bono / Descuento</span>
                    <span className="font-semibold text-zinc-200">
                      {activePlan?.benefit ? money(activePlan.benefit) : 'No aplica'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Referido por</span>
                    <span className="font-semibold text-zinc-200">
                      {referralName(activePlan?.referredBy) || 'No aplica'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                    <span className="text-zinc-400">Documentos generados</span>
                    <span className="font-bold text-emerald-400">{deal.documents?.length ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-zinc-400">Soportes cargados</span>
                    <span className="font-bold text-zinc-200">{attachments.length} archivo(s)</span>
                  </div>
                </div>

                {/* Botón Reporte de venta */}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setShowSalesReport(true)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/50"
                  >
                    <FileText size={15} /> Generar reporte de venta
                  </button>
                )}
              </section>

              {/* TARJETA CONTROL DOCUMENTAL */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 sm:p-5 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Control documental</h3>
                  <button
                    type="button"
                    onClick={() => setTab('soportes')}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Ver soportes ({attachments.length}) →
                  </button>
                </div>
                <div className="space-y-2 pt-1">
                  <Checklist
                    ok={stats.buyersOk}
                    text={`Documentos compradores: ${stats.buyerDocs}/${deal.buyers.length}`}
                  />
                  {Boolean(deal.plan?.benefit) && <Checklist ok={stats.benefitOk} text="Autorización de bono/descuento" />}
                  {Boolean(referralName(deal.plan?.referredBy)) && <Checklist ok={stats.referralOk} text="Evidencia del referido" />}
                  {stats.separationPayments > 0 && (
                    <Checklist
                      ok={stats.paymentOk}
                      text={`Soportes de separación: ${stats.paymentProofs}/${stats.separationPayments} (${money(stats.separationPaid)} / ${money(stats.separationRequired)})`}
                    />
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: CONTRATOS (Generación, Listado y Firma Digital DocuBlock) */}
        {tab === 'contratos' && (
          <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start space-y-5 lg:space-y-0">
            {/* COLUMNA IZQUIERDA: GENERACIÓN Y LISTADO DE DOCUMENTOS */}
            <div className="lg:col-span-7 xl:col-span-7 space-y-5">
              {/* Generar contratos */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Generar contratos</h3>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${STATUS_STYLE[deal.status]}`}>
                    {DEAL_STATUS_LABELS[deal.status]}
                  </span>
                </div>

                {missingSupports.length > 0 && deal.status !== 'anulado' && (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 flex items-start justify-between gap-3 text-xs text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
                      <div>
                        <p className="font-semibold text-amber-100">Soportes recomendados pendientes</p>
                        <p className="mt-0.5 text-[11px] text-amber-200/90">{missingSupports.join(' · ')}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('soportes')}
                      className="shrink-0 font-bold underline text-amber-300 hover:text-white"
                    >
                      Subir →
                    </button>
                  </div>
                )}

                {canGeneratePreventa ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={!!generatingDoc}
                        onClick={() => void handleGenerateDoc('preventa')}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 transition disabled:opacity-50"
                      >
                        {generatingDoc === 'preventa' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                        {hasPreventa ? 'Generar preventa de nuevo' : 'Generar preventa'}
                      </button>
                      {hasPreventa ? (
                        <button
                          type="button"
                          disabled={!!generatingDoc}
                          onClick={() => void handleGenerateDoc('promesa')}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-50"
                        >
                          {generatingDoc === 'promesa' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                          Generar promesa
                        </button>
                      ) : (
                        <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500 text-center">
                          La promesa se habilita tras generar la preventa
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Genera la versión oficial del documento en Word y PDF con base en el plan acordado, los compradores registrados y el broker asignado (<strong className="text-zinc-200">{deal.advisorName || 'Asesor'}</strong>).
                      {hasPreventa && ' Si cambias el asesor en el encabezado, genera de nuevo la preventa para que aparezca su nombre en el contrato.'}
                    </p>
                  </div>
                ) : deal.status !== 'anulado' ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                    Para generar la preventa o la promesa completa primero los compradores, el lote y el plan en la pestaña <strong>Negocio</strong> (estado "Plan listo").
                  </div>
                ) : (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
                    Este negocio está anulado.
                  </div>
                )}
              </section>

              {/* Listado de Contratos y promesas */}
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h3 className="flex items-center gap-2 text-sm sm:text-base font-bold text-zinc-100">
                    <FileCheck2 size={18} className="text-emerald-400" /> Contratos y promesas generados
                  </h3>
                  <span className="text-xs text-zinc-400">{deal.documents?.length ?? 0} documento(s)</span>
                </div>
                {!deal.documents?.length && (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-500">
                    <FileText size={26} className="mx-auto mb-2 opacity-60" />
                    Aún no se han generado contratos ni promesas.
                  </div>
                )}
                <div className="mt-4 space-y-2.5">
                  {[...(deal.documents ?? [])].reverse().map((document) => {
                    const current = isCurrentDocument(document, deal);
                    return (
                    <div
                      key={`${document.kind}-${document.version}`}
                      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between shadow-sm ${
                        current ? 'border-zinc-800 bg-zinc-950/80' : 'border-amber-500/20 bg-zinc-950/40 opacity-80'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-zinc-100">
                            {document.kind === 'preventa' ? 'Contrato de preventa' : 'Promesa de compraventa'} · v{document.version}
                          </p>
                          {!current && (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.2 text-[10px] font-bold text-amber-300">
                              Lote anterior · vencido
                            </span>
                          )}
                          {document.signatureStatus === 'firmado' && (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.2 text-[10px] font-bold text-emerald-300">
                              ✓ Firmado
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Generado: {dateTime(document.generatedAt)} · Estado: {document.signatureStatus || 'generado'}
                        </p>
                        <p className="mt-1 truncate text-xs font-medium text-emerald-400">
                          {document.lot
                            ? `${projectName(document.lot.projectId)} · ${lotLabel(document.lot)}${document.lot.lotCode ? ` · Cód. ${document.lot.lotCode}` : ''}`
                            : `${projectName(deal.lot?.projectId)} · ${deal.lot?.sector} · Lote ${deal.lot?.lotNumber}${deal.lot?.lotCode ? ` · Cód. ${deal.lot.lotCode}` : ''}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        {document.signatureStatus === 'firmado' && document.signedPdfStoragePath && (
                          <button
                            onClick={() => void handleView(document.kind, document.version, true)}
                            disabled={!!downloadingDocument}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            {downloadingDocument === `signed-${document.kind}-${document.version}` ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={13} />
                            )}
                            Firmado
                          </button>
                        )}
                        <button
                          onClick={() => void handleView(document.kind, document.version)}
                          disabled={!!downloadingDocument}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {downloadingDocument === `view-${document.kind}-${document.version}` ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <FileText size={13} />
                          )}
                          Ver
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => void handleDocumentDownload(document.kind, document.version)}
                            disabled={downloadingDocument === `${document.kind}-${document.version}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            {downloadingDocument === `${document.kind}-${document.version}` ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Download size={13} />
                            )}
                            Word
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteDocument(document.kind, document.version)}
                            disabled={downloadingDocument === `del-${document.kind}-${document.version}`}
                            title="Eliminar este contrato"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-bold text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                          >
                            {downloadingDocument === `del-${document.kind}-${document.version}` ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Trash2 size={13} />
                            )}
                            Borrar
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* COLUMNA DERECHA (STICKY EN DESKTOP): FIRMA DIGITAL (DOCUBLOCK) */}
            <div className="lg:col-span-5 xl:col-span-5 lg:sticky lg:top-4 space-y-5">
              {companyId && (
                <DealSignatureStatus
                  companyId={companyId}
                  deal={deal}
                  canManage={isAdmin}
                  onChanged={handleRefresh}
                  onViewSigned={(doc) => handleView(doc.kind, doc.version, true)}
                />
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SOPORTES */}
        {tab === 'soportes' && (
          <div className="lg:grid lg:grid-cols-12 lg:gap-6 items-start space-y-5 lg:space-y-0">
            {/* COLUMNA IZQUIERDA: FORMULARIO STICKY PARA AGREGAR SOPORTE */}
            {!readOnly && (
            <div className="lg:col-span-5 xl:col-span-5 lg:sticky lg:top-4 space-y-5">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 sm:p-5 shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                  <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400">
                    <Upload size={15} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">Agregar soporte</h3>
                    <p className="text-[11px] text-zinc-400">Cédulas, recibos de caja, autorizaciones</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                      Categoría del soporte
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as DealAttachmentCategory)}
                      className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([val, lab]) => (
                        <option key={val} value={val}>
                          {String(lab)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {category === 'buyer_identification' && (
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                        Comprador al que pertenece
                      </label>
                      <select
                        value={buyerClientId}
                        onChange={(e) => setBuyerClientId(e.target.value)}
                        className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                      >
                        {[...deal.buyers]
                          .sort((a, b) => a.order - b.order)
                          .map((buyer) => (
                            <option key={buyer.clientId} value={buyer.clientId}>
                              {deal.buyerNames?.[buyer.order - 1] || `Comprador ${buyer.order}`}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {category === 'separation_payment' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                          Valor pagado
                        </label>
                        <input
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          placeholder="Ej: 3000000"
                          className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                          Fecha de pago
                        </label>
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                      Nota u observación
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Nota opcional: número de recibo, banco, observación…"
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-emerald-500 outline-none resize-none"
                    />
                  </div>

                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300 transition">
                    <Upload size={15} />
                    <span className="truncate">{file ? file.name : 'Seleccionar imagen o PDF (máx. 10 MB)'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <button
                    onClick={() => void handleUpload()}
                    disabled={
                      !file ||
                      busy ||
                      (category === 'buyer_identification' && !buyerClientId) ||
                      (category === 'separation_payment' && (!(Number(paymentAmount.replace(/\D/g, '')) > 0) || !paymentDate))
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 transition shadow-lg shadow-emerald-950/40"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Guardar soporte
                  </button>
                  {error && <p className="text-xs text-red-300">{error}</p>}
                </div>
              </section>
            </div>
            )}

            {/* COLUMNA DERECHA: LISTADO DE SOPORTES CARGADOS */}
            <div className={readOnly ? 'lg:col-span-12 space-y-5' : 'lg:col-span-7 xl:col-span-7 space-y-5'}>
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Paperclip size={16} className="text-emerald-400" />
                    <h3 className="text-sm font-bold text-zinc-200">Soportes del negocio</h3>
                  </div>
                  <span className="text-xs text-zinc-400">{attachments.length} archivo(s)</span>
                </div>

                {!attachments.length && (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-800 py-12 text-center text-xs text-zinc-500">
                    <FileText size={28} className="mx-auto mb-2 opacity-50" />
                    Aún no hay soportes cargados para este negocio.
                  </div>
                )}

                <div className="mt-4 space-y-2.5">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                            {CATEGORY_LABELS[attachment.category]}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-zinc-200">{attachment.fileName}</p>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {attachment.buyerName || ''}
                            {attachment.paymentAmount
                              ? `${attachment.buyerName ? ' · ' : ''}${money(attachment.paymentAmount)} · ${attachment.paymentDate}`
                              : ''}
                          </p>
                          {attachment.note && <p className="mt-2 text-xs text-zinc-400">{attachment.note}</p>}
                          <p className="mt-2 text-[10px] text-zinc-600">
                            {attachment.uploadedByName} · {dateTime(attachment.uploadedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          {companyId && (
                            <button
                              onClick={() => void handleViewAttachment(attachment)}
                              disabled={downloadingDocument === `att-${attachment.id}`}
                              title="Ver soporte"
                              className="rounded-lg border border-zinc-700 p-2 text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
                            >
                              {downloadingDocument === `att-${attachment.id}` ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                            </button>
                          )}
                          {companyId && (
                            <button
                              onClick={() => void downloadDealAttachment(companyId, deal.id, attachment.id)}
                              title="Descargar"
                              className="rounded-lg border border-zinc-700 p-2 text-emerald-300 hover:bg-zinc-800 transition"
                            >
                              <Download size={14} />
                            </button>
                          )}
                          {!readOnly && companyId && (isAdmin || attachment.uploadedBy === user?.uid) && (
                            <button
                              onClick={() => void handleDelete(attachment)}
                              title="Eliminar"
                              disabled={busy}
                              className="rounded-lg border border-zinc-700 p-2 text-red-300 hover:bg-red-500/10 transition"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB 4: BITÁCORA / HISTORIAL DEL NEGOCIO */}
        {tab === 'bitacora' && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <History size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-zinc-100">Bitácora del negocio</h3>
              </div>
              <button
                type="button"
                disabled={loadingActivities}
                onClick={() => void loadActivities()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                <RefreshCw size={12} className={loadingActivities ? 'animate-spin' : ''} /> Actualizar
              </button>
            </div>
            {loadingActivities && !activities && (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin text-emerald-400" /></div>
            )}
            {activities && activities.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-800 py-12 text-center text-xs text-zinc-500">
                No hay eventos registrados todavía para este negocio.
              </div>
            )}
            {activities && activities.length > 0 && (
              <div className="space-y-2.5">
                {activities.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950/75 p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                      <span className="font-semibold text-emerald-300">{entry.authorName}</span>
                      <span>{dateTime(entry.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-zinc-200 leading-relaxed">{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
