import { useState } from 'react';
import { Sparkles, Flame, Thermometer, Snowflake, Loader2, TrendingDown, Lightbulb } from 'lucide-react';
import { generateLossInsight, type AiInsights } from '../services/metrics.service';

const LOSS_LABEL: Record<string, string> = {
  precio:        'Precio / presupuesto',
  ubicacion:     'Ubicación / zona',
  competencia:   'Competencia',
  sin_respuesta: 'Dejó de responder',
  tiempo:        'No es el momento',
  no_califica:   'No califica',
  atencion:      'Atención / demora',
  otro:          'Otro',
  ninguno:       'Sin riesgo claro',
};

interface AiInsightsPanelProps {
  insights:     AiInsights;
  companyId:    string;
  canGenerate:  boolean;
}

export function AiInsightsPanel({ insights, companyId, canGenerate }: AiInsightsPanelProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { analyzedCount, avgScore, temperature, lostTotal, lostAnalyzed, lossReasons } = insights;
  const maxLoss = Math.max(...lossReasons.map((r) => r.count), 1);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await generateLossInsight(companyId);
      setInsight(r.insight);
    } catch (err) {
      const message = (err as { message?: string })?.message;
      setError(message || 'No se pudo generar la recomendación.');
    } finally {
      setLoading(false);
    }
  };

  if (analyzedCount === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Sparkles size={15} className="text-violet-300" /> Análisis IA de leads
        </h2>
        <p className="text-xs text-zinc-500">
          Aún no hay leads calificados por la IA. Usa “Analizar lead con IA” en la ficha de un lead,
          o espera al análisis automático nocturno.
        </p>
      </div>
    );
  }

  const avgColor = avgScore >= 66 ? 'text-emerald-400' : avgScore >= 33 ? 'text-amber-400' : 'text-sky-400';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Sparkles size={15} className="text-violet-300" /> Análisis IA de leads
        <span className="ml-auto text-[10px] font-normal text-zinc-600">{analyzedCount} calificados</span>
      </h2>

      {/* Score promedio + temperatura */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-800/40 p-3">
          <p className="text-[11px] text-zinc-500">Score promedio</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${avgColor}`}>{avgScore}</p>
        </div>
        <TempTile icon={Flame} label="Calientes" value={temperature.hot} color="text-emerald-400" />
        <TempTile icon={Thermometer} label="Tibios" value={temperature.warm} color="text-amber-400" />
        <TempTile icon={Snowflake} label="Fríos" value={temperature.cold} color="text-sky-400" />
      </div>

      {/* Razones de pérdida */}
      <div className="mb-4">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-zinc-500">
          <TrendingDown size={12} className="text-red-400" /> Por qué se pierden los leads
          <span className="ml-auto font-normal normal-case text-zinc-600">
            {lostAnalyzed} de {lostTotal} perdidos analizados
          </span>
        </p>
        {lossReasons.length === 0 ? (
          <p className="text-xs text-zinc-500">Sin motivos de pérdida registrados todavía.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {lossReasons.map((r) => {
              const pct = (r.count / maxLoss) * 100;
              const share = lostAnalyzed > 0 ? Math.round((r.count / lostAnalyzed) * 100) : 0;
              return (
                <div key={r.category} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-xs text-zinc-400">{LOSS_LABEL[r.category] ?? r.category}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-red-500/80" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-14 text-right text-xs tabular-nums text-zinc-300">{r.count} · {share}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recomendación ejecutiva IA */}
      {canGenerate && (
        <div className="border-t border-zinc-800 pt-4">
          {insight ? (
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-3.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-violet-300">
                <Lightbulb size={12} /> Recomendación ejecutiva
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-200">{insight}</p>
              <button onClick={generate} disabled={loading} className="mt-2 text-[11px] text-violet-300 hover:text-violet-200 disabled:opacity-50">
                {loading ? 'Regenerando…' : 'Regenerar'}
              </button>
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md border border-violet-500/40 bg-violet-500/15 px-3.5 py-2 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />}
              {loading ? 'Analizando…' : 'Generar recomendación IA'}
            </button>
          )}
          {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

function TempTile({
  icon: Icon, label, value, color,
}: {
  icon: typeof Flame; label: string; value: number; color: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-800/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Icon size={12} className={color} /> {label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
