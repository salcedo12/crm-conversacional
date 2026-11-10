import { formatMessageTime } from '@/shared/utils/date';
import { formatPhone }        from '@/shared/utils/formatPhone';
import { AiStatusBadge }      from './AiStatusBadge';
import { channelBadge, sourceBadge } from '../utils/inboxes';
import { phoneCountry }        from '../utils/phoneCountry';
import { FLAG_URLS }           from '../utils/flagAssets';
import { getManualTakeoverSlaInfo } from '../utils/manualTakeoverSla';
import type { Lead }          from '../types';

export function parseFollowUpMillis(dateStr?: string | null): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const clean = dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
    ? dateStr
    : (dateStr.trim().includes('T') ? dateStr.trim() : dateStr.trim().replace(' ', 'T')) + '-05:00';
  const ms = Date.parse(clean);
  return Number.isNaN(ms) ? null : ms;
}

function formatFollowUpBadge(ms: number): { label: string; isOverdue: boolean; isToday: boolean } {
  const now = new Date();
  const target = new Date(ms);
  const isToday =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  const isOverdue = ms < now.getTime();
  const timeStr = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(target);

  if (isOverdue) {
    if (isToday) return { label: `🚨 Vencido hoy ${timeStr}`, isOverdue: true, isToday: true };
    const dateStr = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(target);
    return { label: `🚨 Vencido ${dateStr} ${timeStr}`, isOverdue: true, isToday: false };
  }
  if (isToday) {
    return { label: `⏰ Hoy ${timeStr}`, isOverdue: false, isToday: true };
  }
  const dateStr = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(target);
  return { label: `📅 ${dateStr} ${timeStr}`, isOverdue: false, isToday: false };
}

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
  const source      = sourceBadge(lead);
  const country     = phoneCountry(lead.phone);
  const followUpMs  = parseFollowUpMillis(lead.nextFollowUpDate);
  const followUp    = followUpMs ? formatFollowUpBadge(followUpMs) : null;
  const manualSla   = getManualTakeoverSlaInfo(lead);

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
          {country && FLAG_URLS[country.iso] && (
            <img
              src={FLAG_URLS[country.iso]}
              alt={country.name}
              title={`Escribe desde: ${country.name}`}
              className="mr-1.5 inline-block h-3 w-4 rounded-[2px] object-cover align-[-1px]"
              loading="lazy"
            />
          )}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <AiStatusBadge aiEnabled={lead.aiEnabled} />
        {manualSla && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium truncate max-w-[190px] ${
              manualSla.isOverdue
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/35 animate-pulse'
                : manualSla.isCompliant
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
            }`}
            title={manualSla.label}
          >
            {manualSla.badgeLabel}
          </span>
        )}
        {followUp && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium truncate max-w-[190px] ${
              followUp.isOverdue
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                : followUp.isToday
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                : 'bg-zinc-800 text-zinc-300 border-zinc-700'
            }`}
            title={lead.nextFollowUpAction ? `${followUp.label} · ${lead.nextFollowUpAction}` : followUp.label}
          >
            {followUp.label}{lead.nextFollowUpAction ? ` · ${lead.nextFollowUpAction}` : ''}
          </span>
        )}
        {source && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700"
            title={source.detail ? `Origen: ${source.label} — ${source.detail}` : `Origen: ${source.label}`}
          >
            {source.icon} {source.label}
          </span>
        )}
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
