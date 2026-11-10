import { useState } from 'react';
import type { DragEvent } from 'react';
import {
  Phone, MessageSquare, ClipboardList, ChevronRight,
  User, Building,
} from 'lucide-react';
import {
  PIPELINE_STAGES, type PipelineCardItem,
} from '../types/pipeline.types';

interface PipelineCardProps {
  card: PipelineCardItem;
  onOpenFicha: (card: PipelineCardItem) => void;
  onChangeStage: (cardId: string, newStageId: string) => void;
  onDragStart?: (e: DragEvent, cardId: string) => void;
}

export function PipelineCard({
  card,
  onOpenFicha,
  onChangeStage,
  onDragStart,
}: PipelineCardProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const cleanPhone = card.phone.replace(/\D/g, '');
  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, card.id)}
      className="group relative rounded-xl border border-zinc-800 bg-zinc-900/90 p-3.5 shadow-md transition-all hover:border-zinc-700 hover:bg-zinc-900 hover:shadow-lg active:cursor-grabbing cursor-grab flex flex-col gap-2.5"
    >
      {/* Cabecera de la tarjeta: Nombre y Score */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-zinc-100 hover:text-white" title={card.name}>
            {card.name}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 mt-0.5">
            <span className="truncate">{card.phone || 'Sin teléfono'}</span>
          </div>
          {card.email && (
            <p className="truncate text-[10px] text-zinc-500 font-mono" title={card.email}>
              {card.email}
            </p>
          )}
        </div>

        {/* Score Box estilo SmartHome */}
        <div className="flex flex-col items-center justify-center shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-2 py-1 min-w-[42px]">
          <span className="text-[9px] font-semibold uppercase text-zinc-500">score</span>
          <span className={`text-xs font-bold ${card.score > 0 ? 'text-emerald-400' : 'text-zinc-400'}`}>
            {card.score}
          </span>
        </div>
      </div>

      {/* Proyecto / Sector / Inmueble */}
      <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 px-2.5 py-1.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 truncate">
          <Building className="h-3 w-3 shrink-0 text-emerald-500" />
          <span className="truncate">{card.project}</span>
        </div>
        {card.sector && (
          <p className="text-[10px] text-zinc-400 font-medium truncate">
            {card.sector} {card.cupo ? `· ${card.cupo}` : ''}
          </p>
        )}
      </div>

      {/* Asesor y Badges */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
        <div className="flex items-center gap-1 text-zinc-400 truncate" title={`Asesor: ${card.advisorName}`}>
          <User className="h-3 w-3 shrink-0 text-zinc-500" />
          <span className="truncate font-medium text-zinc-300">{card.advisorName}</span>
        </div>

        {/* Tag Pill (asinproia, marketing, base de datos) */}
        <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 truncate">
          {card.sourceLabel}
        </span>
      </div>

      {/* Última bitácora si existe */}
      {card.lastBitacora && (
        <p className="text-[10px] text-zinc-400 line-clamp-2 leading-tight bg-zinc-950/40 p-1.5 rounded border border-zinc-800/50">
          <span className="text-zinc-500 font-semibold">Seguimiento:</span> {card.lastBitacora}
        </p>
      )}

      {/* Barra inferior de acciones rápidas */}
      <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-zinc-800/80 mt-0.5">
        <div className="flex items-center gap-1">
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              title="Abrir en WhatsApp"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </a>
          )}
          {card.phone && (
            <a
              href={`tel:${card.phone}`}
              title="Llamar"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={() => onOpenFicha(card)}
            title="Diligenciar Ficha Técnica & Seguimiento"
            className="flex h-7 items-center gap-1 px-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold hover:bg-emerald-500/25 transition-colors shadow-sm"
          >
            <ClipboardList className="h-3 w-3" />
            <span>Ficha</span>
          </button>
        </div>

        {/* Botón selector de etapa */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMoveMenu(!showMoveMenu)}
            title="Mover de etapa"
            className="flex h-7 items-center gap-1 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-300 text-[10px] font-medium hover:bg-zinc-700 transition-colors"
          >
            <span>Mover</span>
            <ChevronRight className="h-3 w-3" />
          </button>

          {showMoveMenu && (
            <div
              className="absolute right-0 bottom-full mb-1 z-30 w-52 rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl space-y-0.5 text-xs max-h-64 overflow-y-auto"
              onMouseLeave={() => setShowMoveMenu(false)}
            >
              <p className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase">Cambiar Etapa:</p>
              {PIPELINE_STAGES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onChangeStage(card.id, s.id);
                    setShowMoveMenu(false);
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1.5 rounded-lg text-left text-[11px] transition-colors ${
                    card.stageId === s.id
                      ? 'bg-violet-600/20 text-violet-300 font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="truncate">{s.label}</span>
                  <span className="text-[10px] opacity-70 shrink-0 font-mono ml-2">
                    {s.probabilityLabel}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
