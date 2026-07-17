import { Search, X } from 'lucide-react';
import type { LeadsFilters } from '../hooks/useLeadsPage';
import type { LeadSource, LeadStatus } from '@/features/inbox/types';
import type { Advisor } from '../services/advisors.service';
import { inboxLabel } from '@/features/inbox/utils/inboxes';

interface LeadFiltersProps {
  filters: LeadsFilters;
  total: number;
  filtered: number;
  advisors: Advisor[];
  allTags: string[];
  inboxes: { id: string; count: number }[];
  onChange: (filters: Partial<LeadsFilters>) => void;
}

const STATUS_OPTIONS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'new', label: 'Nuevo' },
  { value: 'active', label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'closed', label: 'Cerrado' },
];

const SOURCE_OPTIONS: { value: LeadSource | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos los orígenes' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'web', label: 'Web' },
  { value: 'manual', label: 'Manual' },
];

const selectClass = 'h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 outline-none transition-colors focus:border-violet-500/60';

export function LeadFilters({ filters, total, filtered, advisors, allTags, inboxes, onChange }: LeadFiltersProps) {
  const hasActiveFilters = Boolean(
    filters.search || filters.status !== 'all' || filters.aiEnabled !== 'all'
    || filters.assignedTo !== 'all' || filters.inboxId !== 'all' || filters.tags.length
    || filters.source !== 'all'
  );

  const reset = () => onChange({
    search: '', status: 'all', aiEnabled: 'all', assignedTo: 'all', tags: [], inboxId: 'all', source: 'all',
  });

  const toggleTag = (tag: string) => onChange({
    tags: filters.tags.includes(tag) ? filters.tags.filter((item) => item !== tag) : [...filters.tags, tag],
  });

  return (
    <div className="flex flex-col gap-2.5 border-b border-zinc-800 bg-zinc-950 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1 md:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder="Buscar nombre, teléfono, mensaje o etiqueta"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
            className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 pl-9 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/60"
          />
        </div>

        <select value={filters.status} onChange={(event) => onChange({ status: event.target.value as LeadStatus | 'all' })} className={selectClass}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>

        <select value={filters.source} onChange={(event) => onChange({ source: event.target.value as LeadSource | 'all' })} className={selectClass}>
          {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>

        <select value={filters.assignedTo} onChange={(event) => onChange({ assignedTo: event.target.value })} className={selectClass}>
          <option value="all">Todos los asesores</option>
          <option value="unassigned">Sin asignar</option>
          {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>{advisor.displayName}</option>)}
        </select>

        {inboxes.length > 1 && (
          <select value={filters.inboxId} onChange={(event) => onChange({ inboxId: event.target.value })} className={selectClass}>
            <option value="all">Todos los números</option>
            {inboxes.map((inbox) => <option key={inbox.id} value={inbox.id}>{inboxLabel(inbox.id)} ({inbox.count})</option>)}
          </select>
        )}

        <select value={filters.aiEnabled} onChange={(event) => onChange({ aiEnabled: event.target.value as LeadsFilters['aiEnabled'] })} className={selectClass}>
          <option value="all">IA y manual</option>
          <option value="active">IA activa</option>
          <option value="manual">Modo manual</option>
        </select>

        {hasActiveFilters && (
          <button onClick={reset} className="inline-flex h-9 items-center gap-1.5 px-2 text-xs text-zinc-500 hover:text-zinc-200">
            <X size={14} /> Limpiar
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-zinc-500">
          {filtered === total ? `${total} contactos` : `${filtered} de ${total}`}
        </span>
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="shrink-0 text-[10px] font-medium uppercase text-zinc-600">Etiquetas</span>
          {allTags.map((tag) => {
            const active = filters.tags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${active ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'}`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
