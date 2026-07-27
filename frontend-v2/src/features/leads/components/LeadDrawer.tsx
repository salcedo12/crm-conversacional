import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CalendarDays, CalendarPlus, Clock3, MessageCircle, Pause, Phone, PhoneCall, PhoneOutgoing, Play, Save, Sparkles, Tags, UserRound, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadSourceBadge } from './LeadSourceBadge';
import { AiStatusBadge } from '@/features/inbox/components/AiStatusBadge';
import { CallHistory } from './CallHistory';
import { LeadAnalysisCard } from './LeadAnalysisCard';
import { BookAppointmentModal } from './BookAppointmentModal';
import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone } from '@/shared/utils/formatPhone';
import { updateLead } from '../services/leads.service';
import { reassignLead, type Advisor } from '../services/advisors.service';
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
  { value: 'closed', label: 'Cerrado' },
];

const fieldClass = 'h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500/60';

export function LeadDrawer({ lead, companyId, allTags = [], advisors, onClose }: LeadDrawerProps) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const canReassign = isAdminRole(role);

  const [name, setName] = useState(lead.name ?? '');
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [tagInput, setTagInput] = useState(lead.tags?.join(', ') ?? '');
  const [metadata, setMetadata] = useState<Record<string, string>>(lead.metadata ?? {});
  const [assignedTo, setAssignedTo] = useState(lead.assignedTo ?? '');
  const [customFields, setCustomFields] = useState<ContactField[]>([]);
  const [showAppointment, setShowAppointment] = useState(false);
  const [saving, setSaving] = useState(false);
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
    setStatus(lead.status);
    setTagInput(lead.tags?.join(', ') ?? '');
    setMetadata(lead.metadata ?? {});
    setAssignedTo(lead.assignedTo ?? '');
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
  const isDirty = name.trim() !== (lead.name ?? '')
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
      await updateLead({ companyId, leadId: lead.id, name: name.trim() || undefined, status, tags: currentTags, metadata });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      console.error('[LeadDrawer] save error:', saveError);
      setError('No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
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
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />

      <aside
        className="relative z-50 flex h-full w-full max-w-[420px] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-zinc-800 px-5 py-4">
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
            {lead.sourceMeta?.headline && (
              <p className="mt-3 text-[11px] text-zinc-500">Anuncio: <span className="text-zinc-300">{lead.sourceMeta.headline}</span></p>
            )}
          </section>

          <section className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-3 text-[10px] font-semibold uppercase text-zinc-500">Datos del contacto</p>
              <label className="mb-1.5 block text-xs text-zinc-400">Nombre</label>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={formatPhone(lead.phone)} className={fieldClass} />
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-zinc-400">Estado comercial</label>
              <select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)} className={fieldClass}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>

            {canReassign && (
              <div>
                <label className="mb-1.5 block text-xs text-zinc-400">Asesor asignado</label>
                <select value={assignedTo} onChange={(event) => handleReassign(event.target.value)} disabled={reassigning} className={`${fieldClass} disabled:opacity-50`}>
                  <option value="">Sin asignar</option>
                  {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.displayName}{advisor.googleConnected ? ' - Calendar' : ''}</option>)}
                </select>
                {reassigning && <p className="mt-1 text-[10px] text-zinc-500">Actualizando asignación...</p>}
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

        <footer className="border-t border-zinc-800 bg-zinc-900 px-5 py-4">
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
