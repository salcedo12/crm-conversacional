import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth }   from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { Spinner }   from '@/shared/components/Spinner';
import { getDashboardMetrics, type DashboardMetrics } from '../services/metrics.service';
import { AiInsightsPanel } from '../components/AiInsightsPanel';
import { ExportLeadsModal } from '../components/ExportLeadsModal';
import { Database, Calendar as CalendarIcon } from 'lucide-react';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:       { label: 'Nuevo',      color: 'bg-sky-500'     },
  active:    { label: 'Activo',     color: 'bg-violet-500'  },
  qualified: { label: 'Calificado', color: 'bg-amber-500'   },
  scheduled: { label: 'Agendado',   color: 'bg-cyan-500'    },
  lost:      { label: 'Perdido',    color: 'bg-red-500'     },
  closed:    { label: 'Vendido',    color: 'bg-emerald-500' },
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp:         'WhatsApp Orgánico (317)',
  meta_ads:         'Meta Ads (FB/IG)',
  google_ads:       'Google Ads',
  web:              'Sitio Web',
  advisor_whatsapp: 'WhatsApp Directo Asesor',
  manual:           'Manual',
  facebook:         'Facebook Messenger',
  instagram:        'Instagram DM',
};

export function DashboardPage() {
  const { companyId, profile, role, platformAdmin } = useAuth();
  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [data,          setData]          = useState<DashboardMetrics | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);
  const [loading,       setLoading]       = useState(true);
  const [exportOpen,    setExportOpen]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const canExport = platformAdmin || isAdminRole(role);

  const load = async (forceRefresh = false) => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getDashboardMetrics(companyId, forceRefresh);
      setData(res);
      setSelectedMonth((prev) => {
        // Si el usuario ya seleccionó manualmente un mes que existe, conservarlo
        if (prev && res.monthsData && res.monthsData[prev]) return prev;
        // De primeras siempre el mes actual
        if (res.monthsData && res.monthsData[currentMonthKey]) return currentMonthKey;
        // Fallback a defaultMonth o primera opción disponible
        return res.defaultMonth || res.availableMonths?.[0]?.key || 'all';
      });
    } catch (err) {
      console.error('[Dashboard] error:', err);
      setError('No se pudieron cargar las métricas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(false); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Métricas activas según el mes seleccionado (por defecto siempre el mes actual)
  const activeMetrics = useMemo(() => {
    if (!data) return null;
    if (selectedMonth && selectedMonth !== 'all' && data.monthsData && data.monthsData[selectedMonth]) {
      return data.monthsData[selectedMonth];
    }
    if (selectedMonth === 'all' && data.monthsData?.['all']) {
      return data.monthsData['all'];
    }
    return data;
  }, [data, selectedMonth]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-zinc-100">Resumen Comercial de Pauta</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              Campañas Activas
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Hola{profile?.displayName ? `, ${profile.displayName}` : ''} · Indicadores de captación digital, conversión y citas
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Selector de Período Flexible */}
          {data?.availableMonths && data.availableMonths.length > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700/80 rounded-xl px-2.5 py-1.5 shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-zinc-900 text-xs text-zinc-200 font-semibold outline-none cursor-pointer"
              >
                <optgroup label="⚡ Días y Semanas" className="bg-zinc-900 text-zinc-400 font-bold">
                  {data.availableMonths
                    .filter((m) => (m as any).group === 'dias' || ['today', 'yesterday', '7d', '14d', '30d'].includes(m.key))
                    .map((m) => (
                      <option key={m.key} value={m.key} className="bg-zinc-900 text-zinc-100 font-normal">
                        {m.label} ({m.count} leads)
                      </option>
                    ))}
                </optgroup>
                <optgroup label="📅 Mes a Mes (Pauta Activa)" className="bg-zinc-900 text-zinc-400 font-bold">
                  {data.availableMonths
                    .filter((m) => (m as any).group === 'meses' || ['2026-10', '2026-09', '2026-08'].includes(m.key))
                    .map((m) => (
                      <option key={m.key} value={m.key} className="bg-zinc-900 text-zinc-100 font-normal">
                        {m.label} ({m.count} leads)
                      </option>
                    ))}
                </optgroup>
                <optgroup label="🚀 Histórico Completo de Pauta" className="bg-zinc-900 text-zinc-400 font-bold">
                  {data.availableMonths
                    .filter((m) => m.key === 'all')
                    .map((m) => (
                      <option key={m.key} value={m.key} className="bg-zinc-900 text-zinc-100 font-normal">
                        {m.label} ({m.count} leads)
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* Enlace directo a Base de Datos Unificada (solo directores / administradores) */}
          {canExport && (
            <Link
              to="/dashboard/database"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-600/60 bg-amber-950/30 text-amber-300 hover:bg-amber-900/50 transition-colors font-semibold"
            >
              <Database className="h-3.5 w-3.5 text-amber-400" />
              Base de Datos (13k)
            </Link>
          )}

          {canExport && (
            <button
              onClick={() => setExportOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors font-medium"
            >
              📥 Exportar Excel (.xlsx)
            </button>
          )}

          <button
            onClick={() => load(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            ↻ Actualizar
          </button>
        </div>
      </div>

      {companyId && (
        <ExportLeadsModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          companyId={companyId}
        />
      )}

      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center p-12 gap-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => load(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : activeMetrics ? (
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {/* ── Pestañas de Filtro Rápido (Días, Semanas, Meses) ─────────────── */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
            {[
              { key: 'today', label: 'Hoy' },
              { key: 'yesterday', label: 'Ayer' },
              { key: '7d', label: 'Últimos 7 días' },
              { key: '14d', label: 'Últimas 2 semanas' },
              { key: '2026-10', label: 'Octubre 2026 (Mes actual)' },
              { key: '2026-09', label: 'Septiembre 2026' },
              { key: '2026-08', label: 'Agosto 2026' },
              { key: 'all', label: 'Todo el Período (Ago - Oct)' },
            ].map((pill) => {
              const count = data?.monthsData?.[pill.key]?.totalLeads ?? (data?.availableMonths?.find((m) => m.key === pill.key)?.count);
              const isSelected = selectedMonth === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setSelectedMonth(pill.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-emerald-500 text-zinc-950 font-bold shadow-md shadow-emerald-500/20'
                      : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  <span>{pill.label}</span>
                  {typeof count === 'number' && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isSelected ? 'bg-zinc-950/20 text-zinc-950 font-bold' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Banner Informativo: Pauta vs Base Histórica ───────────────── */}
          <div className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800/80 rounded-xl px-4 py-3 text-xs gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 shrink-0"></span>
              <p className="text-zinc-300">
                Mostrando <strong className="text-emerald-400 font-bold">{activeMetrics.totalLeads} leads de pauta operativa Línea 317</strong> ({selectedMonth === 'all' ? 'Todo el período (Agosto - Octubre 2026)' : activeMetrics.label}).
              </p>
            </div>
            {canExport && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500">
                  ¿Buscas los 11.787 contactos históricos de SmartHome?
                </span>
                <Link
                  to="/dashboard/database"
                  className="text-amber-400 hover:underline font-semibold flex items-center gap-1"
                >
                  Ver Base de Datos ➔
                </Link>
              </div>
            )}
          </div>

          {/* ── Tarjetas KPI Principales (Línea Central 317) ─────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Leads Pauta Línea 317" value={activeMetrics.totalLeads}            hint={selectedMonth === 'all' ? `+${activeMetrics.newLeads7d} esta semana` : activeMetrics.label || ''} />
            <KpiCard label="Conversión Pauta"      value={`${activeMetrics.conversionRate}%`}  hint="agendados + cerrados" />
            <KpiCard label="Citas próximas"        value={activeMetrics.appointments.upcoming} hint={`${activeMetrics.appointments.total} en total`} />
            <KpiCard label="Nuevos (30d)"          value={activeMetrics.newLeads30d}           hint="últimos 30 días" />
          </div>

          {/* ── Separación de Canales: Línea 317 vs WhatsApp Asesores ────── */}
          {activeMetrics.inboxBreakdown && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4">
                <p className="text-[11px] font-medium text-emerald-400">🏢 Línea Central 317 (Corporativa)</p>
                <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">{activeMetrics.inboxBreakdown.central317Count}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Pauta Meta/Google, Sitio Web y WhatsApp 317</p>
              </div>
              <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
                <p className="text-[11px] font-medium text-amber-400">👤 WhatsApp Directo Asesores</p>
                <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">{activeMetrics.inboxBreakdown.advisorDirectCount}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">QR / enlaces propios del asesor (separados del 317)</p>
              </div>
              <div className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4">
                <p className="text-[11px] font-medium text-violet-400">🔄 Contactos de Pauta del Período</p>
                <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">{activeMetrics.inboxBreakdown.allContactsTotal}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Contactos registrados en este rango</p>
              </div>
            </div>
          )}

          {/* ── Análisis IA de leads (score, temperatura, pérdidas) ──────── */}
          {activeMetrics.aiInsights && (
            <AiInsightsPanel
              insights={activeMetrics.aiInsights}
              companyId={companyId ?? ''}
              canGenerate={platformAdmin || isAdminRole(role)}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── Leads por estado ───────────────────────────────────────── */}
            <Panel title="Leads por estado (Línea 317)">
              <div className="flex flex-col gap-2.5">
                {activeMetrics.leadsByStatus.map((s) => {
                  const meta = STATUS_META[s.status] ?? { label: s.status, color: 'bg-zinc-600' };
                  const pct = activeMetrics.totalLeads > 0 ? (s.count / activeMetrics.totalLeads) * 100 : 0;
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
              {activeMetrics.leadsByAdvisor.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin datos.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeMetrics.leadsByAdvisor.map((a) => {
                    const max = Math.max(...activeMetrics.leadsByAdvisor.map((x) => x.count), 1);
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
            <DailyTrend data={activeMetrics.dailyNewLeads} />
          </Panel>

          {/* ── Citas + fuentes ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel title="Citas">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Próximas"   value={activeMetrics.appointments.upcoming}  color="text-emerald-400" />
                <Stat label="Completadas" value={activeMetrics.appointments.completed} color="text-sky-400" />
                <Stat label="Canceladas"  value={activeMetrics.appointments.canceled}  color="text-red-400" />
              </div>
            </Panel>

            <Panel title="Citas por asesor">
              {activeMetrics.appointmentsByAdvisor.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin citas registradas.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {activeMetrics.appointmentsByAdvisor.map((advisor) => {
                    const max = Math.max(...activeMetrics.appointmentsByAdvisor.map((x) => x.total), 1);
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
            <Panel title="Atribución por Fuente (Línea 317)">
              {activeMetrics.leadsBySource.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin datos.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {activeMetrics.leadsBySource.map((s) => (
                      <span key={s.source} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300">
                        {SOURCE_LABEL[s.source] ?? s.source}: <span className="text-zinc-100 font-semibold">{s.count}</span>
                      </span>
                    ))}
                  </div>
                  {activeMetrics.firstTouchBySource && activeMetrics.firstTouchBySource.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800/80">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">1ra Fuente Histórica (First Touch Inmutable)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activeMetrics.firstTouchBySource.map((ft) => (
                          <span key={ft.source} className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
                            {SOURCE_LABEL[ft.source] ?? ft.source}: <span className="text-emerald-400 font-medium">{ft.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Proyectos de Interés">
              {!activeMetrics.leadsByProject || activeMetrics.leadsByProject.length === 0 ? (
                <p className="text-xs text-zinc-500">Sin proyectos identificados aún.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeMetrics.leadsByProject.slice(0, 8).map((p) => {
                    const max = Math.max(...activeMetrics.leadsByProject!.map((x) => x.count), 1);
                    const pct = (p.count / max) * 100;
                    return (
                      <div key={p.project} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-300 w-44 shrink-0 truncate" title={p.project}>🏡 {p.project}</span>
                        <div className="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-zinc-200 w-8 text-right tabular-nums">{p.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          <p className="text-[10px] text-zinc-600 text-center">
            Actualizado {new Date(activeMetrics.generatedAt).toLocaleString('es-CO')}
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
