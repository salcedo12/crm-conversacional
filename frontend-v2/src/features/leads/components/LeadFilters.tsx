import type { LeadsFilters } from '../hooks/useLeadsPage';
import type { LeadStatus }   from '@/features/inbox/types';

interface LeadFiltersProps {
  filters:    LeadsFilters;
  total:      number;
  filtered:   number;
  onChange:   (f: Partial<LeadsFilters>) => void;
}

const STATUS_OPTIONS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'Todos'      },
  { value: 'new',       label: 'Nuevo'      },
  { value: 'active',    label: 'Activo'     },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado'   },
  { value: 'lost',      label: 'Perdido'    },
  { value: 'closed',    label: 'Cerrado'    },
];

const AI_OPTIONS = [
  { value: 'all',    label: 'IA: todos'   },
  { value: 'active', label: 'IA activa'   },
  { value: 'manual', label: 'Modo manual' },
] as const;

export function LeadFilters({ filters, total, filtered, onChange }: LeadFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-950">
      {/* Search */}
      <input
        type="text"
        placeholder="Buscar por nombre, teléfono o etiqueta..."
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="
          w-64 rounded-lg bg-zinc-800 border border-zinc-700
          px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500
          focus:outline-none focus:border-violet-500/50 transition-colors
        "
      />

      {/* Status filter */}
      <select
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as LeadStatus | 'all' })}
        className="
          rounded-lg bg-zinc-800 border border-zinc-700
          px-3 py-2 text-xs text-zinc-200
          focus:outline-none focus:border-violet-500/50 transition-colors
        "
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* AI filter */}
      <select
        value={filters.aiEnabled}
        onChange={(e) => onChange({ aiEnabled: e.target.value as LeadsFilters['aiEnabled'] })}
        className="
          rounded-lg bg-zinc-800 border border-zinc-700
          px-3 py-2 text-xs text-zinc-200
          focus:outline-none focus:border-violet-500/50 transition-colors
        "
      >
        {AI_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Reset */}
      {(filters.search || filters.status !== 'all' || filters.aiEnabled !== 'all') && (
        <button
          onClick={() => onChange({ search: '', status: 'all', aiEnabled: 'all' })}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ✕ Limpiar
        </button>
      )}

      {/* Counter */}
      <span className="ml-auto text-xs text-zinc-500">
        {filtered === total
          ? `${total} leads`
          : `${filtered} de ${total}`}
      </span>
    </div>
  );
}
