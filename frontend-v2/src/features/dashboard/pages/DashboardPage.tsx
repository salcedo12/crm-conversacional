import { useEffect, useState } from 'react';
import { useAuth }   from '@/features/auth/hooks/useAuth';
import { Spinner }   from '@/shared/components/Spinner';
import { getDashboardMetrics, type DashboardMetrics } from '../services/metrics.service';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:       { label: 'Nuevo',      color: 'bg-sky-500'     },
  active:    { label: 'Activo',     color: 'bg-violet-500'  },
  qualified: { label: 'Calificado', color: 'bg-amber-500'   },
  scheduled: { label: 'Agendado',   color: 'bg-emerald-500' },
  lost:      { label: 'Perdido',    color: 'bg-red-500'     },
  closed:    { label: 'Cerrado',    color: 'bg-zinc-500'    },
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', manual: 'Manual', web: 'Web', facebook: 'Facebook', instagram: 'Instagram',
};

export function DashboardPage() {
  const { companyId, profile } = useAuth();
  const [data,    setData]    = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getDashboardMetrics(companyId));
    } catch (err) {
      console.error('[Dashboard] error:', err);
      setError('No se pudieron cargar las métricas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Resumen</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Hola{profile?.displayName ? `, ${profile.displayName}` : ''} · Indicadores de tu CRM
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          ↻ Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : error ? (
        <div className="flex justify-center p-12"><p className="text-sm text-red-400">{error}</p></div>
      ) : data ? (
        <div className="flex flex-col gap-5 p-5">
          {/* ── Tarjetas KPI ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Leads totales"   value={data.totalLeads}            hint={`+${data.newLeads7d} esta semana`} />
            <KpiCard label="Conversión"      value={`${data.conversionRate}%`}  hint="agendados + cerrados" />
            <KpiCard label="Citas próximas"  value={data.appointments.upcoming} hint={`${data.appointments.total} en total`} />
            <KpiCard label="Nuevos (30d)"    value={data.newLeads30d}           hint="últimos 30 días" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── Leads por estado ───────────────────────────────────────── */}
            <Panel title="Leads por estado">
              <div className="flex flex-col gap-2.5">
                {data.leadsByStatus.map((s) => {
                  const meta = STATUS_META[s.status] ?? { label: s.status, color: 'bg-zinc-600' };
                  const pct = data.totalLeads > 0 ? (s.count / data.totalLeads) * 100 : 0;
                  return (
                    <div key={s.status} className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400 w-20 shrink-0">{meta.label}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div className={`h-full ${meta.color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-zinc-300 w-8 text-right tabular-nums">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* ── Leads por asesor ───────────────────────────────────────── */}
            <Panel title="Leads por asesor">
              {data.leadsByAdvisor.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin datos.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.leadsByAdvisor.map((a) => {
                    const max = Math.max(...data.leadsByAdvisor.map((x) => x.count), 1);
                    const pct = (a.count / max) * 100;
                    return (
                      <div key={a.advisorId ?? 'none'} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-400 w-28 shrink-0 truncate">{a.name}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-zinc-300 w-8 text-right tabular-nums">{a.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* ── Tendencia de nuevos leads (14 días) ──────────────────────── */}
          <Panel title="Nuevos leads (últimos 14 días)">
            <DailyTrend data={data.dailyNewLeads} />
          </Panel>

          {/* ── Citas + fuentes ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel title="Citas">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Próximas"   value={data.appointments.upcoming}  color="text-emerald-400" />
                <Stat label="Completadas" value={data.appointments.completed} color="text-sky-400" />
                <Stat label="Canceladas"  value={data.appointments.canceled}  color="text-red-400" />
              </div>
            </Panel>

            <Panel title="Citas por asesor">
              {data.appointmentsByAdvisor.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin citas registradas.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.appointmentsByAdvisor.map((advisor) => {
                    const max = Math.max(...data.appointmentsByAdvisor.map((x) => x.total), 1);
                    const pct = (advisor.total / max) * 100;
                    return (
                      <div key={advisor.advisorId ?? 'none'} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-zinc-300 truncate">{advisor.name}</span>
                          <span className="text-xs text-zinc-100 font-medium tabular-nums">{advisor.total}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                          <span><span className="text-emerald-400">{advisor.upcoming}</span> próximas</span>
                          <span><span className="text-sky-400">{advisor.completed}</span> completadas</span>
                          <span><span className="text-red-400">{advisor.canceled}</span> canceladas</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            <Panel title="Leads por fuente">
              {data.leadsBySource.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin datos.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.leadsBySource.map((s) => (
                    <span key={s.source} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300">
                      {SOURCE_LABEL[s.source] ?? s.source}: <span className="text-zinc-100 font-medium">{s.count}</span>
                    </span>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <p className="text-[10px] text-zinc-600 text-center">
            Actualizado {new Date(data.generatedAt).toLocaleString('es-CO')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function KpiCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-zinc-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

function DailyTrend({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1.5 h-28">
      {data.map((d) => {
        const h = (d.count / max) * 100;
        const day = d.date.slice(8, 10);
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full bg-violet-500/70 group-hover:bg-violet-400 rounded-t transition-colors"
                style={{ height: `${Math.max(h, 2)}%` }}
                title={`${d.date}: ${d.count}`}
              />
            </div>
            <span className="text-[9px] text-zinc-600">{day}</span>
          </div>
        );
      })}
    </div>
  );
}
