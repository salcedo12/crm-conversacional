import { useState } from 'react';
import {
  Sparkles, RefreshCw, Loader2, Target, TrendingUp, AlertTriangle,
  ArrowRight, Wallet, MapPin, Flame, Snowflake, Thermometer,
} from 'lucide-react';
import { analyzeLead, toAnalysisResult, type LeadAnalysisResult } from '../services/leadAnalysis.service';
import type { Lead, LeadTemperature } from '@/features/inbox/types';

interface LeadAnalysisCardProps {
  lead:      Lead;
  companyId: string;
}

const TEMP_META: Record<LeadTemperature, {
  label: string; icon: typeof Flame; ring: string; text: string; chip: string;
}> = {
  hot:  { label: 'Caliente', icon: Flame,       ring: '#10b981', text: 'text-emerald-300', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  warm: { label: 'Tibio',    icon: Thermometer, ring: '#f59e0b', text: 'text-amber-300',   chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  cold: { label: 'Frío',     icon: Snowflake,   ring: '#38bdf8', text: 'text-sky-300',     chip: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
};

export function LeadAnalysisCard({ lead, companyId }: LeadAnalysisCardProps) {
  const [analysis, setAnalysis] = useState<LeadAnalysisResult | null>(
    lead.aiAnalysis ? toAnalysisResult(lead.aiAnalysis) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await analyzeLead(companyId, lead.id));
    } catch (err) {
      console.error('[LeadAnalysisCard] analyze error:', err);
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      setError(
        code === 'functions/failed-precondition'
          ? (message || 'Este lead aún no tiene conversación para analizar.')
          : 'No se pudo generar el análisis con IA.'
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Estado vacío: aún no se ha analizado ─────────────────────────────────────
  if (!analysis) {
    return (
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-4 py-5 text-center">
        <Sparkles size={22} className="mx-auto text-violet-300" />
        <p className="mt-2 text-sm font-medium text-zinc-200">Radiografía IA</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Deja que la IA lea la conversación y califique este lead: puntaje, interés,
          objeciones y el próximo paso ideal.
        </p>
        <button
          onClick={run}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-violet-500/40 bg-violet-500/15 px-3.5 py-2 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? 'Analizando…' : 'Analizar lead con IA'}
        </button>
        {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}
      </div>
    );
  }

  // ── Estado con análisis ──────────────────────────────────────────────────────
  const temp = TEMP_META[analysis.temperature] ?? TEMP_META.warm;
  const TempIcon = temp.icon;

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-4">
      {/* Cabecera: gauge + temperatura + resumen */}
      <div className="flex items-start gap-4">
        <ScoreGauge score={analysis.score} color={temp.ring} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${temp.chip}`}>
              <TempIcon size={11} /> {temp.label}
            </span>
            <button
              onClick={run}
              disabled={loading}
              title="Volver a analizar"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">{analysis.summary}</p>
        </div>
      </div>

      {/* Chips: presupuesto / zona */}
      {(analysis.budget || analysis.interestArea) && (
        <div className="flex flex-wrap gap-2">
          {analysis.budget && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-300">
              <Wallet size={12} className="text-emerald-400" /> {analysis.budget}
            </span>
          )}
          {analysis.interestArea && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-300">
              <MapPin size={12} className="text-sky-400" /> {analysis.interestArea}
            </span>
          )}
        </div>
      )}

      {/* Próximo paso — destacado */}
      <div className="rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-violet-300">
          <ArrowRight size={12} /> Próximo paso
        </p>
        <p className="mt-1 text-xs font-medium text-zinc-100">{analysis.nextAction}</p>
        {analysis.nextActionReason && (
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{analysis.nextActionReason}</p>
        )}
      </div>

      {/* Nivel de interés */}
      {analysis.interestLevel && (
        <ListBlock icon={Target} tint="text-emerald-400" title="Nivel de interés">
          <p className="text-[11px] leading-relaxed text-zinc-400">{analysis.interestLevel}</p>
        </ListBlock>
      )}

      {/* Señales de compra */}
      {analysis.buyingSignals.length > 0 && (
        <ListBlock icon={TrendingUp} tint="text-emerald-400" title="Señales de compra">
          <Bullets items={analysis.buyingSignals} dot="bg-emerald-400/70" />
        </ListBlock>
      )}

      {/* Objeciones */}
      {analysis.objections.length > 0 && (
        <ListBlock icon={AlertTriangle} tint="text-amber-400" title="Objeciones / frenos">
          <Bullets items={analysis.objections} dot="bg-amber-400/70" />
        </ListBlock>
      )}

      {/* Riesgo de pérdida */}
      {analysis.lossRisk && (
        <ListBlock icon={AlertTriangle} tint="text-red-400" title="Riesgo de pérdida">
          <p className="text-[11px] leading-relaxed text-zinc-400">{analysis.lossRisk}</p>
        </ListBlock>
      )}

      {/* Por qué del puntaje */}
      {analysis.scoreReasons.length > 0 && (
        <ListBlock icon={Sparkles} tint="text-violet-400" title="Por qué este puntaje">
          <Bullets items={analysis.scoreReasons} dot="bg-violet-400/70" />
        </ListBlock>
      )}

      <p className="border-t border-zinc-800 pt-2.5 text-[10px] text-zinc-600">
        Analizado {formatWhen(analysis.analyzedAt)} · {analysis.messageCount} mensajes · IA
      </p>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

/** Formatea un instante (epoch millis) como "hoy 3:40 p. m." o fecha corta. */
function formatWhen(ms: number): string {
  if (!ms) return '';
  const date = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 86_400_000 && date.getDate() === new Date().getDate()) {
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

/** Medidor circular de puntaje 0-100. */
function ScoreGauge({ score, color }: { score: number; color: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" stroke="#3f3f46" strokeWidth="6" />
        <circle
          cx="34" cy="34" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 700ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none text-zinc-100">{score}</span>
        <span className="text-[8px] uppercase text-zinc-500">score</span>
      </div>
    </div>
  );
}

function ListBlock({
  icon: Icon, tint, title, children,
}: {
  icon: typeof Target; tint: string; title: string; children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
        <Icon size={12} className={tint} /> {title}
      </p>
      {children}
    </div>
  );
}

function Bullets({ items, dot }: { items: string[]; dot: string }) {
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${dot}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}
