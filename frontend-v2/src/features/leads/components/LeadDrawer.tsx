import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CalendarCheck, CalendarDays, CalendarPlus, Check, Clock3, FileSearch, Loader2, Lock, LockOpen, MessageCircle, Pause, Phone, PhoneCall, PhoneOutgoing, Play, Save, Sparkles, StickyNote, Tags, UserRound, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadSourceBadge } from './LeadSourceBadge';
import { AiStatusBadge } from '@/features/inbox/components/AiStatusBadge';
import { CallHistory } from './CallHistory';
import { LeadAnalysisCard } from './LeadAnalysisCard';
import { LeadDossierCard } from './LeadDossierCard';
import { LeadNotesPanel } from './LeadNotesPanel';
import { LeadAppointmentsPanel } from './LeadAppointmentsPanel';
import { SmartHomeActionsPanel } from './SmartHomeActionsPanel';
import { BookAppointmentModal } from './BookAppointmentModal';
import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone } from '@/shared/utils/formatPhone';
import { updateLead } from '../services/leads.service';
import { reassignLead, setLeadAssignmentLock, type Advisor } from '../services/advisors.service';
import { startAiCall, requestCallPermission } from '../services/calls.service';
import { useCallSession } from '@/features/calls/providers/CallSessionProvider';
import { listContactFields, type ContactField } from '../services/contactFields.service';
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

export function LeadDrawer({ lead, companyId, allTags = [], advisors, onClose }: LeadDrawerProps) {
  const navigate = useNavigate();
  const { role, platformAdmin } = useAuth();
  const canReassign = platformAdmin || isAdminRole(role);

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
  const [apptRefresh, setApptRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [calling, setCalling] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { calls, loading: callsLoading } = useCalls(companyId, lead.id);
  const callSession = useCallSession();

  const hasCallPermission = !!lead.callPermission?.granted
    && (!lead.callPermission.expiresAt || lead.callPermission.expiresAt.toMillis() > Date.now());
  const requestedRecently = !!lead.callPermission?.lastRequestedAt
    && (Date.now() - lead.callPermission.lastRequestedAt.toMillis()) < 24 * 60 * 60 * 1000;

  useEffect(() => {
    setName(lead.name ?? '');
    setPhone(lead.phone ?? '');
    setStatus(lead.status);
    setTagInput(lead.tags?.join(', ') ?? '');
    setMetadata(lead.metadata ?? {});
    setAssignedTo(lead.assignedTo ?? '');
    setLocked(!!lead.assignmentLocked);
    setSuggestionDismissed(false);
    setError(null);
    setSaved(false);
  }, [lead.id]);

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
  const smartHomeCreated = !!lead.smartHomeCustomerId;
  const smartHomeDuplicate = lead.smartHomeSyncError === 'smarthome-duplicado-requiere-revision';
  const smartHomeOwner = lead.smartHomeDuplicateMatches?.[0]?.ownerName ?? lead.smartHomeDuplicateMatches?.[0]?.ownerId;
  const isDirty = name.trim() !== (lead.name ?? '')
    || (canReassign && phone.trim() !== (lead.phone ?? ''))
    || status !== lead.status
    || tagInput.trim() !== (lead.tags?.join(', ') ?? '')
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
    try {
      await updateLead({
        companyId,
        leadId: lead.id,
        name: name.trim() || undefined,
        ...(canReassign ? { phone: phone.trim() } : {}),
        status,
        tags: currentTags,
        metadata,
      });
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
        <header className="border-b border-zinc-800 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-5 sm:py-4">
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
            <button onClick={onClose} title="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={17} />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={openConversation} size="sm" className="flex-1">
              <MessageCircle size={15} /> Abrir conversación
            </Button>
            <button
              onClick={() => setShowAppointment(true)}
              title="Agendar cita"
              className="flex h-8 w-9 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-300 transition-colors hover:bg-sky-500/20"
            >
              <CalendarPlus size={14} />
            </button>
            {isWhatsapp && (
              <button
                onClick={handleAiCall}
                disabled={calling}
                title="Llamar con IA"
                className="flex h-8 w-9 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <PhoneCall size={14} className={calling ? 'animate-pulse' : ''} />
              </button>
            )}
            {isWhatsapp && (hasCallPermission ? (
              <button
                onClick={handleWhatsappCall}
                disabled={callSession.state !== 'idle'}
                title="Llamar por WhatsApp"
                className="flex h-8 w-9 items-center justify-center rounded-md border border-teal-500/30 bg-teal-500/10 text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-50"
              >
                <PhoneOutgoing size={14} />
              </button>
            ) : (
              <button
                onClick={handleRequestCallPermission}
                disabled={requestingPermission || requestedRecently}
                title={requestedRecently ? 'Ya se envió la solicitud, espera respuesta del lead' : 'Solicitar permiso para llamar por WhatsApp'}
                className="flex h-8 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                <PhoneOutgoing size={14} className={requestingPermission ? 'animate-pulse' : ''} />
              </button>
            ))}
            <button
              onClick={handleToggleAi}
              disabled={toggling}
              title={lead.aiEnabled ? 'Pausar IA' : 'Activar IA'}
              className={`flex h-8 w-9 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${lead.aiEnabled ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'}`}
            >
              {lead.aiEnabled ? <Pause size={14} /> : <Play size={14} />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <section className="border-b border-zinc-800 px-5 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <LeadStatusBadge status={lead.status} size="md" />
              <AiStatusBadge aiEnabled={lead.aiEnabled} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info icon={CalendarDays} label="Alta" value={formatMessageTime(lead.createdAt)} />
              <Info icon={Clock3} label="Última actividad" value={lead.lastMessageAt ? formatMessageTime(lead.lastMessageAt) : 'Sin actividad'} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-600"><MessageCircle size={12} /> Fuente</p>
                <div className="mt-1"><LeadSourceBadge source={lead.source} /></div>
              </div>
              <Info icon={UserRound} label="Asesor" value={assignedAdvisor?.displayName ?? 'Sin asignar'} />
            </div>
            {lead.takeoverBy && (
              <p className="mt-3 text-[11px] text-zinc-500">Control manual: <span className="text-zinc-300">{takeoverAdvisor?.displayName ?? lead.takeoverBy}</span></p>
            )}
            {canReassign && (smartHomeCreated || smartHomeDuplicate) && (
              <div className={`mt-3 rounded-md border px-3 py-2 text-[11px] ${smartHomeCreated ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                {smartHomeCreated ? (
                  <p>SmartHome: creado{lead.smartHomeCustomerId && lead.smartHomeCustomerId !== 'ok' ? ` (${lead.smartHomeCustomerId})` : ''}.</p>
                ) : (
                  <p>SmartHome: ya existe{smartHomeOwner ? ` con ${smartHomeOwner}` : ''}. No se puede crear de nuevo.</p>
                )}
              </div>
            )}
            {(() => {
              const m = lead.metadata ?? {};
              const rows: { label: string; value?: string }[] = [
                { label: 'Campaña',   value: m.metaCampaignName },
                { label: 'Conjunto',  value: m.metaAdsetName },
                { label: 'Anuncio',   value: m.metaAdName || lead.sourceMeta?.headline },
                { label: 'Formulario', value: m.metaFormName },
              ].filter((r) => r.value);
              if (rows.length === 0) return null;
              return (
                <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-blue-300/80">Origen de la pauta</p>
                  <div className="space-y-0.5">
                    {rows.map((r) => (
                      <p key={r.label} className="text-[11px] text-zinc-500">
                        {r.label}: <span className="text-zinc-300">{r.value}</span>
                      </p>
                    ))}
                  </div>
                </div>
              );
            })()}
            {(() => {
              const m = lead.metadata ?? {};
              if (!m.webCameFrom && !m.webUtmCampaign && !m.webFbclid) return null;
              const rows: { label: string; value?: string }[] = [
                { label: 'Vino de',  value: m.webCameFrom || (m.webFbclid ? 'Meta (Facebook/Instagram)' : m.webUtmSource) },
                { label: 'Campaña',  value: m.webUtmCampaign },
                { label: 'Anuncio',  value: m.webUtmContent },
              ].filter((r) => r.value);
              if (rows.length === 0) return null;
              return (
                <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-sky-300/80">Origen del tráfico</p>
                  <div className="space-y-0.5">
                    {rows.map((r) => (
                      <p key={r.label} className="text-[11px] text-zinc-500">
                        {r.label}: <span className="text-zinc-300">{r.value}</span>
                      </p>
                    ))}
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

            {canReassign && (
              <div>
                <label className="mb-1.5 block text-xs text-zinc-400">Teléfono</label>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+573001234567"
                  inputMode="tel"
                  className={fieldClass}
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs text-zinc-400">Estado comercial</label>
              <select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)} className={fieldClass}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {suggestion && (
                <div className="mt-2 rounded-md border border-violet-500/30 bg-violet-500/[0.07] px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-violet-200">
                    <Sparkles size={12} className="shrink-0" />
                    La IA sugiere: <span className="font-semibold">{suggestion.label}</span>
                  </p>
                  {lead.aiAnalysis?.suggestedStatusReason && (
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{lead.aiAnalysis.suggestedStatusReason}</p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApplySuggestion}
                      disabled={applyingSuggestion}
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-50"
                    >
                      {applyingSuggestion ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Aplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestionDismissed(true)}
                      disabled={applyingSuggestion}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canReassign && (
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
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <StickyNote size={12} /> Notas y recordatorios
            </p>
            <LeadNotesPanel companyId={companyId} leadId={lead.id} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <FileSearch size={12} /> SmartHome
            </p>
            <SmartHomeActionsPanel companyId={companyId} lead={lead} canAdmin={canReassign} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <Sparkles size={12} /> Radiografía IA
            </p>
            <LeadAnalysisCard lead={lead} companyId={companyId} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <FileSearch size={12} /> Radiografía CRM + SmartHome
            </p>
            <LeadDossierCard lead={lead} companyId={companyId} />
          </section>

          <section className="border-t border-zinc-800 px-5 py-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
              <PhoneCall size={12} /> Llamadas con IA
            </p>
            <CallHistory calls={calls} loading={callsLoading} />
          </section>
        </div>

        <footer className="border-t border-zinc-800 bg-zinc-900 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <Button onClick={handleSave} disabled={!isDirty || saving} loading={saving} className="w-full">
            <Save size={15} /> {saved ? 'Cambios guardados' : 'Guardar cambios'}
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
