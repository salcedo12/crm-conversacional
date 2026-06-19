import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone }        from '@/shared/utils/formatPhone';
import { AiStatusBadge }      from './AiStatusBadge';
import type { Lead }          from '../types';

interface LeadListItemProps {
  lead:       Lead;
  isSelected: boolean;
  onClick:    () => void;
}

export function LeadListItem({ lead, isSelected, onClick }: LeadListItemProps) {
  const displayName = lead.name ?? formatPhone(lead.phone);
  const preview     = lead.lastMessageText ?? '—';
  const time        = formatMessageTime(lead.lastMessageAt);

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3 transition-colors border-b border-zinc-800/60
        hover:bg-zinc-800/50 focus:outline-none
        ${isSelected ? 'bg-zinc-800 border-l-2 border-l-violet-500' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-zinc-100 truncate flex-1">
          {displayName}
        </span>
        {time && (
          <span className="text-[10px] text-zinc-500 shrink-0">{time}</span>
        )}
      </div>

      <p className="text-xs text-zinc-400 truncate mb-1.5">{preview}</p>

      <AiStatusBadge aiEnabled={lead.aiEnabled} />
    </button>
  );
}
