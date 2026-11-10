import { useState } from 'react';
import { ArrowLeft, ArrowRightLeft, Bot, ClipboardList, LayoutTemplate, Megaphone, Play, UserRound } from 'lucide-react';
import { formatPhone } from '@/shared/utils/formatPhone';
import { Spinner } from '@/shared/components/Spinner';
import { isWindowOpen, windowTimeLeft, windowClosedAgo } from '../utils/conversationWindow';
import { getManualTakeoverSlaInfo } from '../utils/manualTakeoverSla';
import { channelBadge } from '../utils/inboxes';
import type { Lead } from '../types';

interface ConversationHeaderProps {
  lead: Lead;
  onPauseAi: () => Promise<void>;
  onResumeAi: () => Promise<void>;
  onOpenTemplates: () => void;
  onOpenLeadDetails?: () => void;
  onOpenFicha?: () => void;
  onRequestReassign?: () => void;
  onBack?: () => void;
  /** Rol "Solo lectura": oculta plantillas y deja el estado de la IA como indicador. */
  readOnly?: boolean;
}

export function ConversationHeader({
  lead,
  onPauseAi,
  onResumeAi,
  onOpenTemplates,
  onOpenLeadDetails,
  onOpenFicha,
  onRequestReassign,
  readOnly = false,
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

  // Cálculo del reloj de 24h cuando el asesor apaga la IA (Toma de Control Manual)
  const manualSla = getManualTakeoverSlaInfo(lead);
  const manualTakeoverInfo = manualSla ? {
    tone: manualSla.status,
    text: manualSla.label,
  } : null;

  const handleToggleAi = async () => {
    if (toggling || readOnly) return;
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
    active: 'bg-emerald-500/20 text-emerald-400',
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="truncate">
              {isWhatsapp ? lead.phone : badge?.label}
            </span>
            {lead.source === 'meta_ads' && (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                  <Megaphone size={10} className="text-blue-400" />
                  <span>Pauta: {lead.sourceMeta?.headline || 'Meta Ads'}</span>
                  {lead.sourceMeta?.mediaType === 'video' && <span className="text-zinc-400">· 🎬 Video</span>}
                </span>
                {lead.sourceMeta?.sourceUrl && (
                  <a
                    href={lead.sourceMeta.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                    title="Ver video/anuncio original en Facebook/Instagram"
                  >
                    <Play size={9} className="text-blue-400 fill-blue-400" />
                    <span>Ver video ↗</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5 md:w-auto md:overflow-visible md:pb-0 scrollbar-none">
          {onOpenLeadDetails && (
            <button
              onClick={onOpenLeadDetails}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
              title="Ver datos del cliente"
              aria-label="Ver datos del cliente"
            >
              <UserRound size={14} />
              <span className="hidden sm:inline">Datos</span>
            </button>
          )}

          {isWhatsapp && !readOnly && (
            <button
              onClick={onOpenTemplates}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white"
              title="Enviar plantilla oficial de WhatsApp"
              aria-label="Enviar plantilla oficial de WhatsApp"
            >
              <LayoutTemplate size={14} className="text-zinc-300" />
              <span>Plantilla</span>
            </button>
          )}

          {onOpenFicha && (
            <button
              onClick={onOpenFicha}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white shadow-sm"
              title={readOnly ? 'Ver historial de la Ficha Técnica' : 'Diligenciar Ficha Técnica / Registrar Seguimiento'}
              aria-label={readOnly ? 'Ver Ficha Técnica' : 'Diligenciar Ficha Técnica'}
            >
              <ClipboardList size={14} className="text-amber-500 dark:text-amber-400" />
              <span>Ficha</span>
            </button>
          )}

          {onRequestReassign && (
            <button
              onClick={onRequestReassign}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 shadow-sm cursor-pointer"
              title="Solicitar reasignación o traslado de este prospecto al Administrador"
              aria-label="Solicitar reasignación"
            >
              <ArrowRightLeft size={13} className="text-amber-400" />
              <span className="hidden sm:inline">Reasignar</span>
            </button>
          )}

          {/* Botón interactivo único para ver estado y alternar la IA al tocarlo */}
          <button
            onClick={handleToggleAi}
            disabled={toggling || readOnly}
            className={`
              flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium
              transition-colors focus:outline-none shadow-sm
              ${readOnly ? 'disabled:!cursor-default disabled:!opacity-100 pointer-events-none' : ''}
              ${lead.aiEnabled
                ? 'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/25'
                : 'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/25'
              }
              disabled:cursor-not-allowed disabled:opacity-50
            `}
            title={readOnly ? (lead.aiEnabled ? 'IA activa' : 'IA pausada') : lead.aiEnabled ? 'IA activa — Toca para pausar' : 'IA pausada — Toca para activar'}
            aria-label={readOnly ? (lead.aiEnabled ? 'IA activa' : 'IA pausada') : lead.aiEnabled ? 'IA activa — Toca para pausar' : 'IA pausada — Toca para activar'}
          >
            {toggling ? (
              <Spinner size="sm" />
            ) : (
              <Bot size={14} className={lead.aiEnabled ? 'text-emerald-600 dark:text-emerald-400 animate-pulse' : 'text-amber-600 dark:text-amber-400'} />
            )}
            <span className="font-semibold">{toggling ? 'Cambiando...' : lead.aiEnabled ? 'IA activa' : 'IA pausada'}</span>
          </button>
        </div>
      </div>

      {manualTakeoverInfo && (
        <div
          className={`flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] sm:px-4 border-t ${
            manualTakeoverInfo.tone === 'compliant'
              ? 'border-emerald-500/20 bg-emerald-50/80 text-emerald-800 dark:bg-emerald-500/5 dark:text-emerald-300 dark:border-emerald-500/15'
              : manualTakeoverInfo.tone === 'overdue'
              ? 'border-rose-500/30 bg-rose-50 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-500/30'
              : 'border-violet-500/25 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-500/30'
          }`}
        >
          <span className="truncate font-semibold">{manualTakeoverInfo.text}</span>
          {onOpenFicha && !readOnly && manualTakeoverInfo.tone !== 'compliant' && (
            <button
              type="button"
              onClick={onOpenFicha}
              className={`shrink-0 rounded px-2.5 py-0.5 text-[10px] font-bold transition-colors cursor-pointer shadow-sm ${
                manualTakeoverInfo.tone === 'overdue'
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'bg-violet-600 text-white hover:bg-violet-500'
              }`}
            >
              📝 Llenar Ficha Ahora
            </button>
          )}
        </div>
      )}

      {isWhatsapp && windowTs && (
        <div
          className={`flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] sm:px-4 border-t transition-colors ${
            windowOpen
              ? 'border-zinc-200 bg-zinc-50/90 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100'
              : 'border-amber-500/30 bg-amber-50/80 text-zinc-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-zinc-100'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {windowOpen ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-[#B7871C]/15 border border-[#B7871C]/40 text-[#0D060A] dark:text-[#D9B545] dark:bg-[#B7871C]/20 dark:border-[#B7871C]/50 shrink-0 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#B7871C]" />
                  Ventana 24h activa
                </span>
                <span className="truncate text-[11px]">
                  <strong className="text-zinc-950 dark:text-zinc-100 font-bold">{timeLeft}</strong>
                  <span className="hidden sm:inline text-zinc-500 dark:text-zinc-400 font-normal"> · Chat libre habilitado</span>
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-500/25 border border-amber-600/40 text-amber-950 dark:text-amber-200 dark:bg-amber-500/20 dark:border-amber-500/40 shrink-0">
                  ⚠️ Ventana 24h cerrada
                </span>
                <span className="truncate text-[11px] text-zinc-800 dark:text-zinc-200 font-medium">
                  {closedAgo} • Usa una plantilla oficial para responder.
                </span>
              </>
            )}
          </div>

          <div className="shrink-0">
            {windowOpen ? (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Línea oficial WhatsApp
              </span>
            ) : readOnly ? null : (
              <button
                type="button"
                onClick={onOpenTemplates}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#B7871C] hover:bg-[#947018] px-2.5 py-1 text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
                title="Abrir selector de plantillas oficiales de WhatsApp"
              >
                <LayoutTemplate size={12} />
                <span>Usar plantilla</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
