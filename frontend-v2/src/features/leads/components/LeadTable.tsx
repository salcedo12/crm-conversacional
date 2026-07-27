import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Search, UserRound } from 'lucide-react';
import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone } from '@/shared/utils/formatPhone';
import { AiStatusBadge } from '@/features/inbox/components/AiStatusBadge';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadSourceBadge } from './LeadSourceBadge';
import { LeadScoreBadge } from './LeadScoreBadge';
import type { Lead } from '@/features/inbox/types';
import type { SortField, SortDir } from '../hooks/useLeadsPage';
import type { Advisor } from '../services/advisors.service';

interface LeadTableProps {
  leads: Lead[];
  selectedId: string | null;
  sortField: SortField;
  sortDir: SortDir;
  advisors: Advisor[];
  onSort: (field: SortField) => void;
  onSelect: (id: string) => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} className="ml-1 text-zinc-700" />;
  return dir === 'asc'
    ? <ArrowUp size={12} className="ml-1 text-violet-400" />
    : <ArrowDown size={12} className="ml-1 text-violet-400" />;
}

function Th({
  label, field, sortField, sortDir, onSort, className = '',
}: {
  label: string;
  field?: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-zinc-500 ${field ? 'cursor-pointer select-none hover:text-zinc-300' : ''} ${className}`}
      onClick={() => field && onSort(field)}
    >
      <span className="inline-flex items-center">
        {label}
        {field && <SortIcon active={sortField === field} dir={sortDir} />}
      </span>
    </th>
  );
}

export function LeadTable({
  leads, selectedId, sortField, sortDir, advisors, onSort, onSelect,
}: LeadTableProps) {
  const advisorById = new Map(advisors.map((advisor) => [advisor.id, advisor]));

  if (leads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
        <Search size={24} className="text-zinc-600" />
        <p className="text-sm font-medium text-zinc-300">Sin resultados</p>
        <p className="text-xs text-zinc-500">Prueba cambiando los filtros</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto overscroll-contain">
      <table className="w-full min-w-[1320px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur">
          <tr>
            <Th label="Contacto" field="name" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-64" />
            <Th label="Score IA" field="score" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-24" />
            <Th label="Estado" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-32" />
            <Th label="Origen" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-28" />
            <Th label="Atención" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-32" />
            <Th label="Asesor" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-40" />
            <Th label="Actividad reciente" field="lastMessageAt" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-64" />
            <Th label="Alta" field="createdAt" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-28" />
            <Th label="Etiquetas" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-52" />
            <Th label="" sortField={sortField} sortDir={sortDir} onSort={onSort} className="w-10" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const isSelected = lead.id === selectedId;
            const name = lead.name ?? formatPhone(lead.phone);
            const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
            const advisor = lead.assignedTo ? advisorById.get(lead.assignedTo) : undefined;

            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead.id)}
                className={`cursor-pointer border-b border-zinc-800/60 transition-colors hover:bg-zinc-900 ${isSelected ? 'bg-zinc-900 shadow-[inset_2px_0_0_#8b5cf6]' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-300">
                      {initials || <UserRound size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-[190px] truncate font-medium text-zinc-100">{name}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">{formatPhone(lead.phone)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <LeadScoreBadge score={lead.aiAnalysis?.score} temperature={lead.aiAnalysis?.temperature} />
                </td>
                <td className="px-4 py-3"><LeadStatusBadge status={lead.status} /></td>
                <td className="px-4 py-3"><LeadSourceBadge source={lead.source} /></td>
                <td className="px-4 py-3"><AiStatusBadge aiEnabled={lead.aiEnabled} /></td>
                <td className="px-4 py-3">
                  <p className={`max-w-[140px] truncate text-xs ${advisor ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    {advisor?.displayName ?? 'Sin asignar'}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="max-w-[240px] truncate text-xs text-zinc-300">
                    {lead.lastMessageText ?? <span className="italic text-zinc-600">Sin mensajes</span>}
                  </p>
                  {lead.lastMessageAt && <p className="mt-0.5 text-[10px] text-zinc-500">{formatMessageTime(lead.lastMessageAt)}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{formatMessageTime(lead.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {lead.tags?.slice(0, 2).map((tag) => (
                      <span key={tag} className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">{tag}</span>
                    ))}
                    {(lead.tags?.length ?? 0) > 2 && <span className="text-[10px] text-zinc-500">+{lead.tags.length - 2}</span>}
                  </div>
                </td>
                <td className="px-2 py-3 text-zinc-600"><ChevronRight size={16} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
