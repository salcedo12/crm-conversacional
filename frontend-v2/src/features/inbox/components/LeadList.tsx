import { useState }      from 'react';
import { Spinner }       from '@/shared/components/Spinner';
import { EmptyState }    from '@/shared/components/EmptyState';
import { LeadListItem }  from './LeadListItem';
import type { Lead }     from '../types';

interface LeadListProps {
  leads:       Lead[];
  loading:     boolean;
  selectedId:  string | null;
  onSelect:    (id: string) => void;
}

export function LeadList({ leads, loading, selectedId, onSelect }: LeadListProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? leads.filter((l) => {
        const q = search.toLowerCase();
        return (
          l.name?.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          l.lastMessageText?.toLowerCase().includes(q)
        );
      })
    : leads;

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
      <div className="flex-1 overflow-y-auto">
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
