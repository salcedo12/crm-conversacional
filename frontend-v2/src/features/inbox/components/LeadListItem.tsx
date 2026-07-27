import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone }        from '@/shared/utils/formatPhone';
import { AiStatusBadge }      from './AiStatusBadge';
import { channelBadge }       from '../utils/inboxes';
import type { Lead }          from '../types';

interface LeadListItemProps {
  lead:       Lead;
  isSelected: boolean;
  isUnread:   boolean;
  onClick:    () => void;
}

export function LeadListItem({ lead, isSelected, isUnread, onClick }: LeadListItemProps) {
  const displayName = lead.name ?? formatPhone(lead.phone);
  const preview     = lead.lastMessageText ?? '—';
  const time        = formatMessageTime(lead.lastMessageAt);
  const badge       = channelBadge(lead.channel);

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3 transition-colors border-b border-zinc-800/60
        hover:bg-zinc-800/50 focus:outline-none
        ${isSelected ? 'bg-zinc-800 border-l-2 border-l-violet-500' : ''}
        ${isUnread && !isSelected ? 'bg-violet-500/[0.04]' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-sm truncate flex-1 ${isUnread ? 'font-semibold text-white' : 'font-medium text-zinc-100'}`}>
          {displayName}
        </span>
        {time && (
          <span className={`text-[10px] shrink-0 ${isUnread ? 'font-medium text-violet-300' : 'text-zinc-500'}`}>{time}</span>
        )}
      </div>

      <div className="mb-1.5 flex items-center gap-2">
        {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-violet-400" aria-label="Sin leer" />}
        <p className={`truncate text-xs ${isUnread ? 'font-medium text-zinc-200' : 'text-zinc-400'}`}>{preview}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <AiStatusBadge aiEnabled={lead.aiEnabled} />
        {badge && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700"
            title={badge.label}
          >
            {badge.icon} {badge.label}
          </span>
        )}
      </div>
    </button>
  );
}
