import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone }        from '@/shared/utils/formatPhone';
import { AiStatusBadge }     from '@/features/inbox/components/AiStatusBadge';
import { LeadStatusBadge }   from './LeadStatusBadge';
import type { Lead }         from '@/features/inbox/types';
import type { SortField, SortDir } from '../hooks/useLeadsPage';

interface LeadTableProps {
  leads:       Lead[];
  selectedId:  string | null;
  sortField:   SortField;
  sortDir:     SortDir;
  onSort:      (field: SortField) => void;
  onSelect:    (id: string) => void;
}

function SortIcon({ active, dir }: { field?: string; active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-zinc-700 ml-1">↕</span>;
  return <span className="text-violet-400 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function Th({
  label, field, sortField, sortDir, onSort, className = '',
}: {
  label: string; field?: SortField;
  sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-2.5 text-left text-[11px] font-semibold text-zinc-400 uppercase tracking-wider
        ${field ? 'cursor-pointer select-none hover:text-zinc-200 transition-colors' : ''}
        ${className}
      `}
      onClick={() => field && onSort(field)}
    >
      {label}
      {field && <SortIcon field={field} active={sortField === field} dir={sortDir} />}
    </th>
  );
}

export function LeadTable({
  leads, selectedId, sortField, sortDir, onSort, onSelect,
}: LeadTableProps) {
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 py-16">
        <span className="text-3xl">🔍</span>
        <p className="text-sm font-medium text-zinc-300">Sin resultados</p>
        <p className="text-xs text-zinc-500">Prueba cambiando los filtros</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
          <tr>
            <Th label="Lead"          field="name"          sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-56" />
            <Th label="Estado"        field="status"        sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-32" />
            <Th label="IA"                                  sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-28" />
            <Th label="Último mensaje" field="lastMessageAt" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-40" />
            <Th label="Alta"          field="createdAt"     sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-28" />
            <Th label="Etiquetas"                           sortField={sortField} sortDir={sortDir} onSort={onSort} className="" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const isSelected = lead.id === selectedId;
            const name       = lead.name ?? formatPhone(lead.phone);

            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead.id)}
                className={`
                  border-b border-zinc-800/60 cursor-pointer transition-colors
                  hover:bg-zinc-800/50
                  ${isSelected ? 'bg-zinc-800 border-l-2 border-l-violet-500' : ''}
                `}
              >
                {/* Lead */}
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-100 truncate max-w-[200px]">{name}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{lead.phone}</p>
                </td>

                {/* Estado */}
                <td className="px-4 py-3">
                  <LeadStatusBadge status={lead.status} />
                </td>

                {/* IA */}
                <td className="px-4 py-3">
                  <AiStatusBadge aiEnabled={lead.aiEnabled} />
                </td>

                {/* Último mensaje */}
                <td className="px-4 py-3">
                  <p className="text-xs text-zinc-300 truncate max-w-[180px]">
                    {lead.lastMessageText ?? <span className="text-zinc-600 italic">Sin mensajes</span>}
                  </p>
                  {lead.lastMessageAt && (
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {formatMessageTime(lead.lastMessageAt)}
                    </p>
                  )}
                </td>

                {/* Alta */}
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {formatMessageTime(lead.createdAt)}
                </td>

                {/* Etiquetas */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags?.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300"
                      >
                        {tag}
                      </span>
                    ))}
                    {(lead.tags?.length ?? 0) > 3 && (
                      <span className="text-[10px] text-zinc-500">
                        +{lead.tags.length - 3}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
