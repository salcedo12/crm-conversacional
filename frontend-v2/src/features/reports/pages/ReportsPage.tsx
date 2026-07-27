import { useEffect, useState } from 'react';
import { FileBarChart, Clock, Trophy, CalendarCheck, AlertTriangle, Hourglass, MessageSquare, UserRound, Gauge } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Spinner } from '@/shared/components/Spinner';
import { getAdvisorReports, type AdvisorReports, type AdvisorReport } from '../services/reports.service';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:       { label: 'Nuevo',      color: 'bg-sky-500'     },
  active:    { label: 'Activo',     color: 'bg-violet-500'  },
  qualified: { label: 'Calificado', color: 'bg-amber-500'   },
  scheduled: { label: 'Agendado',   color: 'bg-emerald-500' },
  lost:      { label: 'Perdido',    color: 'bg-red-500'     },
  closed:    { label: 'Cerrado',    color: 'bg-zinc-400'    },
};

const RANGES: { days: number; label: string }[] = [
  { days: 7,  label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 0,  label: 'Todo' },
];

/** Minutos → "45 min", "2 h 10 min", "1 d 3 h". */
function fmtMin(min: number | null): string {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function responseColor(min: number | null): string {
  if (min === null) return 'text-zinc-500';
  if (min <= 30) return 'text-emerald-400';
  if (min <= 120) return 'text-amber-400';
  return 'text-red-400';
}

function scoreColor(score: number): string {
  return score >= 66 ? 'text-emerald-400' : score >= 33 ? 'text-amber-400' : score > 0 ? 'text-sky-400' : 'text-zinc-600';
}

export function ReportsPage() {
  const { companyId } = useAuth();
  const [data, setData] = useState<AdvisorReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState(30);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    getAdvisorReports(companyId, rangeDays)
      .then(setData)
      .catch((err) => { console.error('[Reports] error:', err); setError('No se pudieron cargar los informes.'); })
      .finally(() => setLoading(false));
  }, [companyId, rangeDays]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <FileBarChart size={17} className="text-violet-400" /> Informes por asesor
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">Desempeño, tiempos de respuesta y seguimiento del equipo</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-800 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${rangeDays === r.days ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : error ? (
        <div className="flex justify-center p-12"><p className="text-sm text-red-400">{error}</p></div>
      ) : data ? (
        <div className="flex flex-col gap-5 p-5">
          {/* Resumen de equipo */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <TeamKpi icon={UserRound} label="Asesores" value={data.team.advisors} tone="text-zinc-200" />
            <TeamKpi icon={FileBarChart} label="Leads" value={data.team.totalLeads} tone="text-violet-400" />
            <TeamKpi icon={CalendarCheck} label="Conversión" value={`${data.team.conversionRate}%`} tone="text-amber-400" />
            <TeamKpi icon={Trophy} label="Cierres" value={`${data.team.closedRate}%`} tone="text-emerald-400" />
            <TeamKpi icon={Clock} label="Resp. prom" value={fmtMin(data.team.avgResponseMin)} tone={responseColor(data.team.avgResponseMin)} small />
            <TeamKpi icon={AlertTriangle} label="Estancados" value={data.team.stale} tone={data.team.stale > 0 ? 'text-red-400' : 'text-zinc-200'} />
          </div>

          {data.advisors.filter((a) => a.leads > 0).length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
              <FileBarChart size={22} className="mx-auto text-zinc-700" />
              <p className="mt-2 text-sm text-zinc-400">Sin leads asignados en este periodo</p>
              <p className="mt-1 text-xs text-zinc-600">Prueba ampliando el rango de fechas.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.advisors.filter((a) => a.leads > 0).map((a) => <AdvisorCard key={a.advisorId} a={a} />)}
            </div>
          )}

          <p className="text-center text-[10px] text-zinc-600">
            Periodo: {data.rangeDays === 0 ? 'todo el histórico' : `últimos ${data.rangeDays} días`} (por fecha de creación del lead) ·
            Actualizado {new Date(data.generatedAt).toLocaleString('es-CO')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AdvisorCard({ a }: { a: AdvisorReport }) {
  const initials = a.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const total = a.leads || 1;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      {/* Cabecera */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 text-sm font-semibold text-violet-200">
          {initials || <UserRound size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">{a.name}</p>
          <p className="text-[11px] text-zinc-500">{a.leads} leads · {a.handled} atendidos</p>
        </div>
        {(a.waiting > 0 || a.stale > 0) && (
          <div className="flex gap-1.5">
            {a.waiting > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300" title="Leads esperando respuesta">
                <Hourglass size={10} /> {a.waiting}
              </span>
            )}
            {a.stale > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300" title="Leads estancados (sin actividad +3 días)">
                <AlertTriangle size={10} /> {a.stale}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Métricas principales */}
      <div className="grid grid-cols-4 gap-2">
        <Metric icon={CalendarCheck} label="Conversión" value={`${a.conversionRate}%`} tone="text-amber-400" />
        <Metric icon={Trophy} label="Cierres" value={`${a.closedRate}%`} tone="text-emerald-400" />
        <Metric icon={CalendarCheck} label="Citas" value={`${a.appts.completed}/${a.appts.total}`} tone="text-sky-400" />
        <Metric icon={Gauge} label="Score" value={a.avgScore || '—'} tone={scoreColor(a.avgScore)} />
      </div>

      {/* Tiempos de respuesta */}
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
          <Clock size={11} /> Tiempo de respuesta del asesor
        </p>
        {a.responseSamples === 0 ? (
          <p className="text-[11px] text-zinc-600">Sin respuestas manuales en el periodo (¿todo lo maneja la IA?).</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <RespStat label="Promedio" value={fmtMin(a.avgResponseMin)} tone={responseColor(a.avgResponseMin)} />
            <RespStat label="Mediana" value={fmtMin(a.medianResponseMin)} tone={responseColor(a.medianResponseMin)} />
            <RespStat label="< 1 hora" value={`${a.within1hRate}%`} tone={(a.within1hRate ?? 0) >= 70 ? 'text-emerald-400' : 'text-amber-400'} />
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-600">
          <MessageSquare size={10} /> {a.advisorMsgs} mensajes enviados · {a.responseSamples} respuestas medidas
        </p>
      </div>

      {/* Barra de estados */}
      <div className="mt-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
          {(['new', 'active', 'qualified', 'scheduled', 'closed', 'lost'] as const).map((s) => {
            const w = (a.byStatus[s] / total) * 100;
            return w > 0 ? <div key={s} className={STATUS_META[s].color} style={{ width: `${w}%` }} title={`${STATUS_META[s].label}: ${a.byStatus[s]}`} /> : null;
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
          {(['new', 'active', 'qualified', 'scheduled', 'closed', 'lost'] as const).filter((s) => a.byStatus[s] > 0).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].color}`} /> {STATUS_META[s].label} {a.byStatus[s]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamKpi({ icon: Icon, label, value, tone, small }: { icon: typeof Clock; label: string; value: string | number; tone: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Icon size={13} className={tone} /> {label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${small ? 'text-lg' : 'text-2xl'} ${tone}`}>{value}</p>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Clock; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-lg bg-zinc-800/30 p-2 text-center">
      <Icon size={13} className={`mx-auto ${tone}`} />
      <p className={`mt-1 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[9px] text-zinc-500">{label}</p>
    </div>
  );
}

function RespStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${tone}`}>{value}</p>
      <p className="text-[9px] text-zinc-500">{label}</p>
    </div>
  );
}
