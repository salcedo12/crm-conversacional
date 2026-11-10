import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Bot, CalendarCheck, CalendarDays, CalendarPlus, Check, ClipboardList, Clock3, Compass, Loader2, Lock, LockOpen, MessageCircle, Phone, PhoneCall, PhoneOutgoing, Play, Save, Sparkles, Tags, UserRound, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadSourceBadge } from './LeadSourceBadge';
import { AiStatusBadge } from '@/features/inbox/components/AiStatusBadge';
import { CallHistory } from './CallHistory';
import { LeadAnalysisCard } from './LeadAnalysisCard';
import { LeadNotesPanel } from './LeadNotesPanel';
import { LeadAppointmentsPanel } from './LeadAppointmentsPanel';
import { BookAppointmentModal } from './BookAppointmentModal';
import { MERAKI_PROJECTS } from './NewLeadModal';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';
import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone } from '@/shared/utils/formatPhone';
import { updateLead } from '../services/leads.service';
import { reassignLead, setLeadAssignmentLock, type Advisor } from '../services/advisors.service';
import { RequestLeadTransferModal } from './RequestLeadTransferModal';
import { ArrowRightLeft, Handshake } from 'lucide-react';
import { LeadDealsPanel } from '@/features/deals/components/LeadDealsPanel';
import { recordLeadAudit } from '../services/leadAudit.service';
import { startAiCall, requestCallPermission } from '../services/calls.service';
import { useCallSession } from '@/features/calls/providers/CallSessionProvider';
import { listContactFields, type ContactField } from '../services/contactFields.service';
import { subscribeLeadSources, type LeadSourceItem } from '@/features/config/services/leadSources.service';
import { useCalls } from '../hooks/useCalls';
import { pauseAi, resumeAi } from '@/features/inbox/services/messages.service';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import type { Lead, LeadStatus } from '@/features/inbox/types';

interface LeadDrawerProps {
  lead: Lead;
  companyId: string;
  allTags?: string[];
  advisors: Advisor[];
  onClose: () => void;
}

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'closed', label: 'Vendido' },
];

const fieldClass = 'h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500/60';

export function LeadDrawer({ lead: leadProp, companyId, allTags = [], advisors, onClose }: LeadDrawerProps) {
  const navigate = useNavigate();
  const { role, platformAdmin, user, profile } = useAuth();
  const canReassign = platformAdmin || isAdminRole(role);

  const [liveLead, setLiveLead] = useState<Lead>(leadProp);
  const lead = liveLead;

  const initialProject = (lead.projectInterest && lead.projectInterest[0]) || (lead.metadata as any)?.project || (lead.metadata as any)?.smarthomeProyectoOriginal || lead.firstTouch?.project || '';
  const [projectInterest, setProjectInterest] = useState(initialProject);
  const [name, setName] = useState(lead.name ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [tagInput, setTagInput] = useState(lead.tags?.join(', ') ?? '');
  const [metadata, setMetadata] = useState<Record<string, string>>(lead.metadata ?? {});
  const [assignedTo, setAssignedTo] = useState(lead.assignedTo ?? '');
  const [locked, setLocked] = useState(!!lead.assignmentLocked);
  const [lockBusy, setLockBusy] = useState(false);
  const [customFields, setCustomFields] = useState<ContactField[]>([]);
  const [showAppointment, setShowAppointment] = useState(false);
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [apptRefresh, setApptRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [showRequestTransferModal, setShowRequestTransferModal] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [calling, setCalling] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [fuenteUbicacion, setFuenteUbicacion] = useState(lead.fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal || '');
  const [isEditingFuente, setIsEditingFuente] = useState(false);

  const { calls, loading: callsLoading } = useCalls(companyId, lead.id);
  const callSession = useCallSession();

  const toMillisSafe = (ts: unknown): number => {
    if (!ts) return 0;
    if (typeof (ts as any).toMillis === 'function') return (ts as any).toMillis();
    if (typeof (ts as any).toDate === 'function') return (ts as any).toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'object' && ('_seconds' in (ts as any) || 'seconds' in (ts as any))) {
      return ((ts as any)._seconds ?? (ts as any).seconds) * 1000;
    }
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      const d = new Date(ts).getTime();
      return isNaN(d) ? 0 : d;
    }
    return 0;
  };

  const expiresAtMillis = toMillisSafe(lead.callPermission?.expiresAt);
  const lastRequestedMillis = toMillisSafe(lead.callPermission?.lastRequestedAt);
  const hasCallPermission = !!lead.callPermission?.granted && (!expiresAtMillis || expiresAtMillis > Date.now());
  const requestedRecently = !!lastRequestedMillis && (Date.now() - lastRequestedMillis) < 24 * 60 * 60 * 1000;

  useEffect(() => {
    setLiveLead(leadProp);
  }, [leadProp]);

  useEffect(() => {
    if (!companyId || !leadProp.id) return;
    const unsub = onSnapshot(
      doc(db, 'companies', companyId, 'leads', leadProp.id),
      (snap) => {
        if (!snap.exists()) return;
        const fresh = { id: snap.id, ...(snap.data() as any) } as Lead;
        setLiveLead((prev) => ({ ...prev, ...fresh }));
        setStatus(fresh.status);
        if (fresh.metadata) {
          setMetadata(fresh.metadata as Record<string, string>);
        }
      },
      (err) => console.warn('[LeadDrawer] live lead listener error:', err)
    );
    return () => unsub();
  }, [companyId, leadProp.id]);

  useEffect(() => {
    setName(leadProp.name ?? '');
    setPhone(leadProp.phone ?? '');
    setStatus(leadProp.status);
    setTagInput(leadProp.tags?.join(', ') ?? '');
    setMetadata(leadProp.metadata ?? {});
    setAssignedTo(leadProp.assignedTo ?? '');
    setLocked(!!leadProp.assignmentLocked);
    setFuenteUbicacion(leadProp.fuenteUbicacion || leadProp.metadata?.smarthomeFuenteOriginal || '');
    setProjectInterest((leadProp.projectInterest && leadProp.projectInterest[0]) || (leadProp.metadata as any)?.project || (leadProp.metadata as any)?.smarthomeProyectoOriginal || leadProp.firstTouch?.project || '');
    setIsEditingFuente(false);
    setSuggestionDismissed(false);
    setError(null);
    setSaved(false);
  }, [leadProp.id, leadProp.fuenteUbicacion, leadProp.metadata?.smarthomeFuenteOriginal]);

  useEffect(() => {
    if (!companyId) return;
    return subscribeLeadSources(companyId, (items) => {
      setSources(items.filter((s) => s.active));
    });
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    listContactFields(companyId)
      .then(setCustomFields)
      .catch((err) => console.error('[LeadDrawer] contact fields error:', err));
  }, [companyId]);

  const currentTags = useMemo(
    () => tagInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagInput]
  );
  const tagSuggestions = allTags.filter(
    (tag) => !currentTags.some((current) => current.toLowerCase() === tag.toLowerCase())
  );
  const displayName = lead.name ?? formatPhone(lead.phone);
  const isWhatsapp = !lead.channel || lead.channel === 'whatsapp';
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const assignedAdvisor = advisors.find((advisor) => advisor.id === (assignedTo || lead.assignedTo));
  const takeoverAdvisor = advisors.find((advisor) => advisor.id === lead.takeoverBy);
  const isAdvisorDirect = lead.inbox === 'advisor_direct' || lead.source === 'advisor_whatsapp' || (lead.metadata as Record<string, unknown> | undefined)?.advisorWhatsappMirror === 'true';
  const hasRealPhone = Boolean(lead.phone && !lead.phone.startsWith('user_') && !lead.phone.includes('CO.'));
  const isAssigned = lead.assignedTo === user?.uid;
  const canEditPhone = canReassign || isAssigned || !hasRealPhone;

  const isDirty = name.trim() !== (lead.name ?? '')
    || (canEditPhone && phone.trim() !== (lead.phone ?? ''))
    || status !== lead.status
    || tagInput.trim() !== (lead.tags?.join(', ') ?? '')
    || fuenteUbicacion !== (lead.fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal || '')
    || projectInterest !== initialProject
    || JSON.stringify(metadata) !== JSON.stringify(lead.metadata ?? {});

  const addTag = (tag: string) => {
    if (!currentTags.some((current) => current.toLowerCase() === tag.toLowerCase())) {
      setTagInput([...currentTags, tag].join(', '));
    }
  };

  const removeTag = (tag: string) => {
    setTagInput(currentTags.filter((current) => current !== tag).join(', '));
  };

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    const prevFuente = lead.fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal || '';
    const newFuente = fuenteUbicacion.trim();
    const fuenteChanged = newFuente && newFuente !== prevFuente;

    try {
      await updateLead({
        companyId,
        leadId: lead.id,
        name: name.trim() || undefined,
        ...(canEditPhone && phone.trim() ? { phone: phone.trim() } : {}),
        status,
        tags: currentTags,
        metadata: {
          ...metadata,
          ...(projectInterest ? { project: projectInterest } : {}),
        },
        fuenteUbicacion: newFuente || undefined,
        projectInterest: projectInterest ? [projectInterest] : [],
      });

      if (fuenteChanged) {
        const adminName = profile?.displayName || profile?.email || user?.displayName || user?.email || 'Administrador';
        await recordLeadAudit({
          companyId,
          leadId: lead.id,
          adminId: user?.uid || '',
          adminName,
          changeType: 'source',
          previousValue: prevFuente || 'Sin especificar',
          newValue: newFuente,
        });
      }

      setIsEditingFuente(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      console.error('[LeadDrawer] save error:', saveError);
      const message = saveError instanceof Error ? saveError.message : '';
      setError(message || 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  // Estado sugerido por la IA (radiografía nocturna). Se muestra solo si es un
  // cambio real respecto al estado actualmente seleccionado y el asesor no lo descartó.
  const suggested = lead.aiAnalysis?.suggestedStatus;
  const suggestion =
    suggested && suggested !== 'ninguno' && suggested !== status && !suggestionDismissed
      ? { value: suggested as LeadStatus, label: STATUS_OPTIONS.find((o) => o.value === suggested)?.label ?? suggested }
      : null;

  const handleApplySuggestion = async () => {
    if (!suggestion || applyingSuggestion) return;
    const previous = status;
    setStatus(suggestion.value);
    setApplyingSuggestion(true);
    setError(null);
    try {
      await updateLead({ companyId, leadId: lead.id, status: suggestion.value });
      setSuggestionDismissed(true);
    } catch (applyError) {
      console.error('[LeadDrawer] apply suggestion error:', applyError);
      setStatus(previous);
      setError('No se pudo aplicar el estado sugerido.');
    } finally {
      setApplyingSuggestion(false);
    }
  };

  const handleReassign = async (value: string) => {
    const previous = assignedTo;
    setAssignedTo(value);
    setReassigning(true);
    setError(null);
    try {
      await reassignLead(companyId, lead.id, value || null);
      const advObj = advisors.find((a) => a.id === value);
      const newAdvName = advObj?.displayName || (value ? 'Asesor CRM' : 'Sin asesor');
      const prevAdvName = advisors.find((a) => a.id === previous)?.displayName || 'Sin asesor';
      const adminName = profile?.displayName || profile?.email || user?.displayName || user?.email || 'Administrador';
      await recordLeadAudit({
        companyId,
        leadId: lead.id,
        adminId: user?.uid || '',
        adminName,
        changeType: 'advisor',
        previousValue: prevAdvName,
        newValue: newAdvName,
      });
    } catch (reassignError) {
      console.error('[LeadDrawer] reassign error:', reassignError);
      setAssignedTo(previous);
      setError('No se pudo cambiar el asesor.');
    } finally {
      setReassigning(false);
    }
  };

  const handleToggleLock = async () => {
    if (lockBusy) return;
    const next = !locked;
    setLocked(next);
    setLockBusy(true);
    setError(null);
    try {
      await setLeadAssignmentLock(companyId, lead.id, next);
    } catch (lockError) {
      console.error('[LeadDrawer] lock error:', lockError);
      setLocked(!next);
      setError('No se pudo cambiar el candado del asesor.');
    } finally {
      setLockBusy(false);
    }
  };

  const handleToggleAi = async () => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      await (lead.aiEnabled ? pauseAi(companyId, lead.id) : resumeAi(companyId, lead.id));
    } catch (toggleError) {
      console.error('[LeadDrawer] toggle AI error:', toggleError);
      setError('No se pudo cambiar el estado de la IA.');
    } finally {
      setToggling(false);
    }
  };

  const handleAiCall = async () => {
    if (calling) return;
    setCalling(true);
    setError(null);
    try {
      await startAiCall(companyId, lead.id);
    } catch (callError) {
      console.error('[LeadDrawer] AI call error:', callError);
      const code = (callError as { code?: string })?.code;
      setError(
        code === 'functions/failed-precondition'
          ? 'Las llamadas con IA aún no están configuradas.'
          : 'No se pudo iniciar la llamada con IA.'
      );
    } finally {
      setCalling(false);
    }
  };

  const handleRequestCallPermission = async () => {
    if (requestingPermission || requestedRecently) return;
    setRequestingPermission(true);
    setError(null);
    try {
      await requestCallPermission(companyId, lead.id);
    } catch (permError) {
      console.error('[LeadDrawer] request call permission error:', permError);
      setError('No se pudo enviar la solicitud de permiso de llamada.');
    } finally {
      setRequestingPermission(false);
    }
  };

  const handleWhatsappCall = () => {
    if (callSession.state !== 'idle') return;
    void callSession.startOutboundCall(companyId, { id: lead.id, name: lead.name, phone: lead.phone });
  };

  const openConversation = () => {
    onClose();
    navigate(`/dashboard/inbox?lead=${encodeURIComponent(lead.id)}`);
  };

  return (
    <div className="fixed inset-0 z-[110] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />

      <aside
        className="relative z-[111] flex h-dvh w-full max-w-[420px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-zinc-800 px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:px-5 sm:py-4 sm:pt-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 text-sm font-semibold text-violet-200">
              {initials || <UserRound size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-zinc-100">{displayName}</h2>
              {isWhatsapp && (
                <a href={`tel:${lead.phone}`} className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
                  <Phone size={12} /> {formatPhone(lead.phone)}
                </a>
              )}
            </div>
            <button onClick={onClose} title="Cerrar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer active:scale-95 shadow-sm">
              <X size={18} />
            </button>
          </div>

          <div className="mt-3.5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button onClick={openConversation} size="sm" className="flex-1 justify-center shadow-sm">
                <MessageCircle size={15} /> Abrir conversación
              </Button>
              <button
                type="button"
                onClick={handleToggleAi}
                disabled={toggling}
                title={lead.aiEnabled ? 'IA activa — Toca para pausar' : 'IA pausada — Toca para activar'}
                className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm ${
                  lead.aiEnabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                }`}
              >
                <Bot size={14} className={`shrink-0 ${lead.aiEnabled ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
                <span>{lead.aiEnabled ? 'IA activa' : 'IA pausada'}</span>
              </button>
            </div>

            <div className={`grid ${isWhatsapp ? 'grid-cols-4' : 'grid-cols-2'} gap-1.5`}>
              <button
                type="button"
                onClick={() => setShowFichaModal(true)}
                title="Diligenciar Ficha Técnica"
                className="flex h-9 items-center justify-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 shadow-sm"
              >
                <ClipboardList size={14} className="shrink-0 text-emerald-400" />
                <span>Ficha</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAppointment(true)}
                title="Agendar cita"
                className="flex h-9 items-center justify-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 shadow-sm"
              >
                <CalendarPlus size={14} className="shrink-0 text-sky-400" />
                <span>Agendar</span>
              </button>
              {isWhatsapp && (
                <button
                  type="button"
                  onClick={handleAiCall}
                  disabled={calling}
                  title="Llamada de voz con IA"
                  className="flex h-9 items-center justify-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 text-xs font-semibold text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-50 shadow-sm"
                >
                  <PhoneCall size={14} className={`shrink-0 ${calling ? 'animate-pulse' : ''}`} />
                  <span>Llamar IA</span>
                </button>
              )}
              {isWhatsapp && (hasCallPermission ? (
                <button
                  type="button"
                  onClick={handleWhatsappCall}
                  disabled={callSession.state !== 'idle'}
                  title="Llamar por WhatsApp"
                  className="flex h-9 items-center justify-center gap-1 rounded-lg border border-teal-500/30 bg-teal-500/10 text-xs font-semibold text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-50 shadow-sm"
                >
                  <PhoneOutgoing size={13} className="shrink-0" />
                  <span>Llamar WA</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestCallPermission}
                  disabled={requestingPermission || requestedRecently}
                  title={requestedRecently ? 'Permiso solicitado en las últimas 24h' : 'Pedir permiso para llamar por WhatsApp'}
                  className="flex h-9 items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-700 disabled:opacity-50 shadow-sm"
                >
                  <PhoneOutgoing size={13} className={`shrink-0 ${requestingPermission ? 'animate-pulse' : ''}`} />
                  <span>Permiso WA</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-12">
          <section className="border-b border-zinc-800 px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <LeadStatusBadge status={lead.status} size="md" />
                <AiStatusBadge aiEnabled={lead.aiEnabled} />
              </div>
              {false && (
                <button
                  type="button"
                  onClick={() => setShowFichaModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 shadow-sm"
                >
                  <ClipboardList size={13} />
                  <span>📝 Ficha Técnica & Seguimiento</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info icon={CalendarDays} label="Alta" value={formatMessageTime(lead.createdAt)} />
              <Info icon={Clock3} label="Última actividad" value={lead.lastMessageAt ? formatMessageTime(lead.lastMessageAt) : 'Sin actividad'} />
              <div className="min-w-0">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
                    <Compass size={11} className="text-emerald-400" /> Fuente
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsEditingFuente(!isEditingFuente)}
                    className="text-[10px] text-zinc-500 hover:text-emerald-300 transition-colors"
                  >
                    {isEditingFuente ? 'Listo' : 'Cambiar'}
                  </button>
                </div>
                {isEditingFuente ? (
                  <div className="mt-1">
                    <select
                      value={fuenteUbicacion}
                      onChange={(e) => setFuenteUbicacion(e.target.value)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      {fuenteUbicacion && !sources.some((s) => s.name === fuenteUbicacion) && (
                        <option value={fuenteUbicacion}>{fuenteUbicacion} (Histórica)</option>
                      )}
                      {sources.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="mt-1">
                    <LeadSourceBadge
                      source={lead.source}
                      fuenteUbicacion={fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal}
                    />
                  </div>
                )}
              </div>
              <Info icon={UserRound} label="Asesor" value={assignedAdvisor?.displayName ?? 'Sin asignar'} />
            </div>
            {lead.takeoverBy && (
              <p className="mt-3 text-[11px] text-zinc-500">Control manual: <span className="text-zinc-300">{takeoverAdvisor?.displayName ?? lead.takeoverBy}</span></p>
            )}

            {/* Banner de Seguimiento Activo & Próximo Paso */}
            {((lead as any).lastFollowUpAt || (lead as any).nextFollowUpDate || (lead as any).nextFollowUpAction || (lead as any).lastFollowUpAction) && (
              <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <span>🕒</span> Seguimiento Comercial Activo
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFichaModal(true)}
                    className="text-[11px] font-bold text-emerald-300 hover:underline cursor-pointer"
                  >
                    + Diligenciar Ficha
                  </button>
                </div>
                {(lead as any).lastFollowUpAction && (
                  <p className="text-zinc-300 text-[11px]">
                    <span className="text-zinc-500">Última acción:</span>{' '}
                    <span className="font-semibold text-emerald-300 capitalize">
                      {(lead as any).lastFollowUpAction?.replace(/_/g, ' ')}
                    </span>
                    {(lead as any).lastFollowUpAt && (
                      <span className="text-zinc-500"> ({formatMessageTime((lead as any).lastFollowUpAt)})</span>
                    )}
                  </p>
                )}
                {(lead as any).nextFollowUpAction && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-300 font-medium bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-lg mt-1">
                    <span>🎯 Próximo paso:</span>
                    <span className="font-bold text-amber-200">{(lead as any).nextFollowUpAction}</span>
                    {(lead as any).nextFollowUpDate && (
                      <span className="text-zinc-400 font-mono text-[10px] ml-auto">
                        📅 {(lead as any).nextFollowUpDate}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tarjeta Unificada de Atribución Comercial, Proyecto & Campaña */}
            {(() => {
              const ft = lead.firstTouch;
              const lt = lead.lastTouch;
              const m = lead.metadata ?? {};
              const gclid = ft?.gclid || lt?.gclid || m.gclid || m.webGclid;
              const fbclid = ft?.fbclid || lt?.fbclid || m.fbclid || m.webFbclid;
              const project = projectInterest || (lead.projectInterest && lead.projectInterest[0]) || ft?.project || m.webArea || (!isAdvisorDirect && lead.smartHomeProjectCode === '48c9266a' ? 'Laguna Mar (Melgar)' : null);
              const campaign = ft?.campaign || m.metaCampaignName || m.webUtmCampaign;
              const adName = ft?.adName || m.metaAdName || lead.sourceMeta?.headline;

              return (
                <div className="mt-3 rounded-md border border-violet-500/25 bg-violet-500/[0.04] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                      🎯 Atribución Comercial & Proyecto
                    </p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                      {isAdvisorDirect ? '👤 Directo Asesor' : '🏢 Línea 317'}
                    </span>
                  </div>

                  {project && (
                    <div className="mb-2 p-2 rounded bg-zinc-800/80 border border-zinc-700">
                      <p className="text-[10px] text-zinc-400">Proyecto de Interés:</p>
                      <p className="text-xs font-semibold text-emerald-400">🏡 {project}</p>
                    </div>
                  )}

                  <div className="space-y-1 text-[11px]">
                    <p className="text-zinc-400">
                      <span className="text-zinc-500">Primera Entrada:</span>{' '}
                      <span className="text-zinc-200 font-medium">{ft?.source || lead.source}</span>
                      {campaign && <span className="text-violet-300 font-medium"> — {campaign}</span>}
                    </p>
                    {adName && (
                      <p className="text-[10px] text-zinc-500">
                        Anuncio / Creativo: <span className="text-zinc-300">{adName}</span>
                      </p>
                    )}
                    {lead.sourceMeta?.sourceUrl && (
                      <div className="pt-1">
                        <a
                          href={lead.sourceMeta.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-600/20 px-2.5 py-1 text-[11px] font-medium text-violet-300 hover:bg-violet-600/40 hover:text-white transition-colors"
                        >
                          <Play size={11} className="fill-current text-violet-400" />
                          <span>Ver anuncio / video en Facebook ↗</span>
                        </a>
                      </div>
                    )}
                    {lt && lt.campaign && lt.campaign !== campaign && (
                      <p className="text-zinc-400">
                        <span className="text-zinc-500">Último Reingreso:</span>{' '}
                        <span className="text-zinc-200 font-medium">{lt.source}</span>
                        <span className="text-cyan-300"> — {lt.campaign}</span>
                      </p>
                    )}
                    {gclid && (
                      <p className="text-[10px] text-zinc-500 truncate" title={gclid}>
                        🔍 Google Ads ID: <span className="font-mono text-zinc-400">{gclid.slice(0, 20)}...</span>
                      </p>
                    )}
                    {fbclid && (
                      <p className="text-[10px] text-zinc-500 truncate" title={fbclid}>
                        📣 Meta Ads ID: <span className="font-mono text-zinc-400">{fbclid.slice(0, 20)}...</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase text-zinc-500">Datos del contacto</p>
              <label className="mb-1.5 block text-xs text-zinc-400">Nombre</label>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={formatPhone(lead.phone)} className={fieldClass} />
            </div>

            {canEditPhone && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs text-zinc-400">Teléfono / Celular</label>
                  {!hasRealPhone && (
                    <span className="text-[10px] font-semibold text-amber-400">
                      ⚠️ Entró con usuario WhatsApp (sin número)
                    </span>
                  )}
                </div>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+573001234567"
                  inputMode="tel"
                  className={fieldClass}
                />
                {!hasRealPhone && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Ingresa el número para habilitar llamadas salientes y contacto por WhatsApp personal.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5 font-medium">
                  🏡 Proyecto de interés
                </span>
                {projectInterest ? (
                  <span className="text-[10px] text-emerald-400 font-semibold">Seleccionado</span>
                ) : (
                  <span className="text-[10px] text-zinc-500">Sin definir</span>
                )}
              </label>
              <select
                value={projectInterest}
                onChange={(event) => setProjectInterest(event.target.value)}
                className={fieldClass}
              >
                <option value="">Sin especificar / Por definir</option>
                {MERAKI_PROJECTS.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.label}
                  </option>
                ))}
                {projectInterest && !MERAKI_PROJECTS.some((p) => p.id === projectInterest) && (
                  <option value={projectInterest}>{projectInterest} (Personalizado)</option>
                )}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-zinc-400">Estado comercial</label>
              <select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)} className={fieldClass}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {suggestion && (
                <div className="mt-2.5 rounded-xl border border-violet-500/30 bg-violet-500/[0.08] p-3 shadow-sm">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-200">
                    <Sparkles size={13} className="shrink-0 text-violet-400" />
                    La IA sugiere: <span className="font-bold text-violet-300">{suggestion.label}</span>
                  </p>
                  {lead.aiAnalysis?.suggestedStatusReason && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300 break-words">{lead.aiAnalysis.suggestedStatusReason}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApplySuggestion}
                      disabled={applyingSuggestion}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/30 px-3 py-1.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-600/50 disabled:opacity-50 cursor-pointer shadow-sm"
                    >
                      {applyingSuggestion ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Aplicar cambio
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestionDismissed(true)}
                      disabled={applyingSuggestion}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canReassign ? (
              <div>
                <label className="mb-1.5 block text-xs text-zinc-400">Asesor asignado</label>
                <select value={assignedTo} onChange={(event) => handleReassign(event.target.value)} disabled={reassigning} className={`${fieldClass} disabled:opacity-50`}>
                  <option value="">Sin asignar</option>
                  {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.displayName}{advisor.googleConnected ? ' - Calendar' : ''}</option>)}
                </select>
                {reassigning && <p className="mt-1 text-[10px] text-zinc-500">Actualizando asignación...</p>}

                <button
                  type="button"
                  onClick={handleToggleLock}
                  disabled={lockBusy}
                  className={`mt-2 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50 ${
                    locked
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:border-amber-500/70'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {locked ? <Lock size={14} className="shrink-0" /> : <LockOpen size={14} className="shrink-0" />}
                  <span className="leading-tight">
                    {locked ? 'Asesor fijado — no se reasignará' : 'Fijar asesor (bloquear reasignación)'}
                    <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
                      {locked
                        ? 'Toca para permitir la reasignación automática de nuevo.'
                        : 'Evita que la reasignación automática por falta de contacto lo mueva.'}
                    </span>
                  </span>
                </button>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs text-zinc-400">Asesor asignado</label>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserRound size={13} className="text-zinc-400 shrink-0" />
                    <span className="text-xs text-zinc-200 truncate font-medium">
                      {advisors.find((a) => a.id === assignedTo)?.displayName || (isAssigned ? 'Asignado a ti' : 'Sin asignar')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRequestTransferModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                    title="Solicitar al administrador la reasignación o traslado de este prospecto"
                  >
                    <ArrowRightLeft size={12} />
                    <span>Solicitar Reasignación</span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-400"><Tags size={13} /> Etiquetas</label>
              <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="interesado, proyecto, prioridad" className={fieldClass} />
              {currentTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentTags.map((tag) => (
                    <button key={tag} onClick={() => removeTag(tag)} title="Quitar etiqueta" className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-red-500/40 hover:text-red-300">
                      {tag} <X size={10} />
                    </button>
                  ))}
                </div>
              )}
              {tagSuggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {tagSuggestions.slice(0, 8).map((tag) => (
                    <button key={tag} onClick={() => addTag(tag)} className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-violet-500/30 hover:text-violet-300">+ {tag}</button>
                  ))}
                </div>
              )}
            </div>

            {customFields.length > 0 && (
              <div className="border-t border-zinc-800 pt-4">
                <p className="mb-3 text-[10px] font-semibold uppercase text-zinc-500">Campos personalizados</p>
                <div className="space-y-3">
                  {customFields.map((field) => (
                    <label key={field.id} className="block text-xs text-zinc-400">
                      {field.label}
                      {field.type === 'select' ? (
                        <select
                          value={metadata[field.id] ?? ''}
                          onChange={(event) => setMetadata((prev) => ({ ...prev, [field.id]: event.target.value }))}
                          className={`${fieldClass} mt-1.5`}
                        >
                          <option value="">Sin valor</option>
                          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={metadata[field.id] ?? ''}
                          onChange={(event) => setMetadata((prev) => ({ ...prev, [field.id]: event.target.value }))}
                          className={`${fieldClass} mt-1.5`}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
                <CalendarCheck size={12} /> Citas
              </p>
              <button
                onClick={() => setShowAppointment(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 hover:text-sky-200"
              >
                <CalendarPlus size={12} /> Agendar
              </button>
            </div>
            <LeadAppointmentsPanel companyId={companyId} leadId={lead.id} refreshKey={apptRefresh} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-400">
              <Handshake size={13} className="text-emerald-400" /> Negocio
            </p>
            <LeadDealsPanel companyId={companyId} lead={lead} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-400">
                <ClipboardList size={13} className="text-emerald-400" /> Bitácora & Historial de Seguimientos
              </p>
            </div>
            <LeadNotesPanel
              companyId={companyId}
              leadId={lead.id}
              onOpenNewFicha={() => setShowFichaModal(true)}
            />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <Sparkles size={12} /> Radiografía IA
            </p>
            <LeadAnalysisCard lead={lead} companyId={companyId} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <PhoneCall size={12} /> Llamadas con IA
            </p>
            <CallHistory calls={calls} loading={callsLoading} />
          </section>
        </div>

        <footer className="border-t border-zinc-800 bg-zinc-900 px-5 py-3.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-xl">
          <Button
            onClick={handleSave}
            disabled={!isDirty || saving}
            loading={saving}
            className={`w-full transition-all text-xs font-semibold ${
              isDirty
                ? '!bg-emerald-600 hover:!bg-emerald-500 !text-white font-bold shadow-lg shadow-emerald-900/30 ring-1 ring-emerald-400/40'
                : 'opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 border border-zinc-700/50'
            }`}
          >
            <Save size={15} /> {saved ? '✓ Cambios guardados' : isDirty ? 'Guardar cambios pendientes' : 'Sin cambios pendientes'}
          </Button>
        </footer>
      </aside>

      {showAppointment && (
        <BookAppointmentModal
          companyId={companyId}
          lead={lead}
          onClose={() => setShowAppointment(false)}
          onBooked={() => setApptRefresh((n) => n + 1)}
        />
      )}

      {showFichaModal && (
        <FichaTecnicaModal
          isOpen={showFichaModal}
          onClose={() => setShowFichaModal(false)}
          companyId={companyId}
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            project: projectInterest || (lead.projectInterest && lead.projectInterest[0]) || lead.firstTouch?.project || lead.metadata?.webArea || null,
            advisorName: assignedAdvisor?.displayName ?? null,
            bitacoras: (lead as any).bitacoras,
            metadata: lead.metadata,
          }}
          onProjectChange={(newProj) => setProjectInterest(newProj)}
          onSuccess={() => {
            setShowFichaModal(false);
            setApptRefresh((n) => n + 1);
          }}
        />
      )}

      {showRequestTransferModal && (
        <RequestLeadTransferModal
          isOpen={showRequestTransferModal}
          onClose={() => setShowRequestTransferModal(false)}
          companyId={companyId}
          leadId={lead.id}
          leadName={lead.name}
          leadPhone={lead.phone}
          currentAdvisorId={assignedTo}
          currentAdvisorName={advisors.find((a) => a.id === assignedTo)?.displayName}
          advisors={advisors}
          currentUserId={user?.uid}
        />
      )}
    </div>
  );
}

function Info({
  icon: Icon, label, value, capitalize = false,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] text-zinc-600"><Icon size={12} /> {label}</p>
      <p className={`mt-1 truncate text-xs text-zinc-300 ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  );
}
