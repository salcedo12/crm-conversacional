import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import {
  type PipelineCardItem, type PipelineStageConfig,
} from '../types/pipeline.types';
import { PipelineCard } from './PipelineCard';

interface PipelineColumnProps {
  stage: PipelineStageConfig;
  cards: PipelineCardItem[];
  onOpenFicha: (card: PipelineCardItem) => void;
  onChangeStage: (cardId: string, newStageId: string) => void;
  onDropCard?: (cardId: string, targetStageId: string) => void;
}

export function PipelineColumn({
  stage,
  cards,
  onOpenFicha,
  onChangeStage,
  onDropCard,
}: PipelineColumnProps) {
  const [isOver, setIsOver] = useState(false);

  // Agrupar tarjetas por Mes/Año estilo SmartHome: "Registro de agosto 2026 (X)"
  const groupedByMonth = useMemo(() => {
    const map = new Map<string, PipelineCardItem[]>();
    cards.forEach((c) => {
      const header = c.createdMonthYear || 'Registros Recientes';
      if (!map.has(header)) map.set(header, []);
      map.get(header)!.push(c);
    });
    return Array.from(map.entries());
  }, [cards]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId && onDropCard) {
      onDropCard(cardId, stage.id);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col rounded-2xl border bg-zinc-950/80 transition-all min-w-[320px] max-w-[340px] shrink-0 h-full max-h-[calc(100vh-210px)] ${
        isOver
          ? 'border-violet-500 bg-violet-950/20 ring-2 ring-violet-500/30'
          : `${stage.columnBorder} shadow-sm`
      }`}
    >
      {/* Cabecera de la columna */}
      <div className={`p-3.5 border-b border-zinc-800/80 rounded-t-2xl flex items-center justify-between ${stage.headerBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: stage.accentColor }}
          />
          <h3 className="text-xs font-bold text-zinc-100 truncate" title={stage.label}>
            {stage.label}
          </h3>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${stage.badgeColor}`}>
            {stage.probabilityLabel}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-semibold text-zinc-300 border border-zinc-700">
            {cards.length}
          </span>
        </div>
      </div>

      {/* Contenido / Lista de Tarjetas con Scroll */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-4">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-zinc-800 rounded-xl my-4">
            <p className="text-xs text-zinc-500 font-medium">Sin prospectos en esta etapa</p>
            <p className="text-[10px] text-zinc-600 mt-1">Arrastra una tarjeta aquí para avanzar</p>
          </div>
        ) : (
          groupedByMonth.map(([monthHeader, monthCards]) => (
            <div key={monthHeader} className="space-y-2">
              {/* Encabezado de Mes estilo SmartHome */}
              <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
                <span>{monthHeader}</span>
                <span className="text-zinc-500">({monthCards.length})</span>
              </div>

              {monthCards.map((card) => (
                <PipelineCard
                  key={card.id}
                  card={card}
                  onOpenFicha={onOpenFicha}
                  onChangeStage={onChangeStage}
                  onDragStart={(e, cardId) => {
                    e.dataTransfer.setData('text/plain', cardId);
                  }}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
