import { useState } from 'react';
import { ArrowLeft, Bot, ClipboardList, Pause, Play, UserRound } from 'lucide-react';
import { formatPhone } from '@/shared/utils/formatPhone';
import { AiStatusBadge } from './AiStatusBadge';
import { Spinner } from '@/shared/components/Spinner';
import { isWindowOpen, windowTimeLeft, windowClosedAgo } from '../utils/conversationWindow';
import { channelBadge } from '../utils/inboxes';
import type { Lead } from '../types';

interface ConversationHeaderProps {
  lead: Lead;
  onPauseAi: () => Promise<void>;
  onResumeAi: () => Promise<void>;
  onOpenTemplates: () => void;
  onOpenLeadDetails?: () => void;
  onBack?: () => void;
}

export function ConversationHeader({
  lead,
  onPauseAi,
  onResumeAi,
  onOpenTemplates,
  onOpenLeadDetails,
  onBack,
}: ConversationHeaderProps) {
  const [toggling, setToggling] = useState(false);

  const displayName = lead.name ?? formatPhone(lead.phone);
  const badge = channelBadge(lead.channel);
  const isWhatsapp = !lead.channel || lead.channel === 'whatsapp';
  const windowTs = lead.lastInboundAt ?? null;
  const windowOpen = isWindowOpen(windowTs);
  const timeLeft = windowTimeLeft(windowTs);
  const closedAgo = windowClosedAgo(windowTs);

  const handleToggleAi = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (lead.aiEnabled) await onPauseAi();
      else await onResumeAi();
    } catch (err) {
      console.error('[ConversationHeader] toggle AI error:', err);
    } finally {
      setToggling(false);
    }
  };

  const statusLabel: Record<string, string> = {
    new: 'Nuevo',
    active: 'Activo',
    qualified: 'Calificado',
    scheduled: 'Agendado',
    lost: 'Perdido',
    closed: 'Vendido',
  };
  const statusColor: Record<string, string> = {
    new: 'bg-blue-500/20 text-blue-300',
    active: 'bg-green-500/20 text-green-300',
    qualified: 'bg-violet-500/20 text-violet-300',
    scheduled: 'bg-amber-500/20 text-amber-300',
    lost: 'bg-red-500/20 text-red-300',
    closed: 'bg-emerald-500/20 text-emerald-300',
  };

  return (
    <div className="flex shrink-0 flex-col border-b border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 md:hidden"
            title="Volver"
            aria-label="Volver a conversaciones"
          >
            <ArrowLeft size={18} />
          </button>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">{displayName}</span>
            <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline ${statusColor[lead.status] ?? statusColor.active}`}>
              {statusLabel[lead.status] ?? lead.status}
            </span>
            {badge && (
              <span className="hidden shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400 sm:inline">
                {badge.icon} {badge.label}
              </span>
            )}
          </div>
          <span className="truncate text-xs text-zinc-500">
            {isWhatsapp ? lead.phone : badge?.label}
          </span>
        </div>

        <div className="flex w-full shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5 md:w-auto md:overflow-visible md:pb-0">
          {onOpenLeadDetails && (
            <button
              onClick={onOpenLeadDetails}
              className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
              title="Ver datos del cliente"
              aria-label="Ver datos del cliente"
            >
              <UserRound size={14} />
              <span className="hidden sm:inline">Datos</span>
            </button>
          )}

          <AiStatusBadge aiEnabled={lead.aiEnabled} />

          {isWhatsapp && (
            <button
              onClick={onOpenTemplates}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
              title="Enviar plantilla de WhatsApp"
              aria-label="Enviar plantilla de WhatsApp"
            >
              <ClipboardList size={14} />
              <span className="hidden sm:inline">Plantilla</span>
            </button>
          )}

          <button
            onClick={handleToggleAi}
            disabled={toggling}
            className={`
              flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium
              transition-colors focus:outline-none
              ${lead.aiEnabled
                ? 'border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
                : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
              }
              disabled:cursor-not-allowed disabled:opacity-50
            `}
            title={lead.aiEnabled ? 'Pausar IA' : 'Activar IA'}
            aria-label={lead.aiEnabled ? 'Pausar IA' : 'Activar IA'}
          >
            {toggling ? <Spinner size="sm" /> : lead.aiEnabled
              ? <><Pause size={14} /> <span className="hidden sm:inline">Pausar IA</span></>
              : <><Play size={14} /> <span className="hidden sm:inline">Activar IA</span></>}
          </button>

          <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 text-[11px] font-medium text-zinc-400 sm:hidden">
            <Bot size={13} />
            {lead.aiEnabled ? 'IA activa' : 'IA pausada'}
          </span>
        </div>
      </div>

      {isWhatsapp && windowTs && (
        <div className={`flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] sm:px-4 ${
          windowOpen
            ? 'border-t border-green-500/10 bg-green-500/5'
            : 'border-t border-amber-500/10 bg-amber-500/5'
        }`}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${windowOpen ? 'bg-green-400' : 'bg-amber-400'}`} />
            <span className={`truncate ${windowOpen ? 'text-green-400' : 'text-amber-400'}`}>
              {windowOpen ? `Ventana abierta - ${timeLeft}` : `Ventana cerrada - ${closedAgo}`}
            </span>
          </div>
          {!windowOpen && (
            <button
              onClick={onOpenTemplates}
              className="shrink-0 text-amber-400 underline underline-offset-2 transition-colors hover:text-amber-300"
            >
              Usar plantilla
            </button>
          )}
        </div>
      )}
    </div>
  );
}
