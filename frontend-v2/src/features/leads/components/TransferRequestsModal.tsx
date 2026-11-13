import { useState, useEffect, useCallback } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  User,
  Phone,
  Building2,
  FileText,
  ClipboardList,
  History,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  listLeadTransferRequests,
  resolveLeadTransferRequest,
  type LeadTransferRequestItem,
} from '@/features/inbox/services/contacts.service';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';

interface TransferRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  onResolved?: () => void;
}

function formatBogotaDateTime(millis: number | null): string {
  if (!millis) return 'Sin registro';
  try {
    return new Date(millis).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(millis).toLocaleString();
  }
}

export function TransferRequestsModal({
  isOpen,
  onClose,
  companyId,
  onResolved,
}: TransferRequestsModalProps) {
  const [requests, setRequests] = useState<LeadTransferRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedFichaReq, setSelectedFichaReq] = useState<{
    leadId: string;
    leadName: string;
    leadPhone: string;
    leadProject: string;
    currentAdvisorName: string;
    initialTab: 'form' | 'history';
  } | null>(null);

  const handleOpenFicha = (req: LeadTransferRequestItem, initialTab: 'form' | 'history' = 'history') => {
    setSelectedFichaReq({
      leadId: req.leadId,
      leadName: req.leadName || 'Prospecto',
      leadPhone: req.leadPhone || '',
      leadProject: req.leadProject || '',
      currentAdvisorName: req.currentAdvisorName || 'Asesor Asignado',
      initialTab,
    });
  };

  const loadRequests = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const items = await listLeadTransferRequests(companyId, 'all');
      setRequests(items);
    } catch (err: any) {
      console.error('[TransferRequestsModal] Error cargando solicitudes:', err);
      setError(err?.message || 'No se pudieron cargar las solicitudes de traslado.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (isOpen && companyId) {
      loadRequests();
    }
  }, [isOpen, companyId, loadRequests]);

  if (!isOpen) return null;

  const pendingList = requests.filter((r) => r.status === 'pending');
  const historyList = requests.filter((r) => r.status !== 'pending');
  const displayed = tab === 'pending' ? pendingList : historyList;

  const handleDecision = async (req: LeadTransferRequestItem, decision: 'approve' | 'reject') => {
    if (resolvingId) return;
    setResolvingId(req.id);
    setError(null);
    try {
      await resolveLeadTransferRequest({
        companyId,
        requestId: req.id,
        decision,
        adminNote: adminNotes[req.id]?.trim() || undefined,
      });
      await loadRequests();
      if (onResolved) onResolved();
    } catch (err: any) {
      console.error('[TransferRequestsModal] Error resolviendo solicitud:', err);
      setError(err?.message || 'No se pudo procesar la decisión.');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden text-zinc-100 flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <ArrowRightLeft size={19} />
            </span>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-2">
                <span>Solicitudes de Traslado de Prospectos</span>
                {pendingList.length > 0 && (
                  <span className="text-[11px] font-bold bg-amber-500 text-zinc-950 px-2 py-0.5 rounded-full">
                    {pendingList.length} pendiente{pendingList.length === 1 ? '' : 's'}
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400">
                Verifica cuándo fue el último seguimiento real del asesor actual antes de aprobar o rechazar el traslado.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadRequests}
              disabled={loading}
              title="Actualizar solicitudes"
              className="p-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin text-amber-400' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Pestañas */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-zinc-800 bg-zinc-950/40">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              tab === 'pending'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Clock size={13} />
            <span>Pendientes por Revisar ({pendingList.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              tab === 'history'
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <FileText size={13} />
            <span>Historial Resueltas ({historyList.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-3.5 flex-1">
          {error && (
            <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/60 text-rose-200 text-xs">
              ⚠️ {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-zinc-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw size={20} className="animate-spin text-amber-400" />
              <span>Consultando solicitudes y auditando último seguimiento...</span>
            </div>
          ) : displayed.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-zinc-800 rounded-2xl p-6">
              <ArrowRightLeft size={28} className="mx-auto text-zinc-600 mb-2" />
              <p className="text-sm font-semibold text-zinc-300">
                {tab === 'pending'
                  ? 'No hay solicitudes de traslado pendientes'
                  : 'Aún no hay historial de traslados resueltos'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {tab === 'pending'
                  ? 'Cuando un asesor intente registrar un número asignado a otro compañero y solicite el traslado, aparecerá aquí.'
                  : 'Aquí verás las solicitudes aprobadas o rechazadas anteriormente.'}
              </p>
            </div>
          ) : (
            displayed.map((req) => {
              const isBusy = resolvingId === req.id;
              const hasFollowUp = req.lastFollowUpMillis !== null;
              const days = req.daysSinceFollowUp;

              return (
                <div
                  key={req.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3.5 shadow-md"
                >
                  {/* Fila superior: Datos del Prospecto y Estado */}
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800/80 pb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
                          <User size={14} className="text-amber-400" />
                          {req.leadName || 'Prospecto'}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 flex items-center gap-1">
                          <Phone size={11} className="text-zinc-400" />
                          {req.leadPhone}
                        </span>
                        {req.leadProject && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 flex items-center gap-1">
                            <Building2 size={11} />
                            {req.leadProject}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Solicitado el {formatBogotaDateTime(req.createdAtMillis)}
                        {req.leadSource ? ` · Fuente original: ${req.leadSource}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleOpenFicha(req, 'history')}
                        title="Ver la bitácora completa de gestiones y seguimientos de este prospecto"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
                      >
                        <History size={13} />
                        <span>Ver Bitácora</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenFicha(req, 'form')}
                        title="Ver los detalles y perfil en la Ficha Técnica oficial"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
                      >
                        <ClipboardList size={13} />
                        <span>Ficha Técnica</span>
                      </button>

                      {req.leadId && (
                        <button
                          type="button"
                          onClick={() => window.open(`/dashboard/inbox?lead=${encodeURIComponent(req.leadId)}`, '_blank')}
                          title="Abrir conversación en Bandeja de Chats en una nueva pestaña"
                          className="p-1.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}

                      {req.status === 'pending' ? (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                          ⏳ Pendiente de decisión
                        </span>
                      ) : req.status === 'approved' ? (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                          ✅ Aprobado ({formatBogotaDateTime(req.resolvedAtMillis)})
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300">
                          ❌ Rechazado ({formatBogotaDateTime(req.resolvedAtMillis)})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Comparativa: Asesor Actual vs Asesor Solicitante */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Bloque 1: Asesor Actual + Auditoría de Último Seguimiento */}
                    <div
                      className={`rounded-xl border p-3 space-y-1.5 ${
                        !hasFollowUp || (days !== null && days >= 7)
                          ? 'border-amber-500/35 bg-amber-500/5'
                          : 'border-zinc-800 bg-zinc-900/70'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Asesor Actual Asignado
                        </span>
                        {hasFollowUp ? (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              days === 0
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : (days ?? 0) <= 5
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {days === 0 ? 'Seguimiento Hoy' : `Hace ${days} día${days === 1 ? '' : 's'}`}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 flex items-center gap-1">
                            <AlertTriangle size={10} /> Sin gestión
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-bold text-zinc-100">{req.currentAdvisorName}</p>

                      <div className="pt-1 border-t border-zinc-800/80 text-[11px]">
                        <p className="text-zinc-300 font-medium">
                          <span className="text-zinc-400">Último seguimiento: </span>
                          {hasFollowUp ? (
                            <strong className="text-emerald-300">
                              {formatBogotaDateTime(req.lastFollowUpMillis)}
                            </strong>
                          ) : (
                            <strong className="text-amber-300">
                              Nunca ha registrado seguimiento ni bitácora
                            </strong>
                          )}
                        </p>
                        {req.lastFollowUpSummary && (
                          <p className="text-zinc-400 mt-1 line-clamp-2 italic bg-zinc-950/60 p-1.5 rounded-lg border border-zinc-800/60">
                            "{req.lastFollowUpSummary}"
                          </p>
                        )}
                        <div className="pt-2 mt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenFicha(req, 'history')}
                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300 hover:underline cursor-pointer"
                          >
                            <History size={12} />
                            <span>Ver bitácora de {req.currentAdvisorName} →</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenFicha(req, 'form')}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                          >
                            <ClipboardList size={11} />
                            <span>Ficha técnica</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Bloque 2: Quien solicita el traslado y por qué */}
                    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                          Asesor que Solicita el Traslado
                        </span>
                        <span className="text-[10px] text-sky-300/80 font-medium">Solicitante</span>
                      </div>

                      <p className="text-xs font-bold text-zinc-100">{req.requesterName}</p>

                      <div className="pt-1 border-t border-sky-500/15 text-[11px]">
                        <span className="text-zinc-400 font-medium">Motivo reportado:</span>
                        <p className="text-zinc-200 mt-0.5 bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/70">
                          {req.reason || 'Solicita traslado del prospecto'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Acciones de Aprobar o Rechazar */}
                  {req.status === 'pending' ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-zinc-800/80">
                      <input
                        type="text"
                        value={adminNotes[req.id] || ''}
                        onChange={(e) =>
                          setAdminNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                        }
                        placeholder="Nota opcional del Administrador (quedará en bitácora)..."
                        className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(req, 'reject')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          <span>Rechazar</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(req, 'approve')}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} />
                          <span>{isBusy ? 'Procesando...' : req.isReassignmentRequest ? 'Aprobar Reasignación' : 'Aprobar Traslado'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    req.adminNote && (
                      <div className="text-[11px] text-zinc-400 pt-1 border-t border-zinc-800/60">
                        <strong>Nota Admin ({req.resolvedByName}):</strong> {req.adminNote}
                      </div>
                    )
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal Integrado de Ficha Técnica y Bitácora */}
      {selectedFichaReq && companyId && (
        <FichaTecnicaModal
          isOpen={!!selectedFichaReq}
          onClose={() => setSelectedFichaReq(null)}
          companyId={companyId}
          lead={{
            id: selectedFichaReq.leadId,
            name: selectedFichaReq.leadName,
            phone: selectedFichaReq.leadPhone,
            project: selectedFichaReq.leadProject,
            advisorName: selectedFichaReq.currentAdvisorName,
          }}
          initialTab={selectedFichaReq.initialTab}
          onSuccess={() => {
            loadRequests();
            if (onResolved) onResolved();
          }}
        />
      )}
    </div>
  );
}
