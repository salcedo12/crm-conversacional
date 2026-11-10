import { Lightbulb, AlertTriangle, AlertCircle, Clock, FileText, CheckCircle2, ArrowRight } from 'lucide-react';
import type { CommercialSuggestion } from '../types/commercial.types';

interface SmartFollowUpSuggestionsProps {
  suggestions: CommercialSuggestion[];
  onApplyFilter: (filter: 'urgent' | 'today' | 'missing' | 'stalled' | 'missing_followup') => void;
}

export function SmartFollowUpSuggestions({ suggestions, onApplyFilter }: SmartFollowUpSuggestionsProps) {
  if (suggestions.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs text-emerald-300 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 shrink-0">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <p className="font-bold text-emerald-200">¡Al día con la gestión comercial!</p>
            <p className="text-[11px] text-emerald-400/90 mt-0.5">
              No tienes seguimientos vencidos ni pendientes urgentes por atender hoy.
            </p>
          </div>
        </div>
        <span className="text-[10px] bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 px-2.5 py-1 rounded-full font-semibold">
          Excelente
        </span>
      </div>
    );
  }

  const renderIcon = (type: string) => {
    switch (type) {
      case 'missing_followup':
        return (
          <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
            <AlertCircle size={14} />
          </span>
        );
      case 'urgent':
        return (
          <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
            <AlertTriangle size={14} />
          </span>
        );
      case 'today':
        return (
          <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
            <Clock size={14} />
          </span>
        );
      case 'missing_ficha':
        return (
          <span className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0">
            <FileText size={14} />
          </span>
        );
      default:
        return (
          <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
            <CheckCircle2 size={14} />
          </span>
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
          <Lightbulb size={14} className="text-amber-400 shrink-0" />
          <span>Sugerencias de Seguimiento Comercial</span>
        </h4>
        <span className="text-[10px] text-zinc-500 font-medium">Priorizadas por urgencia</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-2.5 transition-all bg-zinc-900/70 ${s.badgeColor}`}
          >
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                {renderIcon(s.type)}
                <h5 className="font-bold text-xs leading-snug">{s.title}</h5>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{s.description}</p>
            </div>

            <button
              type="button"
              onClick={() => onApplyFilter(s.actionFilter)}
              className="w-full py-1.5 px-3 rounded-xl bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 text-xs font-semibold border border-zinc-700/60 transition-colors flex items-center justify-center gap-1.5 cursor-pointer mt-1"
            >
              <span>Ver estos casos ({s.count})</span>
              <ArrowRight size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
