import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Clock, Tag, UserPlus, UsersRound, X } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { LeadListItem } from './LeadListItem';
import { collectInboxes, inboxLabel, sourceLabel } from '../utils/inboxes';
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
  const { user } = useAuth();

  const inboxes = useMemo(() => collectInboxes(leads), [leads]);

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
    () => leads.filter(hasNoFirstContact).length,
    [leads]
  );
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

  const filtered = leads.filter((lead) => {
    if (inbox !== 'all' && lead.inboxId !== inbox) return false;
    if (selectedAdvisors.length > 0 && (!lead.assignedTo || !selectedAdvisors.includes(lead.assignedTo))) return false;
    if (source !== 'all' && lead.source !== source) return false;
    if (noFirstContact && !hasNoFirstContact(lead)) return false;

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

  const anyFilterActive = !!search || selectedAdvisors.length > 0 || source !== 'all' || noFirstContact;
  const emptyTitle = anyFilterActive ? 'Sin resultados' : 'Sin leads aun';
  const emptySubtitle = anyFilterActive
    ? 'Prueba con otro filtro o busqueda'
    : 'Los mensajes de WhatsApp apareceran aqui';

  return (
    <div className="flex h-full flex-col border-r border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            Bandeja de Entrada
            {!loading && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({filtered.length}{filtered.length !== leads.length ? `/${leads.length}` : ''})
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

        {inboxes.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1">
            <button
              onClick={() => setInbox('all')}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                inbox === 'all'
                  ? 'border-violet-500/40 bg-violet-600/25 text-violet-200'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Todos
            </button>
            {inboxes.map((ib) => (
              <button
                key={ib.id}
                onClick={() => setInbox(ib.id)}
                title={ib.id}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  inbox === ib.id
                    ? 'border-violet-500/40 bg-violet-600/25 text-violet-200'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {inboxLabel(ib.id)} ({ib.count})
              </button>
            ))}
          </div>
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

        {/* Auditoría: leads a los que el cliente escribió pero ningún asesor respondió. */}
        {noFirstContactCount > 0 && (
          <button
            onClick={() => setNoFirstContact((v) => !v)}
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
