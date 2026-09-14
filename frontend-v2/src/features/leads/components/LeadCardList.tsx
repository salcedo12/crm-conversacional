import { ChevronRight, Search, UserRound } from 'lucide-react';
import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone } from '@/shared/utils/formatPhone';
import { AiStatusBadge } from '@/features/inbox/components/AiStatusBadge';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadSourceBadge } from './LeadSourceBadge';
import { LeadScoreBadge } from './LeadScoreBadge';
import type { Lead } from '@/features/inbox/types';
import type { Advisor } from '../services/advisors.service';

interface LeadCardListProps {
  leads: Lead[];
  selectedId: string | null;
  advisors: Advisor[];
  onSelect: (id: string) => void;
}

/**
 * Vista de tarjetas de leads para móvil. Reemplaza a la tabla ancha (LeadTable)
 * en pantallas pequeñas, donde una tabla de 1320px obligaría a scroll horizontal.
 */
export function LeadCardList({ leads, selectedId, advisors, onSelect }: LeadCardListProps) {
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
    <div className="flex-1 overflow-auto overscroll-contain divide-y divide-zinc-800/60">
      {leads.map((lead) => {
        const isSelected = lead.id === selectedId;
        const name = lead.name ?? formatPhone(lead.phone);
        const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
        const advisor = lead.assignedTo ? advisorById.get(lead.assignedTo) : undefined;

        return (
          <button
            key={lead.id}
            type="button"
            onClick={() => onSelect(lead.id)}
            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-zinc-900 ${isSelected ? 'bg-zinc-900 shadow-[inset_2px_0_0_#8b5cf6]' : 'hover:bg-zinc-900/60'}`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-300">
              {initials || <UserRound size={15} />}
            </div>

            <div className="min-w-0 flex-1">
              {/* Nombre + hora */}
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-zinc-100">{name}</p>
                {lead.lastMessageAt && (
                  <span className="shrink-0 text-[10px] text-zinc-500">{formatMessageTime(lead.lastMessageAt)}</span>
                )}
              </div>

              <p className="mt-0.5 text-[11px] text-zinc-500">{formatPhone(lead.phone)}</p>

              {/* Último mensaje */}
              <p className="mt-1 truncate text-xs text-zinc-400">
                {lead.lastMessageText ?? <span className="italic text-zinc-600">Sin mensajes</span>}
              </p>

              {/* Badges */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <LeadStatusBadge status={lead.status} />
                <LeadSourceBadge source={lead.source} />
                <LeadScoreBadge score={lead.aiAnalysis?.score} temperature={lead.aiAnalysis?.temperature} />
                <AiStatusBadge aiEnabled={lead.aiEnabled} />
              </div>

              {/* Asesor */}
              <p className={`mt-1.5 text-[11px] ${advisor ? 'text-zinc-400' : 'text-zinc-600'}`}>
                {advisor ? `Asesor: ${advisor.displayName}` : 'Sin asignar'}
              </p>
            </div>

            <ChevronRight size={16} className="mt-1 shrink-0 text-zinc-600" />
          </button>
        );
      })}
    </div>
  );
}
