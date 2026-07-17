import { useState, useMemo } from 'react';
import { Spinner }       from '@/shared/components/Spinner';
import { EmptyState }    from '@/shared/components/EmptyState';
import { LeadListItem }  from './LeadListItem';
import { collectInboxes, inboxLabel } from '../utils/inboxes';
import type { Lead }     from '../types';

interface LeadListProps {
  leads:       Lead[];
  loading:     boolean;
  selectedId:  string | null;
  onSelect:    (id: string) => void;
}

export function LeadList({ leads, loading, selectedId, onSelect }: LeadListProps) {
  const [search, setSearch]   = useState('');
  const [inbox,  setInbox]    = useState<string>('all'); // 'all' | inboxId

  const inboxes = useMemo(() => collectInboxes(leads), [leads]);

  const filtered = leads.filter((l) => {
    // Filtro por número (inbox)
    if (inbox !== 'all' && l.inboxId !== inbox) return false;
    // Búsqueda
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        l.name?.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.lastMessageText?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full border-r border-zinc-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-100 mb-2">
          Bandeja de Entrada
          {!loading && (
            <span className="ml-2 text-xs text-zinc-500 font-normal">
              ({leads.length})
            </span>
          )}
        </h2>

        {/* Selector de número (solo si hay 2+ números/inboxes) */}
        {inboxes.length > 1 && (
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              onClick={() => setInbox('all')}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                ${inbox === 'all'
                  ? 'bg-violet-600/25 text-violet-200 border-violet-500/40'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
            >
              Todos
            </button>
            {inboxes.map((ib) => (
              <button
                key={ib.id}
                onClick={() => setInbox(ib.id)}
                title={ib.id}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                  ${inbox === ib.id
                    ? 'bg-violet-600/25 text-violet-200 border-violet-500/40'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
              >
                {inboxLabel(ib.id)} ({ib.count})
              </button>
            ))}
          </div>
        )}

        {/* Buscador */}
        <input
          type="text"
          placeholder="Buscar lead..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="
            w-full rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-200
            placeholder-zinc-500 border border-zinc-700
            focus:outline-none focus:border-violet-500/50
          "
        />
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <EmptyState
            icon="💬"
            title={search ? 'Sin resultados' : 'Sin leads aún'}
            subtitle={
              search
                ? 'Prueba con otro término de búsqueda'
                : 'Los mensajes de WhatsApp aparecerán aquí'
            }
          />
        )}

        {filtered.map((lead) => (
          <LeadListItem
            key={lead.id}
            lead={lead}
            isSelected={lead.id === selectedId}
            onClick={() => onSelect(lead.id)}
          />
        ))}
      </div>
    </div>
  );
}
