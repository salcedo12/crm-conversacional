import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import {
  Phone, MessageCircle, ClipboardList, Clock, AlertTriangle, AlertCircle, CheckCircle2,
  Building2, User, MapPin, Calendar, History, ChevronDown, ChevronUp,
  PhoneMissed, MessageSquare, Pencil, ExternalLink, ArrowUpRight
} from 'lucide-react';
import { formatFriendlyDate } from '@/shared/utils/date';
import { PIPELINE_STAGES } from '@/features/pipeline/types/pipeline.types';
import { updateLeadPipelineStage } from '@/features/pipeline/services/pipeline.service';
import { reassignLead } from '@/features/leads/services/advisors.service';
import { recordLeadAudit } from '@/features/leads/services/leadAudit.service';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { registerQuickNoContesto } from '../services/commercial.service';
import type { CommercialLeadItem } from '../types/commercial.types';

interface CommercialLeadsTableProps {
  leads: CommercialLeadItem[];
  onOpenFicha: (lead: CommercialLeadItem) => void;
  loading: boolean;
  companyId?: string;
  authorName?: string;
  isAdmin?: boolean;
  advisors?: { id: string; name: string }[];
  onLeadUpdated?: (leadId: string, updates: Partial<CommercialLeadItem>) => void;
}

export function CommercialLeadsTable({
  leads,
  onOpenFicha,
  loading,
  companyId,
  authorName = 'Asesor',
  isAdmin = false,
  advisors = [],
  onLeadUpdated,
}: CommercialLeadsTableProps) {
  const { user, profile } = useAuth();
  const effectiveAuthor = profile?.displayName || profile?.email || user?.displayName || user?.email || authorName || 'Administrador';
  const adminId = user?.uid || '';
  const [expandedBitacoras, setExpandedBitacoras] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [stageDropdownOpen, setStageDropdownOpen] = useState<string | null>(null);

  const toggleBitacoras = (leadId: string) => {
    setExpandedBitacoras((prev) => ({ ...prev, [leadId]: !prev[leadId] }));
  };

  const handleStageChange = async (lead: CommercialLeadItem, newStageId: string) => {
    if (!companyId) return;
    setStageDropdownOpen(null);
    setActionLoading((prev) => ({ ...prev, [lead.id]: true }));
    try {
      await updateLeadPipelineStage(companyId, lead.id, newStageId, authorName);
      const stageObj = PIPELINE_STAGES.find((s) => s.id === newStageId);
      let newStatus: string | undefined;
      if (stageObj?.id === 'firma') newStatus = 'closed';
      else if (stageObj?.group === 'no_interesado') newStatus = 'lost';
      else if (stageObj?.id === 'cita' || stageObj?.id === 'visita_realizada') newStatus = 'scheduled';
      else if (stageObj?.group === 'linea') newStatus = 'qualified';
      else if (stageObj?.id === 'contactado' || stageObj?.id === 'envio_info' || stageObj?.id === 'prospecto') newStatus = 'active';

      if (onLeadUpdated) {
        onLeadUpdated(lead.id, {
          pipelineStage: newStageId,
          pipelineStageLabel: stageObj?.label || newStageId,
          ...(newStatus ? { status: newStatus } : {}),
        });
      }
    } catch (err) {
      console.error('[CommercialLeadsTable] Error actualizando etapa:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [lead.id]: false }));
    }
  };

  const handleQuickNoContesto = async (lead: CommercialLeadItem) => {
    if (!companyId) return;
    setActionLoading((prev) => ({ ...prev, [lead.id]: true }));
    try {
      const res = await registerQuickNoContesto(companyId, lead, authorName);
      const updatedBitacoras = [res.bitacoraEntry, ...(lead.bitacoras || [])];
      if (onLeadUpdated) {
        onLeadUpdated(lead.id, {
          nextFollowUpDate: res.nextFollowUpDate,
          nextFollowUpAction: res.nextFollowUpAction,
          isOverdue: false,
          isToday: true,
          bitacorasCount: updatedBitacoras.length,
          bitacoras: updatedBitacoras,
          hasFicha: true,
          lastFollowUpAction: 'llamada',
          lastFollowUpDate: formatFriendlyDate(new Date()),
          ...(lead.status === 'lost' ? { status: 'active' } : {}),
        });
      }
    } catch (err) {
      console.error('[CommercialLeadsTable] Error al marcar no contestó:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [lead.id]: false }));
    }
  };

  const handleUpdateFuente = async (lead: CommercialLeadItem) => {
    if (!companyId) return;
    const currentVal = lead.fuenteUbicacion || '';
    const nueva = window.prompt(
      `Cambiar fuente/medio para "${lead.name}":\n(Ej: Trabajo de campo, Feria, Línea WhatsApp 317, Referidos, Redes Sociales...)`,
      currentVal
    );
    if (nueva === null) return;
    const trimmed = nueva.trim();
    if (!trimmed || trimmed === currentVal) return;

    try {
      const docRef = doc(db, 'companies', companyId, 'leads', lead.id);
      await updateDoc(docRef, {
        fuenteUbicacion: trimmed,
        'metadata.fuenteUbicacion': trimmed,
        updatedAt: serverTimestamp(),
      });

      const auditRes = await recordLeadAudit({
        companyId,
        leadId: lead.id,
        adminId,
        adminName: effectiveAuthor,
        changeType: 'source',
        previousValue: currentVal || 'Sin especificar',
        newValue: trimmed,
      });

      if (onLeadUpdated) {
        onLeadUpdated(lead.id, {
          fuenteUbicacion: trimmed,
          bitacoras: auditRes.updatedBitacoras as any,
          bitacorasCount: auditRes.updatedBitacoras.length,
          hasFicha: true,
          lastFollowUpAction: 'cambio_fuente',
          lastFollowUpDate: auditRes.bitacoraEntry.lastDate,
          lastFollowUpAuthor: effectiveAuthor,
        });
      }
    } catch (err) {
      console.error('[CommercialLeadsTable] Error actualizando fuente:', err);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-zinc-500 text-xs flex flex-col items-center justify-center gap-2">
        <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></span>
        <span>Cargando prospectos para gestión comercial...</span>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="py-16 text-center text-zinc-500 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8">
        <ClipboardList size={36} className="mx-auto mb-2 text-zinc-600" />
        <p className="text-xs font-semibold text-zinc-300">No hay prospectos en esta categoría</p>
        <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
          Cambia los filtros o busca por nombre/teléfono para ver otros contactos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {leads.map((lead) => {
        const cleanPhone = (lead.phone || '').replace(/\D/g, '');
        const waLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
        const telLink = cleanPhone ? `tel:+${cleanPhone}` : null;
        const isExpanded = !!expandedBitacoras[lead.id];
        const isBusy = !!actionLoading[lead.id];
        const isStageOpen = stageDropdownOpen === lead.id;
        const isMissingFollowUp = !!lead.missingPeriodFollowUp && lead.status !== 'lost' && lead.status !== 'closed';

        return (
          <div
            key={lead.id}
            className={`rounded-2xl border p-3.5 sm:p-4 transition-all hover:border-zinc-700 bg-zinc-900/50 flex flex-col gap-3 min-w-0 w-full overflow-hidden ${
              isMissingFollowUp
                ? 'border-rose-500/50 bg-gradient-to-r from-rose-950/25 via-zinc-900/70 to-zinc-900/50 shadow-md ring-1 ring-rose-500/20'
                : lead.isOverdue
                ? 'border-rose-500/30 bg-rose-950/10'
                : lead.isToday
                ? 'border-amber-500/30 bg-amber-950/10'
                : !lead.hasFicha
                ? 'border-sky-500/25'
                : 'border-zinc-800'
            }`}
          >
            {/* Fila Principal: Datos + Acciones */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4 w-full min-w-0">
              {/* Información del Cliente */}
              <div className="min-w-0 w-full flex-1 space-y-1.5">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  <button
                    type="button"
                    onClick={() => window.open(`/dashboard/inbox?lead=${encodeURIComponent(lead.id)}`, '_blank')}
                    className="font-bold text-sm text-zinc-100 hover:text-amber-400 flex items-center gap-1.5 min-w-0 group cursor-pointer transition-colors text-left"
                    title="Clic para abrir el contacto en otra página (Bandeja CRM)"
                  >
                    <span className="truncate max-w-[200px] sm:max-w-xs group-hover:underline">{lead.name}</span>
                    <ArrowUpRight size={13} className="text-zinc-500 group-hover:text-amber-400 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0" />
                  </button>

                  {/* Badge Falta Seguimiento Semana */}
                  {isMissingFollowUp && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/25 text-rose-300 border border-rose-500/50 shrink-0">
                      <AlertCircle size={11} className="text-rose-400 shrink-0 animate-pulse" />
                      <span>Falta seguimiento semana</span>
                    </span>
                  )}

                  {/* Badge de Proyecto */}
                  {lead.project && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0 max-w-[150px]" title={lead.project}>
                      <Building2 size={10} className="text-zinc-400 shrink-0" />
                      <span className="truncate">{lead.project}</span>
                    </span>
                  )}

                  {/* Badge de Estado Cancelado o Cerrado */}
                  {lead.status === 'lost' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 shrink-0">
                      Cancelado / No Interesado
                    </span>
                  )}
                  {lead.status === 'closed' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/40 shrink-0">
                      Venta Cerrada 🎉
                    </span>
                  )}

                  {/* Selector Rápido de Etapa del Embudo */}
                  {(() => {
                    const currentStageConfig = PIPELINE_STAGES.find((s) => s.id === lead.pipelineStage);
                    const isNoInteresado = lead.status === 'lost' || currentStageConfig?.group === 'no_interesado';
                    const stageColorClass = currentStageConfig?.badgeColor || (isNoInteresado
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30');

                    return (
                      <div className="relative inline-block shrink-0">
                        <button
                          type="button"
                          onClick={() => setStageDropdownOpen(isStageOpen ? null : lead.id)}
                          disabled={isBusy}
                          title="Haz clic para cambiar la etapa del prospecto"
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border hover:opacity-85 transition-colors cursor-pointer max-w-[150px] ${stageColorClass}`}
                        >
                          <span className="truncate">{lead.pipelineStageLabel || currentStageConfig?.label || 'Prospecto'}</span>
                          <ChevronDown size={11} className={isNoInteresado ? 'text-rose-400 shrink-0' : 'text-emerald-400 shrink-0'} />
                        </button>

                        {/* Menú Flotante de Etapas */}
                        {isStageOpen && (
                          <div className="absolute left-0 top-6 z-30 w-48 rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-2xl space-y-0.5 max-h-56 overflow-y-auto">
                            <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                              Mover a Etapa:
                            </p>
                            {PIPELINE_STAGES.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => handleStageChange(lead, s.id)}
                                className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${
                                  lead.pipelineStage === s.id
                                    ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                                }`}
                              >
                                <span>{s.label}</span>
                                <span className="text-[10px] text-zinc-500">{s.probabilityLabel}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Asesor asignado (Selector interactivo para Admin, insignia informativa para Asesor) */}
                  {isAdmin && advisors.length > 0 ? (
                    <div className="relative inline-block shrink-0">
                      <select
                        value={lead.advisorId || ''}
                        onChange={async (e) => {
                          const newAdvId = e.target.value;
                          if (!newAdvId || newAdvId === lead.advisorId || !companyId) return;
                          const advObj = advisors.find((a) => a.id === newAdvId);
                          const newAdvName = advObj?.name || 'Asesor CRM';
                          const prevAdvName = lead.advisorName || 'Sin asesor';
                          try {
                            await reassignLead(companyId, lead.id, newAdvId);
                            const auditRes = await recordLeadAudit({
                              companyId,
                              leadId: lead.id,
                              adminId,
                              adminName: effectiveAuthor,
                              changeType: 'advisor',
                              previousValue: prevAdvName,
                              newValue: newAdvName,
                            });
                            if (onLeadUpdated) {
                              onLeadUpdated(lead.id, {
                                advisorId: newAdvId,
                                advisorName: newAdvName,
                                bitacoras: auditRes.updatedBitacoras as any,
                                bitacorasCount: auditRes.updatedBitacoras.length,
                                hasFicha: true,
                                lastFollowUpAction: 'cambio_asesor',
                                lastFollowUpDate: auditRes.bitacoraEntry.lastDate,
                                lastFollowUpAuthor: effectiveAuthor,
                              });
                            }
                          } catch (err) {
                            console.error('[CommercialLeadsTable] Error al reasignar:', err);
                          }
                        }}
                        title="Cambiar asesor asignado a este prospecto"
                        className="bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 rounded-full px-2.5 py-0.5 text-[10px] text-zinc-300 outline-none cursor-pointer max-w-[180px] sm:max-w-[220px] truncate transition-colors"
                      >
                        <option value="" disabled>Asignar Asesor...</option>
                        {advisors.map((a) => (
                          <option key={a.id} value={a.id} className="bg-zinc-900 text-zinc-100">
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 shrink-0 max-w-[140px]" title={lead.advisorName}>
                      <User size={11} className="text-zinc-500 shrink-0" />
                      <span className="truncate">{lead.advisorName}</span>
                    </span>
                  )}
                </div>

                {/* Teléfono + Fuente / Ubicación */}
                <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap min-w-0">
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Phone size={11} className="text-zinc-500 shrink-0" />
                    <span>{lead.phone}</span>
                  </span>
                  {lead.fuenteUbicacion && (
                    <>
                      <span className="text-zinc-600 shrink-0">•</span>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleUpdateFuente(lead)}
                          title="Clic para cambiar la fuente/medio de este contacto (Solo Administrador)"
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-emerald-400 min-w-0 max-w-[200px] sm:max-w-xs truncate cursor-pointer hover:underline group"
                        >
                          <MapPin size={11} className="text-zinc-500 shrink-0 group-hover:text-emerald-400 transition-colors" />
                          <span className="truncate">{lead.fuenteUbicacion}</span>
                          <Pencil size={9} className="opacity-0 group-hover:opacity-100 text-emerald-400 shrink-0 ml-0.5 transition-opacity" />
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-zinc-500 min-w-0 max-w-[200px] sm:max-w-xs truncate" title={lead.fuenteUbicacion}>
                          <MapPin size={11} className="text-zinc-500 shrink-0" />
                          <span className="truncate">{lead.fuenteUbicacion}</span>
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Estado de Ficha & Último Seguimiento */}
                <div className="pt-0.5 min-w-0">
                  {lead.hasFicha ? (
                    <div className="text-xs text-zinc-300 flex items-center gap-1.5 flex-wrap min-w-0">
                      {lead.status === 'lost' || lead.pipelineStage?.startsWith('no_interesado') ? (
                        <>
                          <span className="text-zinc-400 font-medium flex items-center gap-1 shrink-0">
                            <ClipboardList size={13} className="shrink-0 text-zinc-500" /> Ficha:
                          </span>
                          <span className="text-zinc-400 font-medium">
                            [Descarte / Desistimiento]
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-emerald-400 font-semibold flex items-center gap-1 shrink-0">
                            <CheckCircle2 size={13} className="shrink-0" /> Con Ficha:
                          </span>
                          <span className="text-zinc-200 font-medium">
                            {lead.lastFollowUpAction ? `[${lead.lastFollowUpAction}]` : 'Última gestión'}
                          </span>
                        </>
                      )}
                      {lead.lastFollowUpDate && (
                        <span className="text-zinc-400 text-[11px] font-medium shrink-0">· {lead.lastFollowUpDate}</span>
                      )}
                      {lead.lastFollowUpAuthor && (
                        <span className="text-zinc-500 text-[11px] truncate max-w-[130px]">por {lead.lastFollowUpAuthor}</span>
                      )}

                      {/* Botón Acordeón de Bitácoras */}
                      {lead.bitacorasCount > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleBitacoras(lead.id)}
                          className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 px-2 py-0.5 rounded-full border border-sky-500/30 transition-colors cursor-pointer shrink-0 ml-0.5"
                        >
                          <History size={10} className="shrink-0" />
                          <span>{lead.bitacorasCount} gestiones</span>
                          {isExpanded ? <ChevronUp size={10} className="shrink-0" /> : <ChevronDown size={10} className="shrink-0" />}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-sky-300 flex items-center gap-1.5 flex-wrap min-w-0">
                      <AlertTriangle size={13} className="text-sky-400 shrink-0" />
                      <span className="font-medium">Sin ficha técnica registrada aún. Registra el primer contacto.</span>
                    </div>
                  )}
                </div>

                {/* Próximo paso agendado / Recordatorio */}
                {lead.nextFollowUpDate ? (
                  <div className={`mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border max-w-full flex-wrap min-w-0 ${
                    lead.isOverdue
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                      : lead.isToday
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-zinc-800/80 border-zinc-700 text-zinc-300'
                  }`}>
                    {lead.isOverdue ? (
                      <AlertTriangle size={12} className="text-rose-400 shrink-0" />
                    ) : lead.isToday ? (
                      <Clock size={12} className="text-amber-400 shrink-0" />
                    ) : (
                      <Calendar size={12} className="text-indigo-400 shrink-0" />
                    )}
                    <span className="break-words min-w-0">
                      <strong className="font-semibold">
                        {lead.isOverdue ? 'Vencido: ' : lead.isToday ? 'Para Hoy: ' : 'Próximo: '}
                      </strong>
                      {lead.nextFollowUpAction || 'Contacto programado'} ({formatFriendlyDate(lead.nextFollowUpDate)})
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-500 italic mt-0.5">
                    Sin recordatorio agendado a futuro.
                  </p>
                )}

                {/* Alerta Destacada: Falta Seguimiento de la Semana */}
                {isMissingFollowUp && (
                  <div className="mt-1.5 text-xs text-rose-300 bg-rose-500/15 border border-rose-500/40 rounded-xl p-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle size={15} className="text-rose-400 shrink-0" />
                      <div className="min-w-0">
                        <strong className="text-rose-200">FALTA SEGUIMIENTO:</strong>{' '}
                        <span className="text-rose-300/90">
                          Prospecto captado esta semana sin llamadas ni bitácoras comerciales registradas.
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenFicha(lead)}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/30 hover:bg-rose-500/50 text-rose-100 font-bold text-[11px] border border-rose-400/40 transition cursor-pointer shrink-0"
                    >
                      Diligenciar gestión ahora →
                    </button>
                  </div>
                )}
              </div>

              {/* ── Acciones directas Desktop (md y superior) ── */}
              <div className="hidden md:flex items-center gap-1.5 shrink-0 justify-end">
                {/* 1. Botón "No Contestó" */}
                {lead.phone && (
                  <button
                    type="button"
                    onClick={() => handleQuickNoContesto(lead)}
                    disabled={isBusy}
                    title="Registrar que no contestó y reprogramar recordatorio"
                    className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-rose-300 hover:text-rose-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <PhoneMissed size={13} />
                    <span>No contestó</span>
                  </button>
                )}

                {/* 2. Ver Contacto en Otra Página */}
                <button
                  type="button"
                  onClick={() => window.open(`/dashboard/inbox?lead=${encodeURIComponent(lead.id)}`, '_blank')}
                  title="Abrir este contacto en otra página (Bandeja CRM)"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-500/30 bg-sky-950/30 hover:bg-sky-900/50 text-sky-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <MessageSquare size={14} className="text-sky-400 shrink-0" />
                  <span className="hidden xl:inline">Ver contacto</span>
                  <ExternalLink size={11} className="opacity-70 shrink-0" />
                </button>

                {/* 3. Llamar Directo */}
                {telLink && (
                  <a
                    href={telLink}
                    title="Llamar teléfono celular"
                    className="p-2.5 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    <Phone size={14} />
                  </a>
                )}

                {/* 4. WhatsApp Directo */}
                {waLink && (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir chat en WhatsApp"
                    className="p-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                  >
                    <MessageCircle size={14} />
                  </a>
                )}

                {/* 5. Diligenciar Ficha Técnica */}
                <button
                  type="button"
                  onClick={() => onOpenFicha(lead)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                >
                  <ClipboardList size={14} />
                  <span>{lead.hasFicha || (lead.bitacoras?.length || 0) > 0 ? 'Actualizar Ficha' : 'Diligenciar Ficha'}</span>
                </button>
              </div>
            </div>

            {/* ── Acciones directas Mobile (< md) ── */}
            <div className="flex md:hidden flex-col gap-2 w-full pt-2.5 border-t border-zinc-800/80">
              <div className="grid grid-cols-4 gap-1.5 w-full">
                {/* 1. Botón No Contestó */}
                <button
                  type="button"
                  onClick={() => handleQuickNoContesto(lead)}
                  disabled={isBusy || !lead.phone}
                  title="Marcar que no contestó y reprogramar recordatorio"
                  className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[10px] font-semibold transition-colors disabled:opacity-30 cursor-pointer"
                >
                  <PhoneMissed size={14} className="mb-0.5 text-rose-400" />
                  <span className="truncate">No contestó</span>
                </button>

                {/* 2. Ver Contacto en Otra Página */}
                <button
                  type="button"
                  onClick={() => window.open(`/dashboard/inbox?lead=${encodeURIComponent(lead.id)}`, '_blank')}
                  title="Abrir este contacto en otra página"
                  className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-sky-500/30 bg-sky-950/30 hover:bg-sky-900/50 text-sky-300 text-[10px] font-semibold transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-0.5">
                    <MessageSquare size={14} className="text-sky-400" />
                    <ExternalLink size={9} className="text-sky-400/80" />
                  </div>
                  <span className="truncate mt-0.5">Ver contacto</span>
                </button>

                {/* 3. Llamada Celular */}
                {telLink ? (
                  <a
                    href={telLink}
                    title="Llamada celular"
                    className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-[10px] font-semibold transition-colors"
                  >
                    <Phone size={14} className="mb-0.5 text-amber-400" />
                    <span>Llamar</span>
                  </a>
                ) : (
                  <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-zinc-900 bg-zinc-950/40 text-zinc-600 text-[10px]">
                    <Phone size={14} className="mb-0.5 opacity-30" />
                    <span>Sin tel.</span>
                  </div>
                )}

                {/* 4. WhatsApp Directo */}
                {waLink ? (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir WhatsApp"
                    className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold transition-colors"
                  >
                    <MessageCircle size={14} className="mb-0.5 text-emerald-400" />
                    <span>WhatsApp</span>
                  </a>
                ) : (
                  <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-zinc-900 bg-zinc-950/40 text-zinc-600 text-[10px]">
                    <MessageCircle size={14} className="mb-0.5 opacity-30" />
                    <span>Sin WA</span>
                  </div>
                )}
              </div>

              {/* 5. Diligenciar / Actualizar Ficha Técnica Full Width */}
              <button
                type="button"
                onClick={() => onOpenFicha(lead)}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                <ClipboardList size={15} />
                <span>{lead.hasFicha || (lead.bitacoras?.length || 0) > 0 ? 'Actualizar Ficha Técnica' : 'Diligenciar Ficha Técnica'}</span>
              </button>
            </div>

            {/* ── Acordeón Desplegable de Bitácoras e Historial Previo ── */}
            {isExpanded && (
              <div className="mt-2 pt-3 border-t border-zinc-800/90 bg-zinc-950/60 rounded-xl p-3 sm:p-3.5 space-y-2.5 animate-fadeIn min-w-0 w-full overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <History size={13} className="text-sky-400" />
                    <span>Línea de Tiempo de Gestiones ({lead.bitacoras?.length || 0})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleBitacoras(lead.id)}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    Ocultar historial
                  </button>
                </div>

                {(!lead.bitacoras || lead.bitacoras.length === 0) ? (
                  <p className="text-xs text-zinc-500 italic py-2">No hay gestiones previas registradas para este contacto.</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {lead.bitacoras.map((b: any, idx: number) => (
                      <div key={idx} className="text-xs border-l-2 border-emerald-500/50 pl-3 py-1 space-y-1">
                        <div className="flex items-center gap-2 text-zinc-400 text-[10px] flex-wrap">
                          <span className="font-semibold text-zinc-200">{formatFriendlyDate(b.fecha || b.lastDate)}</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-medium">{b.action || 'Gestión comercial'}</span>
                          {b.asesor && (
                            <>
                              <span>•</span>
                              <span className="text-zinc-500">por {b.asesor}</span>
                            </>
                          )}
                        </div>
                        {b.description && (
                          <p className="text-zinc-300 text-[11px] leading-relaxed whitespace-pre-line bg-zinc-900/70 p-2 rounded-lg border border-zinc-800/70 break-words">
                            {b.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
