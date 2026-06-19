import { useState }        from 'react';
import { formatPhone }     from '@/shared/utils/formatPhone';
import { AiStatusBadge }  from './AiStatusBadge';
import { Spinner }        from '@/shared/components/Spinner';
import { isWindowOpen, windowTimeLeft, windowClosedAgo } from '../utils/conversationWindow';
import type { Lead }      from '../types';

interface ConversationHeaderProps {
  lead:            Lead;
  onPauseAi:       () => Promise<void>;
  onResumeAi:      () => Promise<void>;
  onOpenTemplates: () => void;
  onBack?:         () => void;
}

export function ConversationHeader({ lead, onPauseAi, onResumeAi, onOpenTemplates, onBack }: ConversationHeaderProps) {
  const [toggling, setToggling] = useState(false);

  const displayName  = lead.name ?? formatPhone(lead.phone);
  // lastInboundAt es el campo exacto (seteado desde ahora en adelante).
  // Para leads existentes sin ese campo, usar lastMessageAt como aproximación.
  const windowTs   = lead.lastInboundAt ?? lead.lastMessageAt ?? null;
  const windowOpen = isWindowOpen(windowTs);
  const timeLeft   = windowTimeLeft(windowTs);
  const closedAgo  = windowClosedAgo(windowTs);

  const handleToggleAi = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (lead.aiEnabled) await onPauseAi();
      else                await onResumeAi();
    } catch (err) {
      console.error('[ConversationHeader] toggle AI error:', err);
    } finally {
      setToggling(false);
    }
  };

  const statusLabel: Record<string, string> = {
    new: 'Nuevo', active: 'Activo', qualified: 'Calificado',
    scheduled: 'Agendado', lost: 'Perdido', closed: 'Cerrado',
  };
  const statusColor: Record<string, string> = {
    new: 'bg-blue-500/20 text-blue-300', active: 'bg-green-500/20 text-green-300',
    qualified: 'bg-violet-500/20 text-violet-300', scheduled: 'bg-amber-500/20 text-amber-300',
    lost: 'bg-red-500/20 text-red-300', closed: 'bg-zinc-500/20 text-zinc-400',
  };

  return (
    <div className="flex flex-col border-b border-zinc-800 bg-zinc-950 shrink-0">
      {/* Fila principal */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        {/* Atrás (solo móvil) */}
        {onBack && (
          <button onClick={onBack} className="md:hidden -ml-1 mr-1 text-zinc-400 hover:text-zinc-100 text-lg shrink-0" title="Volver">
            ←
          </button>
        )}

        {/* Lead info */}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100 truncate">{displayName}</span>
            <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor[lead.status] ?? statusColor.active}`}>
              {statusLabel[lead.status] ?? lead.status}
            </span>
          </div>
          <span className="text-xs text-zinc-500 truncate">{lead.phone}</span>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2 shrink-0">
          <AiStatusBadge aiEnabled={lead.aiEnabled} />

          {/* Plantillas */}
          <button
            onClick={onOpenTemplates}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-lg
              border border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Enviar plantilla de WhatsApp"
          >
            📋 <span className="hidden sm:inline">Plantilla</span>
          </button>

          {/* Toggle IA */}
          <button
            onClick={handleToggleAi}
            disabled={toggling}
            className={`
              flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
              transition-colors border focus:outline-none
              ${lead.aiEnabled
                ? 'border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
                : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {toggling ? <Spinner size="sm" /> : lead.aiEnabled
              ? <>⏸ <span className="hidden sm:inline">Pausar IA</span></>
              : <>▶ <span className="hidden sm:inline">Activar IA</span></>}
          </button>
        </div>
      </div>

      {/* Barra de ventana de 24h — siempre visible si hay actividad */}
      {windowTs && (
        <div className={`px-4 py-1.5 flex items-center justify-between text-[11px] ${
          windowOpen
            ? 'bg-green-500/5 border-t border-green-500/10'
            : 'bg-amber-500/5 border-t border-amber-500/10'
        }`}>
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${windowOpen ? 'bg-green-400' : 'bg-amber-400'}`} />
            <span className={windowOpen ? 'text-green-400' : 'text-amber-400'}>
              {windowOpen ? `Ventana abierta · ${timeLeft}` : `Ventana cerrada · ${closedAgo}`}
            </span>
          </div>
          {!windowOpen && (
            <button
              onClick={onOpenTemplates}
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
            >
              Usar plantilla →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
