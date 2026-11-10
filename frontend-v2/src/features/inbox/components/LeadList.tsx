import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Archive, ArrowLeft, CheckCheck, Clock, Tag, UserPlus, UsersRound, X } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { LeadListItem, parseFollowUpMillis } from './LeadListItem';
import { getManualTakeoverSlaInfo } from '../utils/manualTakeoverSla';
import { sourceLabel } from '../utils/inboxes';
import { countUnreadLeads, isLeadUnreadForUser } from '../utils/readState';
import type { Advisor } from '@/features/leads/services/advisors.service';
import type { Lead } from '../types';

/**
 * "Sin primer contacto del asesor": el cliente escribió (hay entrante) pero
 * ningún asesor humano ha respondido todavía (`lastAdvisorMessageAt` ausente).
 * Es la misma señal que usa la reasignación automática por primer contacto.
 */
function hasNoFirstContact(lead: Lead): boolean {
  return !!lead.lastInboundAt && !lead.lastAdvisorMessageAt;
}

/**
 * Lead descartado: Perdido o etapa "No interesado / Cancelado". Sale de la
 * bandeja principal y queda en la sección "Perdidos / No interesados".
 */
export function isDiscardedLead(lead: Lead): boolean {
  if (lead.isArchived) return true;
  if (lead.status === 'lost') return true;
  const stage = lead.pipelineStage ?? '';
  return stage.startsWith('no_interesado') || stage === 'cancelado';
}

/**
 * Lead sin conversación: nunca escribió ni se le escribió por WhatsApp
 * (p. ej. registro manual de trabajo de campo). Guardar la Ficha/bitácora
 * actualiza `lastMessageAt` y lo subía a la bandeja aunque no hubiera chat.
 */
export function hasNoConversation(lead: Lead): boolean {
  return !lead.lastInboundAt && !lead.lastMessageText?.trim();
}

function isFollowUpTodayOrOverdue(lead: Lead): boolean {
  const ms = parseFollowUpMillis(lead.nextFollowUpDate);
  if (ms === null) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  // Considera seguimientos programados para hoy (los residuos anteriores a hoy quedan ignorados).
  return ms >= startOfToday.getTime() && ms <= endOfToday.getTime();
}

interface LeadListProps {
  leads: Lead[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewContact?: () => void;
  onMarkAllRead?: () => void;
  advisors?: Advisor[];
  search: string;
  onSearchChange: (value: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function LeadList({
  leads,
  loading,
  selectedId,
  onSelect,
  onNewContact,
  onMarkAllRead,
  advisors = [],
  search,
  onSearchChange,
  hasMore = false,
  onLoadMore,
}: LeadListProps) {
  const [inbox, setInbox] = useState<string>('all');
  const [advisorFilterOpen, setAdvisorFilterOpen] = useState(false);
  const [selectedAdvisors, setSelectedAdvisors] = useState<string[]>([]);
  const advisorFilterRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<string>('all');
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const sourceFilterRef = useRef<HTMLDivElement | null>(null);
  const [noFirstContact, setNoFirstContact] = useState(false);
  const [dueFollowUpsOnly, setDueFollowUpsOnly] = useState(false);
  const [manualTakeoverOnly, setManualTakeoverOnly] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const { user } = useAuth();

  // Un descartado que vuelve a escribir (mensaje sin leer) se queda en la
  // bandeja principal para que nadie pierda la reactivación.
  const discardedIds = useMemo(
    () => new Set(
      leads
        .filter((lead) => isDiscardedLead(lead) && !isLeadUnreadForUser(lead, user?.uid))
        .map((lead) => lead.id)
    ),
    [leads, user?.uid]
  );
  const discardedCount = useMemo(
    () => leads.filter((lead) => discardedIds.has(lead.id) && !hasNoConversation(lead)).length,
    [leads, discardedIds]
  );
  // Leads de la sección visible (activos o descartados). Los contadores de los
  // filtros rápidos se calculan sobre esta sección, no sobre todo lo cargado.
  const sectionLeads = useMemo(
    () => leads.filter((lead) => discardedIds.has(lead.id) === showDiscarded),
    [leads, discardedIds, showDiscarded]
  );
  const sectionConversations = useMemo(
    () => sectionLeads.filter((lead) => !hasNoConversation(lead)),
    [sectionLeads]
  );

  // Fuentes presentes en los leads cargados, con su conteo, para el filtro.
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (lead.source) counts.set(lead.source, (counts.get(lead.source) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: sourceLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [leads]);

  const noFirstContactCount = useMemo(
    () => sectionConversations.filter(hasNoFirstContact).length,
    [sectionConversations]
  );
  const dueFollowUpsCount = useMemo(
    () => sectionLeads.filter(isFollowUpTodayOrOverdue).length,
    [sectionLeads]
  );
  const manualTakeoverStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let overdue = 0;
    for (const lead of sectionConversations) {
      const info = getManualTakeoverSlaInfo(lead);
      if (info) {
        total++;
        if (info.isOverdue) overdue++;
        else if (!info.isCompliant) pending++;
      }
    }
    return { total, pending, overdue, actionable: pending + overdue };
  }, [sectionConversations]);
  const unreadCount = useMemo(() => countUnreadLeads(leads, user?.uid), [leads, user?.uid]);
  const advisorCount = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (lead.assignedTo) counts.set(lead.assignedTo, (counts.get(lead.assignedTo) ?? 0) + 1);
    });
    return counts;
  }, [leads]);

  const advisorOptions = useMemo(
    () => advisors
      .filter((advisor) => advisor.active && advisorCount.has(advisor.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [advisors, advisorCount]
  );

  const selectedAdvisorNames = useMemo(
    () => selectedAdvisors
      .map((id) => advisors.find((advisor) => advisor.id === id)?.displayName)
      .filter(Boolean) as string[],
    [advisors, selectedAdvisors]
  );

  const filtered = useMemo(() => {
    const searching = !!search.trim();
    const base = leads.filter((lead) => {
      // Si está activo el filtro de seguimientos para hoy/vencidos, mostrar incluso los prospectos outbound sin chat previo
      if (!dueFollowUpsOnly && (lead.lastMessageText === 'Prospecto outbound agregado manualmente' || lead.lastMessageText === 'Contacto importado')) {
        return false;
      }
      // Registros manuales sin chat (trabajo de campo): no son conversaciones.
      // Siguen visibles en seguimientos de hoy y al buscarlos por nombre/teléfono.
      if (!dueFollowUpsOnly && !searching && hasNoConversation(lead)) {
        return false;
      }
      // Bandeja principal = solo activos; los descartados viven en su sección.
      // Al buscar se muestran todos para poder encontrarlos.
      // El lead abierto no salta de lista al leerlo (se reubica al cambiar de chat).
      const keepOpenLead = !showDiscarded && lead.id === selectedId;
      if (!searching && !keepOpenLead && discardedIds.has(lead.id) !== showDiscarded) return false;

      if (inbox !== 'all') {
        const isAdvisorDirect =
          lead.inbox === 'advisor_direct' ||
          lead.source === 'advisor_whatsapp' ||
          lead.metadata?.advisorWhatsappMirror === 'true' ||
          (!lead.inboxId && (
            lead.id.startsWith('sm_') ||
            lead.tags?.includes('smarthome_migracion') ||
            Boolean(lead.metadata?.migratedFrom) ||
            lead.source === 'manual'
          ));
        if (inbox === 'central_317') {
          if (isAdvisorDirect) {
            return false;
          }
        } else if (inbox === 'advisor_direct') {
          if (!isAdvisorDirect) return false;
        } else if (lead.inboxId !== inbox) {
          return false;
        }
      }
      if (selectedAdvisors.length > 0 && (!lead.assignedTo || !selectedAdvisors.includes(lead.assignedTo))) return false;
      if (source !== 'all' && lead.source !== source) return false;
      if (noFirstContact && !hasNoFirstContact(lead)) return false;
      if (dueFollowUpsOnly && !isFollowUpTodayOrOverdue(lead)) return false;
      if (manualTakeoverOnly && lead.aiEnabled) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          lead.name?.toLowerCase().includes(q) ||
          lead.phone.includes(q) ||
          lead.lastMessageText?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (dueFollowUpsOnly) {
      return [...base].sort((a, b) => {
        const ma = parseFollowUpMillis(a.nextFollowUpDate) ?? Number.MAX_SAFE_INTEGER;
        const mb = parseFollowUpMillis(b.nextFollowUpDate) ?? Number.MAX_SAFE_INTEGER;
        return ma - mb;
      });
    }

    if (manualTakeoverOnly) {
      return [...base].sort((a, b) => {
        const infoA = getManualTakeoverSlaInfo(a);
        const infoB = getManualTakeoverSlaInfo(b);
        // 1. Vencidos primero
        if (infoA?.isOverdue && !infoB?.isOverdue) return -1;
        if (!infoA?.isOverdue && infoB?.isOverdue) return 1;
        // 2. Pendientes con menos tiempo restante primero
        if (infoA && infoB && !infoA.isCompliant && !infoB.isCompliant) {
          return infoA.deadlineMillis - infoB.deadlineMillis;
        }
        // 3. Pendientes antes que compliant
        if (!infoA?.isCompliant && infoB?.isCompliant) return -1;
        if (infoA?.isCompliant && !infoB?.isCompliant) return 1;
        return 0;
      });
    }

    return base;
  }, [leads, inbox, selectedAdvisors, source, noFirstContact, dueFollowUpsOnly, manualTakeoverOnly, search, discardedIds, showDiscarded, selectedId]);

  const toggleAdvisor = (advisorId: string) => {
    setSelectedAdvisors((current) =>
      current.includes(advisorId)
        ? current.filter((id) => id !== advisorId)
        : [...current, advisorId]
    );
    setAdvisorFilterOpen(false);
  };

  useEffect(() => {
    if (!advisorFilterOpen && !sourceFilterOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!advisorFilterRef.current?.contains(event.target as Node)) setAdvisorFilterOpen(false);
      if (!sourceFilterRef.current?.contains(event.target as Node)) setSourceFilterOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAdvisorFilterOpen(false); setSourceFilterOpen(false); }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [advisorFilterOpen, sourceFilterOpen]);

  const anyFilterActive = !!search || selectedAdvisors.length > 0 || source !== 'all' || noFirstContact || dueFollowUpsOnly || manualTakeoverOnly;
  const emptyTitle = dueFollowUpsOnly
    ? '¡Al día! Cero seguimientos pendientes hoy'
    : manualTakeoverOnly
    ? '¡Excelente! Cero prospectos en toma manual'
    : anyFilterActive
    ? 'Sin resultados'
    : showDiscarded
    ? 'Sin perdidos ni descartados'
    : 'Sin leads aun';
  const emptySubtitle = dueFollowUpsOnly
    ? 'Todos tus recordatorios y seguimientos de hoy han sido evacuados.'
    : manualTakeoverOnly
    ? 'No tienes prospectos con la IA apagada pendientes de Ficha Técnica.'
    : anyFilterActive
    ? 'Prueba con otro filtro o busqueda'
    : 'Los mensajes de WhatsApp apareceran aqui';

  return (
    <div className="flex h-full flex-col border-r border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            {showDiscarded ? 'Perdidos / No interesados' : 'Bandeja de Entrada'}
            {!loading && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({filtered.length})
              </span>
            )}
            {!loading && unreadCount > 0 && (
              <span className="ml-2 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                {unreadCount} sin leer
              </span>
            )}
          </h2>
          {onNewContact && (
            <button
              onClick={onNewContact}
              title="Nuevo contacto"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-600/15 px-2 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-600/25"
            >
              <UserPlus size={13} /> Nuevo
            </button>
          )}
        </div>

        {onMarkAllRead && !loading && unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="mb-2 flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-violet-300"
          >
            <CheckCheck size={13} /> Marcar todo como leido
          </button>
        )}

        <div className="mb-2 flex flex-wrap gap-1">
          <button
            onClick={() => setInbox('all')}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              inbox === 'all'
                ? 'border-violet-500/40 bg-violet-600/25 text-violet-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Todos ({sectionConversations.length})
          </button>
          <button
            onClick={() => setInbox('central_317')}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              inbox === 'central_317'
                ? 'border-emerald-500/40 bg-emerald-600/25 text-emerald-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🏢 Línea 317
          </button>
          <button
            onClick={() => setInbox('advisor_direct')}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              inbox === 'advisor_direct'
                ? 'border-sky-500/40 bg-sky-600/25 text-sky-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            👤 Asesores Directo
          </button>
        </div>

        {/* Sección aparte: Perdidos / No interesados. No salen en la bandeja principal. */}
        {(discardedCount > 0 || showDiscarded) && (
          <button
            onClick={() => setShowDiscarded((v) => !v)}
            title={showDiscarded
              ? 'Volver a la bandeja de leads activos'
              : 'Ver los leads marcados como Perdido / No interesado (no salen en la bandeja principal)'}
            className={`mb-2 flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
              showDiscarded
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {showDiscarded ? <ArrowLeft size={13} /> : <Archive size={13} />}
              <span className="truncate">
                {showDiscarded ? 'Volver a activos' : 'Perdidos / No interesados'}
              </span>
            </span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${showDiscarded ? 'bg-red-500/20 text-red-200' : 'bg-zinc-700 text-zinc-400'}`}>
              {discardedCount}
            </span>
          </button>
        )}

        {advisorOptions.length > 1 && (
          <div ref={advisorFilterRef} className="relative mb-2">
            <button
              onClick={() => setAdvisorFilterOpen((open) => !open)}
              className={`flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs transition-colors ${
                selectedAdvisors.length > 0
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <UsersRound size={13} />
                <span className="truncate">
                  {selectedAdvisors.length === 0
                    ? 'Filtrar por asesor'
                    : selectedAdvisors.length === 1
                      ? selectedAdvisorNames[0]
                      : `${selectedAdvisors.length} asesores`}
                </span>
              </span>
              {selectedAdvisors.length > 0 && (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedAdvisors([]);
                    setAdvisorFilterOpen(false);
                  }}
                  title="Quitar filtro"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sky-300 hover:bg-sky-500/15"
                >
                  <X size={12} />
                </span>
              )}
            </button>

            {advisorFilterOpen && (
              <div className="absolute left-0 right-0 top-9 z-20 max-h-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
                {advisorOptions.map((advisor) => (
                  <label
                    key={advisor.id}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAdvisors.includes(advisor.id)}
                        onChange={() => toggleAdvisor(advisor.id)}
                        className="accent-sky-500"
                      />
                      <span className="truncate">{advisor.displayName}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">{advisorCount.get(advisor.id) ?? 0}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filtro por fuente de origen (auditoría). */}
        {sourceOptions.length > 1 && (
          <div ref={sourceFilterRef} className="relative mb-2">
            <button
              onClick={() => setSourceFilterOpen((open) => !open)}
              className={`flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs transition-colors ${
                source !== 'all'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Tag size={13} />
                <span className="truncate">
                  {source === 'all' ? 'Filtrar por fuente' : sourceLabel(source)}
                </span>
              </span>
              {source !== 'all' && (
                <span
                  onClick={(event) => { event.stopPropagation(); setSource('all'); setSourceFilterOpen(false); }}
                  title="Quitar filtro"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-300 hover:bg-amber-500/15"
                >
                  <X size={12} />
                </span>
              )}
            </button>

            {sourceFilterOpen && (
              <div className="absolute left-0 right-0 top-9 z-20 max-h-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
                <button
                  onClick={() => { setSource('all'); setSourceFilterOpen(false); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-800 ${source === 'all' ? 'text-amber-200' : 'text-zinc-300'}`}
                >
                  <span>Todas las fuentes</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">{leads.length}</span>
                </button>
                {sourceOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSource(opt.value); setSourceFilterOpen(false); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-800 ${source === opt.value ? 'text-amber-200' : 'text-zinc-300'}`}
                  >
                    <span className="truncate">{opt.label}</span>
                    <span className="shrink-0 text-[10px] text-zinc-500">{opt.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filtro rápido: Seguimientos para Hoy / Vencidos ordenados por hora */}
        <button
          onClick={() => {
            setDueFollowUpsOnly((v) => {
              const next = !v;
              if (next) setManualTakeoverOnly(false);
              return next;
            });
          }}
          title="Ver tus seguimientos y llamadas programadas para hoy o vencidas, ordenadas por hora"
          className={`mb-2 flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
            dueFollowUpsOnly
              ? 'border-amber-500/50 bg-amber-500/15 text-amber-200 shadow-sm'
              : dueFollowUpsCount > 0
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
              : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <AlarmClock size={13} className={dueFollowUpsCount > 0 ? 'text-amber-400' : ''} />
            <span className="truncate">⏰ Seguimientos para Hoy / Vencidos</span>
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              dueFollowUpsOnly
                ? 'bg-amber-500/30 text-amber-100'
                : dueFollowUpsCount > 0
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            {dueFollowUpsCount}
          </span>
        </button>

        {/* Filtro rápido: En Toma Manual / SLA 24h */}
        {manualTakeoverStats.total > 0 && (
          <button
            onClick={() => {
              setManualTakeoverOnly((v) => {
                const next = !v;
                if (next) {
                  setDueFollowUpsOnly(false);
                  setNoFirstContact(false);
                }
                return next;
              });
            }}
            title="Ver prospectos con atención manual activa (IA apagada) ordenados por urgencia del SLA de 24h"
            className={`mb-2 flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
              manualTakeoverOnly
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200 shadow-sm'
                : manualTakeoverStats.overdue > 0
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15'
                : manualTakeoverStats.actionable > 0
                ? 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Clock
                size={13}
                className={
                  manualTakeoverStats.overdue > 0
                    ? 'text-rose-400 animate-pulse'
                    : manualTakeoverStats.actionable > 0
                    ? 'text-amber-400'
                    : ''
                }
              />
              <span className="truncate">⏳ En Toma Manual / SLA 24h</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {manualTakeoverStats.overdue > 0 && (
                <span
                  title={`${manualTakeoverStats.overdue} con SLA 24h vencido`}
                  className="rounded-full bg-rose-500/25 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-bold text-rose-200"
                >
                  {manualTakeoverStats.overdue} vencidos
                </span>
              )}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  manualTakeoverOnly
                    ? 'bg-amber-500/30 text-amber-100'
                    : manualTakeoverStats.actionable > 0
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-zinc-700 text-zinc-400'
                }`}
              >
                {manualTakeoverStats.total}
              </span>
            </div>
          </button>
        )}

        {/* Auditoría: leads a los que el cliente escribió pero ningún asesor respondió. */}
        {noFirstContactCount > 0 && (
          <button
            onClick={() => {
              setNoFirstContact((v) => {
                const next = !v;
                if (next) setManualTakeoverOnly(false);
                return next;
              });
            }}
            title="Clientes que escribieron y aún no reciben respuesta de un asesor"
            className={`mb-2 flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-3 text-xs transition-colors ${
              noFirstContact
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Clock size={13} />
              <span className="truncate">Sin primer contacto del asesor</span>
            </span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${noFirstContact ? 'bg-rose-500/20 text-rose-200' : 'bg-zinc-700 text-zinc-400'}`}>
              {noFirstContactCount}
            </span>
          </button>
        )}

        <input
          type="text"
          placeholder="Buscar lead..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-violet-500/50 focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <EmptyState icon="💬" title={emptyTitle} subtitle={emptySubtitle} />
        )}

        {filtered.map((lead) => (
          <LeadListItem
            key={lead.id}
            lead={lead}
            isSelected={lead.id === selectedId}
            isUnread={isLeadUnreadForUser(lead, user?.uid)}
            onClick={() => onSelect(lead.id)}
          />
        ))}

        {!loading && hasMore && onLoadMore && (
          <button
            onClick={onLoadMore}
            className="w-full py-3 text-xs font-medium text-zinc-400 transition-colors hover:text-violet-300"
          >
            Cargar más leads
          </button>
        )}
      </div>
    </div>
  );
}
