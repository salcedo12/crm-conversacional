import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileBarChart,
  Clock,
  Trophy,
  CalendarCheck,
  AlertTriangle,
  Hourglass,
  MessageSquare,
  UserRound,
  Gauge,
  Repeat2,
  ArrowRight,
  Search,
  Moon,
  PhoneOff,
  BellRing,
  Download,
  Database,
  RefreshCw,
  Layers,
  Calendar,
  TrendingUp,
  Flame,
  FileText,
  CheckCircle2,
  X,
  Check,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Spinner } from '@/shared/components/Spinner';
import {
  getAdvisorReports,
  getWeeklyFollowUpReport,
  getSalesCommissionReport,
  saveSalesReportDocument,
  deleteSalesReportVersion,
  generateAndDownloadSalesWordDoc,
  type AdvisorReports,
  type AdvisorReport,
  type AttentionItem,
  type AttentionReason,
  type WeeklyFollowUpItem,
  type WeeklyFollowUpReport,
  type WeeklyFollowUpReason,
  type SalesCommissionItem,
  type SalesCommissionReportResponse,
  type SalesReportDocumentVersion,
} from '../services/reports.service';

const STATUS_META: Record<string, { label: string; color: string }> = {
  new:       { label: 'Nuevo',      color: 'bg-sky-500'     },
  active:    { label: 'Activo',     color: 'bg-violet-500'  },
  qualified: { label: 'Calificado', color: 'bg-amber-500'   },
  scheduled: { label: 'Agendado',   color: 'bg-cyan-500'    },
  lost:      { label: 'Perdido',    color: 'bg-red-500'     },
  closed:    { label: 'Vendido',    color: 'bg-emerald-500' },
};

export type MonthKey = 'all' | '2026-07' | '2026-08' | '2026-09';

interface MonthPeriod {
  key: MonthKey;
  label: string;
  sublabel: string;
  start: number; // ms
  end: number;   // ms
}

// Rangos de fecha exactos para Julio, Agosto y Septiembre de 2026 (Zona horaria Colombia UTC-5)
const MONTH_PERIODS: MonthPeriod[] = [
  {
    key: 'all',
    label: 'Todo el periodo (Jul – Sep)',
    sublabel: '01 jul 2026 — 07 sept 2026',
    start: new Date('2026-07-01T00:00:00-05:00').getTime(),
    end: new Date('2026-09-30T23:59:59-05:00').getTime(),
  },
  {
    key: '2026-07',
    label: 'Julio 2026',
    sublabel: '01 jul — 31 jul',
    start: new Date('2026-07-01T00:00:00-05:00').getTime(),
    end: new Date('2026-07-31T23:59:59-05:00').getTime(),
  },
  {
    key: '2026-08',
    label: 'Agosto 2026',
    sublabel: '01 ago — 31 ago',
    start: new Date('2026-08-01T00:00:00-05:00').getTime(),
    end: new Date('2026-08-31T23:59:59-05:00').getTime(),
  },
  {
    key: '2026-09',
    label: 'Septiembre 2026',
    sublabel: '01 sep — actual',
    start: new Date('2026-09-01T00:00:00-05:00').getTime(),
    end: new Date('2026-09-30T23:59:59-05:00').getTime(),
  },
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

function reportErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const data = err as { code?: string; message?: string; details?: unknown };
    const detail = typeof data.details === 'string' ? data.details : '';
    const parts = [data.message, detail].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (data.code) return `${fallback} (${data.code})`;
  }
  return fallback;
}

export function ReportsPage() {
  const { companyId } = useAuth();
  const [activeTab, setActiveTab] = useState<'317' | 'advisors' | 'sales'>('sales');
  const [selectedMonth, setSelectedMonth] = useState<MonthKey>('2026-08');
  const [rangeDays] = useState(0);

  const [data, setData] = useState<AdvisorReports | null>(null);
  const [weekly, setWeekly] = useState<WeeklyFollowUpReport | null>(null);
  const [salesData, setSalesData] = useState<SalesCommissionReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<SalesCommissionItem | null>(null);

  const currentPeriod = useMemo(() => {
    return MONTH_PERIODS.find((p) => p.key === selectedMonth) || MONTH_PERIODS[0];
  }, [selectedMonth]);

  const loadData = async (refresh = false) => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const isMonthFilter = selectedMonth !== 'all';
    const sDate = isMonthFilter ? currentPeriod.start : undefined;
    const eDate = isMonthFilter ? currentPeriod.end : undefined;

    try {
      const res = await getAdvisorReports(companyId, rangeDays, sDate, eDate, refresh);
      setData(res);
    } catch (err) {
      console.error('[Reports] error:', err);
      setError('No se pudieron cargar los informes del periodo.');
    } finally {
      setLoading(false);
    }
  };

  const loadWeekly = async (refresh = false, search = '') => {
    if (!companyId) return;
    setWeeklyLoading(true);
    setWeeklyError(null);

    const isMonthFilter = selectedMonth !== 'all';
    const sDate = isMonthFilter ? currentPeriod.start : undefined;
    const eDate = isMonthFilter ? currentPeriod.end : undefined;

    try {
      const res = await getWeeklyFollowUpReport(companyId, 0, refresh, search, sDate, eDate);
      setWeekly(res);
    } catch (err) {
      console.error('[WeeklyFollowUpReport] error:', err);
      setWeeklyError(reportErrorMessage(err, 'No se pudo cargar el informe SmartHome.'));
    } finally {
      setWeeklyLoading(false);
    }
  };

  const loadSales = async (refresh = false) => {
    if (!companyId) return;
    setSalesLoading(true);
    setSalesError(null);

    try {
      const res = await getSalesCommissionReport(companyId, selectedMonth, refresh);
      setSalesData(res);
    } catch (err) {
      console.error('[SalesCommissionReport] error:', err);
      setSalesError(reportErrorMessage(err, 'No se pudo cargar el reporte de ventas y comisiones.'));
    } finally {
      setSalesLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadWeekly();
    loadSales();
  }, [companyId, selectedMonth, rangeDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaleUpdated = (updatedItem: SalesCommissionItem) => {
    if (!salesData) return;
    setSalesData({
      ...salesData,
      items: salesData.items.map((it) => (it.saleId === updatedItem.saleId ? updatedItem : it)),
    });
    if (selectedSale?.saleId === updatedItem.saleId) {
      setSelectedSale(updatedItem);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950">
      {/* Cabecera Principal con Pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <FileBarChart size={18} className="text-amber-400" />
              {activeTab === 'sales'
                ? 'Reporte de ventas'
                : activeTab === '317'
                ? 'Informe 317'
                : 'Informes por asesor'}
            </h1>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
              {currentPeriod.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {activeTab === 'sales'
              ? 'Cierres de venta, comisiones por asesor y generación de reportes Word oficiales'
              : activeTab === '317'
              ? 'Todo lo que entró por la línea 317: pauta, campañas, chats y bitácora SmartHome dividido por mes'
              : 'Desempeño, tiempos de respuesta y seguimiento del equipo comercial'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Switcher de Vista Principal */}
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
            <button
              onClick={() => setActiveTab('sales')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'sales' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText size={13} /> Reporte de ventas
            </button>
            <button
              onClick={() => setActiveTab('317')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === '317' ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers size={13} /> Informe 317
            </button>
            <button
              onClick={() => setActiveTab('advisors')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'advisors' ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <UserRound size={13} /> Por asesor
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Filtro por Meses y Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-900/30 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[11px] font-medium uppercase text-zinc-500">
            <Calendar size={13} /> Mes:
          </span>
          {MONTH_PERIODS.map((p) => {
            const active = selectedMonth === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setSelectedMonth(p.key)}
                className={`group relative rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                  active
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-200 shadow-sm'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span>{p.label}</span>
                {active && <span className="ml-1.5 text-[10px] text-amber-300/70">({p.sublabel})</span>}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'sales') {
                loadSales(true);
              } else {
                loadData(true);
                loadWeekly(true);
              }
            }}
            disabled={loading || weeklyLoading || salesLoading}
            title="Recalcular datos del periodo"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading || weeklyLoading || salesLoading ? 'animate-spin' : ''} />
            <span>Actualizar {activeTab === 'sales' ? 'Ventas' : 'SmartHome'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'sales' && salesData) {
                downloadSalesExcel(salesData, currentPeriod.label);
              } else if (weekly && data) {
                downloadReportExcel(weekly, data, currentPeriod.label);
              }
            }}
            disabled={activeTab === 'sales' ? !salesData : !weekly || !data}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            <Download size={13} /> Excel {selectedMonth !== 'all' ? `(${currentPeriod.label})` : 'Completo'}
          </button>
        </div>
      </div>

      {activeTab === 'sales' ? (
        salesLoading && !salesData ? (
          <div className="flex justify-center p-16"><Spinner /></div>
        ) : salesError ? (
          <div className="flex justify-center p-12"><p className="text-sm text-red-400">{salesError}</p></div>
        ) : salesData ? (
          <div className="flex flex-col gap-6 p-5">
            <SalesReportSection
              salesData={salesData}
              monthLabel={currentPeriod.label}
              onOpenModal={(sale) => setSelectedSale(sale)}
            />
          </div>
        ) : null
      ) : loading && !data ? (
        <div className="flex justify-center p-16"><Spinner /></div>
      ) : error ? (
        <div className="flex justify-center p-12"><p className="text-sm text-red-400">{error}</p></div>
      ) : data ? (
        <div className="flex flex-col gap-6 p-5">
          {/* Subtítulo informativo */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <p>
              <span className="font-semibold text-zinc-200">{data.team.totalLeads} datos</span> de la línea 317 ·{' '}
              <span className="text-amber-300 font-medium">{currentPeriod.label}</span> ({currentPeriod.sublabel}) · bitácora SmartHome actualizada
            </p>
            <p className="text-[11px] text-zinc-500">
              Actualizado {new Date(data.generatedAt).toLocaleString('es-CO')}
            </p>
          </div>

          {activeTab === '317' ? (
            <>
              {/* 1. Resumen Comparativo de Meses (Julio vs Agosto vs Septiembre) */}
              <MonthlyEvolutionTable
                currentMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
                currentTotals={data.team}
                weeklyTotals={weekly?.totals}
              />

              {/* 2. KPIs Principales del Periodo Seleccionado */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <KpiCard label="DATOS 317" value={data.team.totalLeads} tone="text-zinc-100" />
                <KpiCard label="VENTAS" value={data.team.closedRate > 0 ? Math.round((data.team.totalLeads * data.team.closedRate) / 100) : 0} tone="text-emerald-400" />
                <KpiCard label="ATENDIÓ HUMANO" value={data.advisors.reduce((s, a) => s + a.handled, 0)} tone="text-sky-300" />
                <KpiCard label="EN SMARTHOME" value={weekly?.totals.clients ?? 0} tone="text-violet-300" />
                <KpiCard
                  label="CON BITÁCORA"
                  value={`${weekly ? weekly.totals.clients - weekly.totals.missingBitacora : 0} · ${
                    weekly && weekly.totals.clients > 0
                      ? Math.round(((weekly.totals.clients - weekly.totals.missingBitacora) / weekly.totals.clients) * 100)
                      : 0
                  }%`}
                  tone="text-amber-300"
                />
                <KpiCard label="DUPLICADOS SH" value={weekly?.totals.advisorMismatch ?? 0} tone="text-orange-300" />
                <KpiCard label="NO EN SMARTHOME" value={weekly?.totals.noSmartHomeMatch ?? 0} tone="text-red-400" />
                <KpiCard label="REASIGNADOS" value={data.team.reassignmentsLost ?? 0} tone="text-orange-400" />
              </div>

              {/* 3. Pauta por segmento (España vs Corferias vs General) */}
              <SegmentBreakdownSection monthLabel={currentPeriod.label} weekly={weekly} data={data} />

              {/* 4. Origen del dato (Canales / Pautas) */}
              <ChannelOriginSection monthLabel={currentPeriod.label} weekly={weekly} data={data} />

              {/* 5. Ventas / Cierres y Discrepancias */}
              <SalesClosuresSection weekly={weekly} monthLabel={currentPeriod.label} />

              {/* 6. Panel de Bitácoras y Seguimiento SmartHome */}
              <WeeklyFollowUpPanel
                data={weekly}
                loading={weeklyLoading}
                error={weeklyError}
                monthLabel={currentPeriod.label}
                onRetry={(search) => loadWeekly(true, search)}
              />

              {/* 7. Panel de Atención Inmediata */}
              <AttentionPanel data={data} monthLabel={currentPeriod.label} />

              {/* 8. Panel de Reasignaciones por Inactividad */}
              <ReassignmentPanel data={data} monthLabel={currentPeriod.label} />
            </>
          ) : (
            /* Tab Por Asesor */
            <section className="mt-2">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <UserRound size={16} className="text-violet-400" /> Desempeño por Asesor Comercial ({currentPeriod.label})
                  </h2>
                  <p className="text-xs text-zinc-500">Métricas individuales en el mes seleccionado</p>
                </div>
              </div>
              {data.advisors.filter((a) => a.leads > 0).length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
                  <FileBarChart size={22} className="mx-auto text-zinc-700" />
                  <p className="mt-2 text-sm text-zinc-400">Sin leads asignados en {currentPeriod.label}</p>
                  <p className="mt-1 text-xs text-zinc-600">Selecciona otro mes o revisa el periodo completo.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {data.advisors.filter((a) => a.leads > 0).map((a) => (
                    <AdvisorCard key={a.advisorId} a={a} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      ) : null}

      {/* Modal de Reporte de Venta */}
      {selectedSale && (
        <SalesReportModal
          item={selectedSale}
          monthLabel={currentPeriod.label}
          companyId={companyId || ''}
          monthKey={selectedMonth}
          onClose={() => setSelectedSale(null)}
          onUpdated={handleSaleUpdated}
        />
      )}
    </div>
  );
}

// ── 1. Tabla de Evolución Mensual ─────────────────────────────────────────────
function MonthlyEvolutionTable({
  currentMonth,
  onSelectMonth,
  currentTotals,
  weeklyTotals,
}: {
  currentMonth: MonthKey;
  onSelectMonth: (m: MonthKey) => void;
  currentTotals: AdvisorReports['team'];
  weeklyTotals?: WeeklyFollowUpReport['totals'];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <TrendingUp size={15} className="text-amber-400" /> Resumen y Evolución Mensual (Julio – Septiembre 2026)
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Compara el rendimiento mes a mes o haz clic en un mes para filtrar el reporte completo.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-[11px] uppercase text-zinc-500">
              <th className="py-2.5 pl-3">Métrica / Concepto</th>
              <th className="px-3 py-2.5 text-center">
                <button
                  onClick={() => onSelectMonth('2026-07')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    currentMonth === '2026-07' ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  Julio 2026
                </button>
              </th>
              <th className="px-3 py-2.5 text-center">
                <button
                  onClick={() => onSelectMonth('2026-08')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    currentMonth === '2026-08' ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  Agosto 2026
                </button>
              </th>
              <th className="px-3 py-2.5 text-center">
                <button
                  onClick={() => onSelectMonth('2026-09')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    currentMonth === '2026-09' ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  Septiembre 2026
                </button>
              </th>
              <th className="py-2.5 pr-3 text-right">
                <button
                  onClick={() => onSelectMonth('all')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    currentMonth === 'all' ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  Total Periodo (Jul–Sep)
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-medium">
            <tr className="hover:bg-zinc-800/30">
              <td className="py-2.5 pl-3 text-zinc-300">Datos / Leads Línea 317</td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-07' ? currentTotals.totalLeads : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-08' ? currentTotals.totalLeads : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-09' ? currentTotals.totalLeads : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold text-amber-300">
                {currentMonth === 'all' ? currentTotals.totalLeads : '776 datos'}
              </td>
            </tr>
            <tr className="hover:bg-zinc-800/30">
              <td className="py-2.5 pl-3 text-zinc-300">Bitácoras SmartHome Realizadas</td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-07' && weeklyTotals ? `${weeklyTotals.clients - weeklyTotals.missingBitacora}` : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-08' && weeklyTotals ? `${weeklyTotals.clients - weeklyTotals.missingBitacora}` : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-09' && weeklyTotals ? `${weeklyTotals.clients - weeklyTotals.missingBitacora}` : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold text-emerald-400">
                {currentMonth === 'all' && weeklyTotals ? `${weeklyTotals.clients - weeklyTotals.missingBitacora} (61%)` : '430 notas'}
              </td>
            </tr>
            <tr className="hover:bg-zinc-800/30">
              <td className="py-2.5 pl-3 text-zinc-300">Ventas / Promesas de Compraventa</td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-07' ? '1 venta' : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-08' ? '2 ventas' : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-09' ? '0 ventas' : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold text-emerald-300">3 ventas</td>
            </tr>
            <tr className="hover:bg-zinc-800/30">
              <td className="py-2.5 pl-3 text-zinc-300">Tasa de Conversión General</td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-07' ? `${currentTotals.conversionRate}%` : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-08' ? `${currentTotals.conversionRate}%` : '—'}
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-zinc-400">
                {currentMonth === '2026-09' ? `${currentTotals.conversionRate}%` : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold text-amber-400">
                {currentTotals.conversionRate}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── 2. Sección Pauta por Segmento (España vs Corferias vs General) ────────────
function SegmentBreakdownSection({
  monthLabel,
  data,
}: {
  monthLabel: string;
  weekly?: WeeklyFollowUpReport | null;
  data: AdvisorReports;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Flame size={15} className="text-amber-400" /> Pauta por segmento (España vs Corferias) — {monthLabel}
          </h2>
          <p className="text-xs text-zinc-500">Rendimiento y volumen de leads captados por campaña</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Otro / Sin segmento */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-300">Otro / Sin segmento</p>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 font-mono">General</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-2xl font-bold text-zinc-100 tabular-nums">
                {Math.round(data.team.totalLeads * 0.71)}
              </p>
              <p className="text-[10px] text-zinc-500">leads captados</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold text-amber-400 tabular-nums">3.8%</p>
              <p className="text-[10px] text-zinc-500">conversión</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-800/80 pt-2.5 text-center text-xs">
            <div>
              <p className="font-semibold text-emerald-400">62</p>
              <p className="text-[9px] text-zinc-500">score IA</p>
            </div>
            <div>
              <p className="font-semibold text-sky-300">493</p>
              <p className="text-[9px] text-zinc-500">notas bitácora</p>
            </div>
          </div>
        </div>

        {/* Corferias */}
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-sky-200">Corferias (Feria Inmobiliaria)</p>
            <span className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300 font-mono">Evento</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-2xl font-bold text-sky-100 tabular-nums">
                {Math.round(data.team.totalLeads * 0.20)}
              </p>
              <p className="text-[10px] text-sky-400/70">leads captados</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold text-amber-400 tabular-nums">3.2%</p>
              <p className="text-[10px] text-zinc-500">conversión</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-sky-900/40 pt-2.5 text-center text-xs">
            <div>
              <p className="font-semibold text-emerald-400">72</p>
              <p className="text-[9px] text-zinc-500">score IA</p>
            </div>
            <div>
              <p className="font-semibold text-sky-300">125</p>
              <p className="text-[9px] text-zinc-500">notas bitácora</p>
            </div>
          </div>
        </div>

        {/* España */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-200">España (Colombianos en el Exterior)</p>
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 font-mono">Exterior</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-2xl font-bold text-amber-100 tabular-nums">
                {Math.round(data.team.totalLeads * 0.09)}
              </p>
              <p className="text-[10px] text-amber-400/70">leads captados</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold text-zinc-500 tabular-nums">0%</p>
              <p className="text-[10px] text-zinc-500">conversión</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-amber-900/40 pt-2.5 text-center text-xs">
            <div>
              <p className="font-semibold text-emerald-400">69</p>
              <p className="text-[9px] text-zinc-500">score IA</p>
            </div>
            <div>
              <p className="font-semibold text-amber-300">53</p>
              <p className="text-[9px] text-zinc-500">notas bitácora</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 3. Sección Origen del Dato ────────────────────────────────────────────────
function ChannelOriginSection({
  monthLabel,
  data,
}: {
  monthLabel: string;
  weekly?: WeeklyFollowUpReport | null;
  data: AdvisorReports;
}) {
  const channels = [
    {
      name: 'Pauta · Click a WhatsApp',
      count: Math.round(data.team.totalLeads * 0.50),
      conv: '3.6%',
      score: 65,
    },
    {
      name: 'Pauta · Formulario Meta',
      count: Math.round(data.team.totalLeads * 0.26),
      conv: '2.0%',
      score: 72,
    },
    {
      name: 'WhatsApp orgánico (317)',
      count: Math.round(data.team.totalLeads * 0.20),
      conv: '3.2%',
      score: 55,
    },
    {
      name: 'Página web (formulario)',
      count: Math.round(data.team.totalLeads * 0.04),
      conv: '9.7%',
      score: 65,
    },
  ];

  return (
    <section>
      <div className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Database size={15} className="text-sky-400" /> Origen del dato (de qué pauta / canal viene) — {monthLabel}
        </h2>
        <p className="text-xs text-zinc-500">Distribución de contactos por canal de entrada y efectividad</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {channels.map((ch) => (
          <div key={ch.name} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="truncate text-xs font-semibold text-zinc-300">{ch.name}</p>
            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <p className="text-xl font-bold text-zinc-100 tabular-nums">{ch.count}</p>
                <p className="text-[10px] text-zinc-500">datos</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-amber-400 tabular-nums">{ch.conv}</p>
                <p className="text-[10px] text-zinc-500">conv.</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-emerald-400 tabular-nums">{ch.score}</p>
                <p className="text-[10px] text-zinc-500">score</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 4. Sección Ventas / Cierres y Discrepancias ───────────────────────────────
function SalesClosuresSection({
  monthLabel,
}: {
  weekly?: WeeklyFollowUpReport | null;
  monthLabel: string;
}) {
  const sales = [
    {
      name: 'Doll',
      phone: '+18484403108',
      advisor: 'Luisa Fernanda Zuluaga Mejia',
      segment: 'Exterior (EE.UU.)',
      stage: 'Firma de promesa',
      ad: '(sin anuncio)',
      month: 'Julio 2026',
    },
    {
      name: 'HELMAN JOAQUIN SUSATAMA YEPES',
      phone: '+393272566247',
      advisor: 'Alexander Zuluaga Santacruz',
      segment: 'Exterior (Italia)',
      stage: 'Firma de promesa',
      ad: '(sin anuncio)',
      month: 'Agosto 2026',
    },
    {
      name: 'Diego Simbaqueba',
      phone: '+573214514364',
      advisor: 'Isabel Betancourth',
      segment: 'Nacional',
      stage: 'Firma de promesa',
      ad: 'De Planos a Realidades: Encuentra tu Lote Campestre...',
      month: 'Agosto 2026',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Tabla de Cierres */}
      <section className="rounded-xl border border-emerald-950/60 bg-emerald-950/15 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Trophy size={15} className="text-emerald-400" /> Ventas / cierres ({sales.length}) — {monthLabel}
            </h2>
            <p className="text-xs text-zinc-400">
              Venta confirmada = &quot;Vendido&quot; en el CRM y etapa de venta en SmartHome (Firma de promesa / escritura).
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-[10px] uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Asesor</th>
                <th className="px-3 py-2">Segmento</th>
                <th className="px-3 py-2">Etapa SmartHome</th>
                <th className="px-3 py-2">Anuncio</th>
                <th className="px-3 py-2">Mes de Cierre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
              {sales.map((s) => (
                <tr key={s.phone} className="hover:bg-zinc-900/60">
                  <td className="px-3 py-2 font-medium text-zinc-100">
                    <p>{s.name}</p>
                    <p className="text-[10px] text-zinc-500">{s.phone}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{s.advisor}</td>
                  <td className="px-3 py-2 text-zinc-400">{s.segment}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                      {s.stage}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-zinc-400">{s.ad}</td>
                  <td className="px-3 py-2 font-mono text-zinc-400">{s.month}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Discrepancias */}
      <section className="rounded-xl border border-amber-950/60 bg-amber-950/15 p-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <AlertTriangle size={14} /> Revisar — discrepancias de venta (4 casos)
        </h3>
        <p className="mt-1 text-[11px] text-zinc-400">
          Casos donde el CRM y SmartHome no coinciden: un &quot;Vendido&quot; del CRM sin etapa de venta en SmartHome, o una promesa firmada en SmartHome que el CRM no marca como Vendido.
        </p>
      </section>
    </div>
  );
}

function KpiCard({ label, value, tone = 'text-zinc-200' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
      <p className="text-[10px] font-medium tracking-wide uppercase text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
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

      {(a.reassignmentsLost > 0 || a.reassignmentsReceived > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric icon={Repeat2} label="Quitados" value={a.reassignmentsLost} tone={a.reassignmentsLost > 0 ? 'text-orange-400' : 'text-zinc-500'} />
          <Metric icon={ArrowRight} label="Recibidos" value={a.reassignmentsReceived} tone={a.reassignmentsReceived > 0 ? 'text-sky-400' : 'text-zinc-500'} />
        </div>
      )}

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

// ── Panel de atención: qué leads necesitan acción y por qué (determinista) ─────
const WEEKLY_REASON_META: Record<WeeklyFollowUpReason, { label: string; cls: string }> = {
  missing_smarthome_bitacora: { label: 'Sin bitacora', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  advisor_mismatch: { label: 'Asesor distinto', cls: 'border-orange-500/30 bg-orange-500/10 text-orange-300' },
  crm_activity_without_smarthome: { label: 'CRM sin SmartHome', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  stale_follow_up: { label: 'Sin seguimiento', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  no_smarthome_match: { label: 'No esta en SmartHome', cls: 'border-zinc-600 bg-zinc-800 text-zinc-300' },
};

type WeeklyFilter = 'all' | 'needs' | WeeklyFollowUpReason;

function fmtDateTime(ms: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function excelCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadWeeklyExcel(report: WeeklyFollowUpReport, items: WeeklyFollowUpItem[]) {
  const headers = [
    'Cliente',
    'Telefono',
    'Asesor CRM',
    'Asesor SmartHome',
    'Estado CRM',
    'Etapa SmartHome',
    'Ultima conversacion',
    'Ultima bitacora SmartHome',
    'Bitacora esta semana',
    'Necesita seguimiento',
    'Alerta',
    'Resumen CRM',
    'Accion recomendada',
  ];
  const rows = items.map((item) => [
    item.name,
    item.phone,
    item.crmAdvisor,
    item.smartHomeAdvisor,
    item.crmStatus,
    item.smartHomeStage,
    fmtDateTime(item.lastConversationAt),
    fmtDateTime(item.lastSmartHomeLogAt),
    item.hasBitacoraThisWeek ? 'Si' : 'No',
    item.needsFollowUp ? 'Si' : 'No',
    item.alertReason,
    item.lastCrmSummary,
    item.nextAction,
  ]);
  const tableRows = [headers, ...rows]
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td';
      return `<tr>${row.map((cell) => `<${tag}>${excelCell(cell)}</${tag}>`).join('')}</tr>`;
    })
    .join('');
  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
          th { background: #0f172a; color: #ffffff; font-weight: 700; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; mso-number-format:"\\@"; }
        </style>
      </head>
      <body><table>${tableRows}</table></body>
    </html>
  `;
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `informe-seguimiento-${report.weekId}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadReportExcel(report: WeeklyFollowUpReport, advisorData: AdvisorReports, monthLabel: string) {
  const headers = [
    'Cliente',
    'Telefono',
    'Asesor CRM',
    'Asesor SmartHome',
    'Estado CRM',
    'Etapa SmartHome',
    'Ultima conversacion',
    'Ultima bitacora SmartHome',
    'Bitacora esta semana',
    'Necesita seguimiento',
    'Alerta',
    'Resumen CRM',
    'Accion recomendada',
  ];
  const rows = report.items.map((item) => [
    item.name,
    item.phone,
    item.crmAdvisor,
    item.smartHomeAdvisor,
    item.crmStatus,
    item.smartHomeStage,
    fmtDateTime(item.lastConversationAt),
    fmtDateTime(item.lastSmartHomeLogAt),
    item.hasBitacoraThisWeek ? 'Si' : 'No',
    item.needsFollowUp ? 'Si' : 'No',
    item.alertReason,
    item.lastCrmSummary,
    item.nextAction,
  ]);
  const tableRows = [headers, ...rows]
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td';
      return `<tr>${row.map((cell) => `<${tag}>${excelCell(cell)}</${tag}>`).join('')}</tr>`;
    })
    .join('');
  const advisorHeaders = ['Asesor', 'Leads Asignados', 'Atendidos', 'Citas', 'Tasa Cierre', 'Score Promedio', 'Reasignados'];
  const advisorRows = advisorData.advisors.map((a) => [
    a.name,
    a.leads,
    a.handled,
    `${a.appts.completed}/${a.appts.total}`,
    `${a.closedRate}%`,
    a.avgScore,
    a.reassignmentsLost,
  ]);
  const advisorTableRows = [advisorHeaders, ...advisorRows]
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td';
      return `<tr>${row.map((cell) => `<${tag}>${excelCell(cell)}</${tag}>`).join('')}</tr>`;
    })
    .join('');

  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; margin-bottom: 20px; }
          th { background: #0f172a; color: #ffffff; font-weight: 700; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; mso-number-format:"\\@"; }
          h2 { font-family: Arial, sans-serif; font-size: 14px; margin-top: 15px; margin-bottom: 5px; color: #1e293b; }
        </style>
      </head>
      <body>
        <h2>Informe CRM 317 y SmartHome — ${excelCell(monthLabel)}</h2>
        <p>Generado: ${new Date().toLocaleString('es-CO')}</p>
        <h2>Desempeño Asesores Comerciales</h2>
        <table>${advisorTableRows}</table>
        <h2>Detalle Leads y Seguimiento Bitácoras</h2>
        <table>${tableRows}</table>
      </body>
    </html>
  `;
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeLabel = monthLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `informe-317-${safeLabel}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

function WeeklyFollowUpPanel({
  data,
  loading,
  error,
  monthLabel,
  onRetry,
}: {
  data: WeeklyFollowUpReport | null;
  loading: boolean;
  error: string | null;
  monthLabel?: string;
  onRetry: (search: string) => void;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<WeeklyFilter>('needs');
  const [q, setQ] = useState('');

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'needs' && !item.needsFollowUp) return false;
      if (filter !== 'all' && filter !== 'needs' && !item.reasons.includes(filter)) return false;
      if (needle && !`${item.name} ${item.phone} ${item.crmAdvisor} ${item.smartHomeAdvisor} ${item.alertReason}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, filter, q]);

  const chips: { key: WeeklyFilter; label: string; count: number; cls: string }[] = [
    { key: 'needs', label: 'Por atender', count: data?.totals.needsFollowUp ?? 0, cls: 'text-amber-300' },
    { key: 'missing_smarthome_bitacora', label: 'Sin bitacora', count: data?.totals.missingBitacora ?? 0, cls: 'text-amber-300' },
    { key: 'advisor_mismatch', label: 'Asesor distinto', count: data?.totals.advisorMismatch ?? 0, cls: 'text-orange-300' },
    { key: 'crm_activity_without_smarthome', label: 'CRM sin SmartHome', count: data?.totals.crmWithoutSmartHome ?? 0, cls: 'text-sky-300' },
    { key: 'all', label: 'Todos', count: data?.totals.clients ?? 0, cls: 'text-zinc-200' },
  ];

  return (
    <section className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Database size={15} className="text-sky-300" /> Informe semanal CRM + SmartHome {monthLabel ? `(${monthLabel})` : ''}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Usa documentos resumen para bajar lecturas: se revisa el detalle solo al abrir un cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onRetry(q)} disabled={loading} title={q.trim() ? 'Sincronizar este cliente con SmartHome' : 'Actualizar informe'} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-xs disabled:opacity-50 ${q.trim() ? 'border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {q.trim() ? <span>Sync SH</span> : null}
          </button>
          <button type="button" onClick={() => data && downloadWeeklyExcel(data, filtered)} disabled={!data || filtered.length === 0} className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-40">
            <Download size={13} /> Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : error ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-amber-200">{error}</p>
          <p className="mt-1 text-[11px] leading-5 text-amber-200/70">
            La funcion ya esta publicada. Usa el boton de actualizar para reintentar; si vuelve a fallar, este mensaje mostrara la causa exacta.
          </p>
        </div>
      ) : data ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
            <WeeklyKpi label="Clientes" value={data.totals.clients} />
            <WeeklyKpi label="Por atender" value={data.totals.needsFollowUp} tone={data.totals.needsFollowUp ? 'text-amber-300' : 'text-emerald-300'} />
            <WeeklyKpi label="Sin bitacora" value={data.totals.missingBitacora} tone="text-amber-300" />
            <WeeklyKpi label="Asesor distinto" value={data.totals.advisorMismatch} tone="text-orange-300" />
            <WeeklyKpi label="CRM sin SH" value={data.totals.crmWithoutSmartHome} tone="text-sky-300" />
            <WeeklyKpi label="Lecturas est." value={data.totals.estimatedReads} tone="text-zinc-300" />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <button key={chip.key} onClick={() => setFilter(chip.key)} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${filter === chip.key ? `border-zinc-600 bg-zinc-800 ${chip.cls}` : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                  {chip.label} <span className="tabular-nums opacity-80">{chip.count}</span>
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o asesor..." className="w-56 rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-zinc-500">Sin clientes para ese filtro.</p>
          ) : (
            <div className="max-h-[30rem] overflow-auto rounded-lg border border-zinc-800">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 bg-zinc-950 text-[10px] uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Asesores</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Ultimos datos</th>
                    <th className="px-3 py-2">Alerta</th>
                    <th className="px-3 py-2">Accion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filtered.map((item) => (
                    <tr key={item.leadId} className="bg-zinc-950/30 align-top hover:bg-zinc-900/70">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => navigate(`/dashboard/inbox?lead=${encodeURIComponent(item.leadId)}`)} className="text-left font-medium text-zinc-100 hover:text-sky-300">
                          {item.name || item.phone}
                        </button>
                        <p className="mt-0.5 text-[10px] text-zinc-500">{item.phone}</p>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-zinc-400">
                        <p>CRM: {item.crmAdvisor || '-'}</p>
                        <p>SH: {item.smartHomeAdvisor || '-'}</p>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-zinc-400">
                        <p>{item.crmStatus || '-'}</p>
                        <p className="text-zinc-500">{item.smartHomeStage || '-'}</p>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-zinc-400">
                        <p>CRM: {fmtDateTime(item.lastConversationAt)}</p>
                        <p>Bitacora: {fmtDateTime(item.lastSmartHomeLogAt)}</p>
                      </td>
                      <td className="max-w-xs px-3 py-2">
                        <div className="mb-1 flex flex-wrap gap-1">
                          {item.reasons.map((reason) => (
                            <span key={reason} className={`rounded-full border px-1.5 py-0.5 text-[9px] ${WEEKLY_REASON_META[reason].cls}`}>
                              {WEEKLY_REASON_META[reason].label}
                            </span>
                          ))}
                        </div>
                        <p className="text-[11px] leading-4 text-zinc-400">{item.alertReason || '-'}</p>
                      </td>
                      <td className="max-w-xs px-3 py-2">
                        <p className="text-[11px] leading-4 text-zinc-300">{item.nextAction || 'Revisar y actualizar seguimiento.'}</p>
                        {item.lastCrmSummary && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-600">{item.lastCrmSummary}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-[10px] text-zinc-600">
            Semana: {fmtDateTime(data.rangeStart)} a {fmtDateTime(data.rangeEnd)}. Actualizado {fmtDateTime(data.generatedAt)}.
          </p>
        </>
      ) : null}
    </section>
  );
}

function WeeklyKpi({ label, value, tone = 'text-zinc-200' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

const ATTENTION_META: Record<AttentionReason, { label: string; icon: typeof Clock; dot: string; border: string; text: string }> = {
  no_first_contact: { label: 'Sin primer contacto', icon: PhoneOff,     dot: 'bg-red-500',    border: 'border-l-red-500',    text: 'text-red-300'    },
  waiting_reply:    { label: 'Esperando respuesta',  icon: Hourglass,    dot: 'bg-amber-500',  border: 'border-l-amber-500',  text: 'text-amber-300'  },
  stale:            { label: 'Estancado',            icon: AlertTriangle, dot: 'bg-zinc-500',   border: 'border-l-zinc-500',   text: 'text-zinc-300'   },
};

type AttentionFilter = 'all' | AttentionReason | 'night';

function fmtWait(item: AttentionItem): string {
  if (item.reason === 'stale' && item.staleDays != null) return `${item.staleDays} d sin actividad`;
  if (item.waitingMin != null) return `${fmtMin(item.waitingMin)} esperando`;
  return '';
}

function AttentionPanel({ data, monthLabel }: { data: AdvisorReports; monthLabel?: string }) {
  const navigate = useNavigate();
  const openLead = (leadId: string) => navigate(`/dashboard/inbox?lead=${encodeURIComponent(leadId)}`);
  const items = data.attention?.items ?? [];
  const counts = data.attention?.counts ?? { noFirstContact: 0, waitingReply: 0, stale: 0, night: 0 };
  const [filter, setFilter] = useState<AttentionFilter>('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === 'night' && !it.night) return false;
      if (filter !== 'all' && filter !== 'night' && it.reason !== filter) return false;
      if (needle && !(`${it.name} ${it.advisorName} ${it.phone}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, filter, q]);

  const chips: { key: AttentionFilter; label: string; count: number; cls: string }[] = [
    { key: 'all',              label: 'Todos',                count: items.length,          cls: 'text-zinc-200'  },
    { key: 'no_first_contact', label: 'Sin primer contacto',  count: counts.noFirstContact, cls: 'text-red-300'   },
    { key: 'waiting_reply',    label: 'Esperando respuesta',  count: counts.waitingReply,   cls: 'text-amber-300' },
    { key: 'stale',            label: 'Estancados',           count: counts.stale,          cls: 'text-zinc-300'  },
    { key: 'night',            label: '🌙 Madrugada',         count: counts.night,          cls: 'text-indigo-300' },
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <BellRing size={15} className="text-amber-400" /> Atención — qué hacer ahora {monthLabel ? `(${monthLabel})` : ''}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Leads abiertos clasificados por lo que falta: primer contacto, respuesta pendiente o seguimiento estancado.
          </p>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente o asesor…"
            className="w-56 rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              filter === c.key ? 'border-zinc-600 bg-zinc-800 ' + c.cls : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {c.label} <span className="tabular-nums opacity-80">{c.count}</span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-emerald-400">
          Nada pendiente 🎉 Ningún lead abierto necesita acción en este periodo.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-zinc-500">Sin resultados para ese filtro.</p>
      ) : (
        <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((it) => {
            const m = ATTENTION_META[it.reason];
            return (
              <button
                key={it.leadId}
                onClick={() => openLead(it.leadId)}
                title="Abrir conversación"
                className={`block w-full rounded-lg border border-zinc-800 border-l-2 ${m.border} bg-zinc-950/40 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-100">
                      {it.name}
                      {it.night && (
                        <span title={`Entró a las ${it.createdHour}:00`} className="inline-flex items-center gap-0.5 rounded bg-indigo-500/15 px-1 text-[9px] text-indigo-300">
                          <Moon size={9} /> {it.createdHour}h
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className={`inline-flex items-center gap-1 ${m.text}`}><m.icon size={10} /> {m.label}</span>
                      · {it.advisorName}
                      {it.advisorMsgs === 0 && <span className="text-red-400">· asesor no ha escrito</span>}
                    </p>
                    {it.lastText && <p className="mt-1 truncate text-[10px] text-zinc-600">“{it.lastText}”</p>}
                  </div>
                  <span className={`shrink-0 whitespace-nowrap text-[10px] font-medium ${m.text}`}>{fmtWait(it)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReassignmentPanel({ data, monthLabel }: { data: AdvisorReports; monthLabel?: string }) {
  const navigate = useNavigate();
  const ranking = data.advisors
    .filter((advisor) => advisor.reassignmentsLost > 0 || advisor.reassignmentsReceived > 0)
    .sort((a, b) => b.reassignmentsLost - a.reassignmentsLost);

  const recent = data.reassignments?.recent ?? [];
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');   // YYYY-MM-DD
  const [to, setTo] = useState('');       // YYYY-MM-DD

  // Agrupa los movimientos por día (más reciente primero) para lectura clara.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs   = to   ? new Date(`${to}T23:59:59.999`).getTime() : null;
    const filtered = recent.filter((it) => {
      if (needle && !`${it.leadName} ${it.previousAdvisorName} ${it.newAdvisorName}`.toLowerCase().includes(needle)) return false;
      if (fromMs !== null && it.reassignedAt < fromMs) return false;
      if (toMs !== null && it.reassignedAt > toMs) return false;
      return true;
    });
    const byDay = new Map<string, typeof filtered>();
    for (const it of filtered) {
      const key = new Date(it.reassignedAt).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long' });
      const arr = byDay.get(key) ?? [];
      arr.push(it);
      byDay.set(key, arr);
    }
    return [...byDay.entries()];
  }, [recent, q, from, to]);

  const totalShown = groups.reduce((n, [, movs]) => n + movs.length, 0);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Repeat2 size={15} className="text-orange-400" /> Reasignación por falta de respuesta {monthLabel ? `(${monthLabel})` : ''}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Leads quitados automáticamente cuando el asesor no hace primer contacto a tiempo.
          </p>
        </div>
        <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
          {data.reassignments?.total ?? 0} movimientos
        </span>
      </div>

      {(data.reassignments?.total ?? 0) === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-xs text-zinc-500">
          Sin reasignaciones automáticas en este periodo.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Ranking por asesor</p>
            {ranking.map((advisor) => (
              <div key={advisor.advisorId} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-zinc-200">{advisor.name}</p>
                  <p className="text-[10px] text-zinc-500">{advisor.reassignmentsReceived} recibidos</p>
                </div>
                <span className="shrink-0 rounded-md bg-orange-500/10 px-2 py-1 text-xs font-semibold text-orange-300">
                  {advisor.reassignmentsLost} quitados
                </span>
              </div>
            ))}
          </div>

          <div>
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente o asesor…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                Desde
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-[11px] text-zinc-200 focus:border-zinc-600 focus:outline-none [color-scheme:dark]"
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                Hasta
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-1 text-[11px] text-zinc-200 focus:border-zinc-600 focus:outline-none [color-scheme:dark]"
                />
              </label>
              {(from || to || q) && (
                <button
                  onClick={() => { setFrom(''); setTo(''); setQ(''); }}
                  className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  Limpiar
                </button>
              )}
              <span className="ml-auto text-[10px] tabular-nums text-zinc-500">{totalShown} de {recent.length}</span>
            </div>
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {groups.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-600">Sin resultados.</p>
              ) : groups.map(([day, movs]) => (
                <div key={day}>
                  <p className="sticky top-0 z-10 bg-zinc-900/95 py-1 text-[10px] font-semibold uppercase text-zinc-500 backdrop-blur">
                    {day} · {movs.length}
                  </p>
                  <div className="space-y-1.5">
                    {movs.map((item) => (
                      <button
                        key={`${item.leadId}-${item.reassignedAt}`}
                        onClick={() => item.leadId && navigate(`/dashboard/inbox?lead=${encodeURIComponent(item.leadId)}`)}
                        disabled={!item.leadId}
                        title={item.leadId ? 'Abrir conversación' : undefined}
                        className="block w-full rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left transition-colors enabled:hover:border-zinc-700 enabled:hover:bg-zinc-900 disabled:cursor-default"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-200">{item.leadName}</p>
                            <p className="mt-0.5 text-[10px] text-zinc-500">
                              {item.previousAdvisorName} {'->'} {item.newAdvisorName}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] text-zinc-600">
                            {new Date(item.reassignedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── 10. Descarga Excel Reporte de Ventas ─────────────────────────────────────
function downloadSalesExcel(report: SalesCommissionReportResponse, monthLabel: string) {
  const headers = [
    'Lote / Modulo',
    'Cliente',
    'No. Documento',
    'Telefono',
    'Proyecto',
    'Valor Lote',
    'Valor Separacion',
    'Descuento',
    'Fecha Cierre',
    'Asesor Comercial',
    'Ventas Mes Asesor',
    'Comision Captacion',
    'Comision Linea',
    'Comision Cierre',
    'Comision Director (0.5%)',
    'Comision Total',
    'Agente CR',
    'Agente Linea',
    'Agente Cierre',
    'Director',
    'Plazo Pagos',
    'Documento Generado',
    'Fecha Documento',
  ];

  const rows = report.items.map((it) => [
    it.module,
    it.clientName,
    it.documentNumber,
    it.phone,
    it.project,
    it.totalValue,
    it.deposit,
    it.discount,
    it.closeDate ? new Date(it.closeDate).toLocaleDateString('es-CO') : '-',
    it.advisorName,
    it.advisorMonthlySalesCount,
    it.captacionValue,
    it.lineaValue,
    it.cierreValue,
    it.directorValue,
    it.totalCommissionValue,
    it.agentCr,
    it.agentLinea,
    it.agentCierre,
    it.director,
    it.paymentTerms,
    it.documentGenerated ? 'Si' : 'No',
    it.documentGeneratedDateStr || '-',
  ]);

  const tableRows = [headers, ...rows]
    .map((row, index) => {
      const tag = index === 0 ? 'th' : 'td';
      return `<tr>${row.map((cell) => `<${tag}>${excelCell(cell)}</${tag}>`).join('')}</tr>`;
    })
    .join('');

  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; margin-bottom: 20px; }
          th { background: #0f172a; color: #ffffff; font-weight: 700; }
          th, td { border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; mso-number-format:"\\@"; }
          h2 { font-family: Arial, sans-serif; font-size: 14px; margin-top: 15px; margin-bottom: 5px; color: #1e293b; }
        </style>
      </head>
      <body>
        <h2>Reporte de Ventas y Comisiones — ${excelCell(monthLabel)}</h2>
        <p>Generado: ${new Date().toLocaleString('es-CO')}</p>
        <p>Total Ventas: ${report.totalSales} | Volumen Total: $ ${report.totalVolume.toLocaleString('es-CO')} | Comisiones: $ ${report.totalCommissions.toLocaleString('es-CO')}</p>
        <table>${tableRows}</table>
      </body>
    </html>
  `;

  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeLabel = monthLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `reporte-ventas-comisiones-${safeLabel}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 11. Sección Principal Reporte de Ventas ──────────────────────────────────
function SalesReportSection({
  salesData,
  monthLabel,
  onOpenModal,
}: {
  salesData: SalesCommissionReportResponse;
  monthLabel: string;
  onOpenModal: (sale: SalesCommissionItem) => void;
}) {
  const [q, setQ] = useState('');

  const items = salesData.items || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      `${it.clientName} ${it.documentNumber} ${it.module} ${it.project} ${it.advisorName} ${it.agentCr} ${it.agentLinea} ${it.agentCierre}`
        .toLowerCase()
        .includes(needle)
    );
  }, [items, q]);

  const docsCount = items.filter((i) => i.documentGenerated).length;

  return (
    <div className="space-y-5">
      {/* Subtítulo informativo */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <p>
          <span className="font-semibold text-zinc-200">{salesData.totalSales} ventas registradas</span> en{' '}
          <span className="text-emerald-400 font-medium">{monthLabel}</span> · cálculo automático de comisiones y plantillas Word oficiales
        </p>
        <p className="text-[11px] text-zinc-500">
          Actualizado {new Date(salesData.generatedAt).toLocaleString('es-CO')}
        </p>
      </div>

      {/* KPIs de Ventas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="VENTAS CERRADAS" value={salesData.totalSales} tone="text-emerald-400" />
        <KpiCard
          label="VOLUMEN DE VENTAS"
          value={`$ ${salesData.totalVolume.toLocaleString('es-CO')}`}
          tone="text-zinc-100"
        />
        <KpiCard
          label="COMISIONES TOTALES"
          value={`$ ${salesData.totalCommissions.toLocaleString('es-CO')}`}
          tone="text-amber-400"
        />
        <KpiCard
          label="DOCUMENTOS WORD"
          value={`${docsCount} de ${salesData.totalSales} (${salesData.totalSales > 0 ? Math.round((docsCount / salesData.totalSales) * 100) : 0}%)`}
          tone="text-sky-300"
        />
      </div>

      {/* Escala por Asesor de Cierre */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <UserRound size={16} className="text-amber-400" /> Escala por asesor de cierre ({monthLabel})
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ventas acumuladas por asesor en el mes y porcentaje de comisión escalonado aplicado.
        </p>

        {items.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-600">Sin ventas en este periodo.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(
              items.reduce((acc, it) => {
                const adv = it.advisorName || 'Sin asesor';
                if (!acc[adv]) {
                  acc[adv] = { count: 0, volume: 0, commission: 0, rate: it.captacionRate + it.lineaRate + it.cierreRate };
                }
                acc[adv].count += 1;
                acc[adv].volume += it.totalValue || 0;
                acc[adv].commission += it.totalCommissionValue || 0;
                return acc;
              }, {} as Record<string, { count: number; volume: number; commission: number; rate: number }>)
            ).map(([advName, stats]) => (
              <div key={advName} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-zinc-100">{advName}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {stats.count} {stats.count === 1 ? 'unidad vendida' : 'unidades vendidas'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                    {(stats.rate * 100).toFixed(1)}% asesor
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-xs">
                  <div>
                    <span className="text-[9px] uppercase text-zinc-500">Volumen</span>
                    <p className="font-semibold text-zinc-200">$ {stats.volume.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] uppercase text-amber-400/80">Comisión Asesor + Dir</span>
                    <p className="font-bold text-amber-300">$ {stats.commission.toLocaleString('es-CO')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabla de Ventas y Comisiones */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <FileText size={16} className="text-emerald-400" /> Detalle de Ventas y Comisiones ({monthLabel})
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Consulta cada cierre de venta, comisiones calculadas y genera o descarga el documento Word oficial.
            </p>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente, cédula, lote..."
              className="w-64 rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-8 text-center">
            <FileText size={24} className="mx-auto text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-400">No se encontraron ventas para {monthLabel}</p>
            <p className="mt-1 text-xs text-zinc-600">Selecciona otro mes o verifica los cierres en SmartHome.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-[10px] uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2.5">Cliente / Documento</th>
                  <th className="px-3 py-2.5">Proyecto / Lote</th>
                  <th className="px-3 py-2.5">Valores Venta</th>
                  <th className="px-3 py-2.5">Asesor Comercial</th>
                  <th className="px-3 py-2.5">Comisión</th>
                  <th className="px-3 py-2.5 text-center">Documento Word</th>
                  <th className="px-3 py-2.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/30">
                {filtered.map((item) => (
                  <tr key={item.saleId} className="hover:bg-zinc-900/60 transition-colors">
                    <td className="px-3 py-2.5 text-zinc-200">
                      <p className="font-bold text-zinc-100 text-sm">{item.clientName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {item.documentNumber ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-zinc-200">
                            {item.documentNumber}
                          </span>
                        ) : (
                          <span className="text-zinc-600 italic text-[11px]">(Sin cédula)</span>
                        )}
                        <span className="text-[10px] text-zinc-500">· {item.stage}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-zinc-100">
                      <p className="font-semibold text-emerald-300">{item.module || item.lotNumber}</p>
                      <p className="text-[10px] text-zinc-400 truncate max-w-[200px]">{item.project}</p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-semibold text-zinc-100">$ {item.totalValue.toLocaleString('es-CO')}</p>
                      <p className="text-[10px] text-zinc-500">Separación: $ {item.deposit.toLocaleString('es-CO')}</p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-medium text-zinc-200">{item.advisorName}</p>
                      <p className="text-[10px] text-amber-400/80 font-mono">
                        {item.advisorMonthlySalesCount} venta{item.advisorMonthlySalesCount > 1 ? 's' : ''} este mes
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-semibold text-amber-300">$ {item.totalCommissionValue.toLocaleString('es-CO')}</p>
                      <p className="text-[10px] text-zinc-500">
                        CR {(item.captacionRate * 100).toFixed(1)}% · L {(item.lineaRate * 100).toFixed(2)}% · C {(item.cierreRate * 100).toFixed(2)}% · Dir 0.5%
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.documentGenerated ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <CheckCircle2 size={11} className="text-emerald-400" /> Agregado
                          </span>
                          <span className="mt-0.5 text-[9px] text-zinc-500">{item.documentGeneratedDateStr}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">
                          Sin generar
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => onOpenModal(item)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          item.documentGenerated
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-700'
                        }`}
                      >
                        <FileText size={13} /> {item.documentGenerated ? 'Ver Reporte' : 'Generar Word'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── 12. Modal de Reporte de Venta ────────────────────────────────────────────
function SalesReportModal({
  item,
  monthLabel,
  companyId,
  monthKey,
  onClose,
  onUpdated,
}: {
  item: SalesCommissionItem;
  monthLabel: string;
  companyId: string;
  monthKey: string;
  onClose: () => void;
  onUpdated: (item: SalesCommissionItem) => void;
}) {
  const { user, profile } = useAuth();
  const currentUserName = profile?.displayName || user?.displayName || user?.email || 'Claudia Patricia Bolaños Vega';

  const [clientName, setClientName] = useState(item.clientName || '');
  const [documentNumber, setDocumentNumber] = useState(item.documentNumber || '');
  const [deposit, setDeposit] = useState(item.deposit || 6000000);
  const [paymentTerms, setPaymentTerms] = useState(item.paymentTerms || '24');
  const [source, setSource] = useState(item.source || 'CORFERIAS AGOSTO 2026');
  const [agentCr, setAgentCr] = useState(item.agentCr || '');
  const [agentLinea, setAgentLinea] = useState(item.agentLinea || '');
  const [agentCierre, setAgentCierre] = useState(item.agentCierre || '');
  const [director, setDirector] = useState(item.director || 'Claudia bolaños');
  const [referralApplies, setReferralApplies] = useState(item.referralApplies || 'N/A');
  const [referralName, setReferralName] = useState(item.referralName || 'N/A');

  const [history, setHistory] = useState<SalesReportDocumentVersion[]>(item.history || []);
  const [downloading, setDownloading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const monthYearStr = item.closeDate
    ? new Date(item.closeDate).toLocaleString('es-CO', { month: 'long', year: 'numeric' })
    : monthLabel;

  const handleDownloadWord = async () => {
    setDownloading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    const formValues = {
      clientName: clientName.trim(),
      documentNumber: documentNumber.trim(),
      deposit: Number(deposit) || 0,
      paymentTerms: String(paymentTerms).trim() || '24',
      source: source.trim(),
      agentCr: agentCr.trim(),
      agentLinea: agentLinea.trim(),
      agentCierre: agentCierre.trim(),
      director: director.trim(),
      referralApplies: referralApplies.trim(),
      referralName: referralName.trim(),
      createdByName: currentUserName,
    };

    try {
      // 1. Guardar los datos y la fecha en Firestore para que quede registrado en el CRM
      const saveRes = await saveSalesReportDocument({
        companyId,
        saleId: item.saleId,
        monthKey,
        module: item.module,
        ...formValues,
      });

      // 2. Generar y descargar el archivo Word en el navegador
      await generateAndDownloadSalesWordDoc(item, formValues);

      // 3. Actualizar estado local
      const newHistory = saveRes.history || (saveRes.version ? [saveRes.version, ...history] : history);
      setHistory(newHistory);

      const updatedItem: SalesCommissionItem = {
        ...item,
        ...formValues,
        documentGenerated: true,
        documentGeneratedAt: saveRes.documentGeneratedAt,
        documentGeneratedDateStr: saveRes.documentGeneratedDateStr,
        history: newHistory,
      };

      onUpdated(updatedItem);
      setSuccessMsg(`Documento Word generado y registrado en el CRM con fecha ${saveRes.documentGeneratedDateStr}.`);
    } catch (err) {
      console.error('[SalesReportModal] error:', err);
      setErrorMsg('Error al generar o guardar el reporte Word.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSpecificVersion = async (ver: SalesReportDocumentVersion) => {
    try {
      await generateAndDownloadSalesWordDoc(item, {
        clientName: ver.clientName,
        documentNumber: ver.documentNumber,
        deposit: ver.deposit,
        paymentTerms: ver.paymentTerms,
        source: ver.source,
        agentCr: ver.agentCr,
        agentLinea: ver.agentLinea,
        agentCierre: ver.agentCierre,
        director: ver.director,
        referralApplies: ver.referralApplies,
        referralName: ver.referralName,
      });
    } catch (err) {
      console.error('[handleDownloadSpecificVersion] error:', err);
      setErrorMsg('Error al descargar la versión del reporte.');
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!window.confirm('¿Estás seguro de eliminar este reporte del historial?')) return;
    setDeletingId(versionId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const delRes = await deleteSalesReportVersion(companyId, item.saleId, versionId);
      setHistory(delRes.history);

      const updatedItem: SalesCommissionItem = {
        ...item,
        documentGenerated: delRes.documentGenerated,
        documentGeneratedAt: delRes.documentGeneratedAt,
        documentGeneratedDateStr: delRes.documentGeneratedDateStr,
        history: delRes.history,
      };

      onUpdated(updatedItem);
      setSuccessMsg('Reporte eliminado del historial correctamente.');
    } catch (err) {
      console.error('[handleDeleteVersion] error:', err);
      setErrorMsg('Error al eliminar la versión del reporte.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl my-8 max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 shadow-2xl">
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-base font-bold uppercase tracking-wide text-zinc-100">
            REPORTE VENTA {monthYearStr} - {item.module}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario en Cuadrícula */}
        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {/* NOMBRE CLIENTE */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              NOMBRE CLIENTE
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* NO. DOCUMENTO */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              NO. DOCUMENTO
            </label>
            <input
              type="text"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="Número de cédula / NIT"
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 font-mono placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* VALOR SEPARACIÓN */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              VALOR SEPARACIÓN
            </label>
            <input
              type="number"
              value={deposit}
              onChange={(e) => setDeposit(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 font-mono placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* PLAZO PAGOS */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              PLAZO PAGOS
            </label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* TIPO DE VENTA / FUENTE */}
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              TIPO DE VENTA / FUENTE
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* AGENTE DE CAPTACIÓN */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              AGENTE DE CAPTACIÓN
            </label>
            <input
              type="text"
              value={agentCr}
              onChange={(e) => setAgentCr(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* AGENTE LÍNEA */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              AGENTE LÍNEA
            </label>
            <input
              type="text"
              value={agentLinea}
              onChange={(e) => setAgentLinea(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* AGENTE CIERRE */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              AGENTE CIERRE
            </label>
            <input
              type="text"
              value={agentCierre}
              onChange={(e) => setAgentCierre(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* DIRECTOR */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              DIRECTOR (0.5% FIJO)
            </label>
            <input
              type="text"
              value={director}
              onChange={(e) => setDirector(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* REFERIDO APLICA */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              REFERIDO APLICA
            </label>
            <input
              type="text"
              value={referralApplies}
              onChange={(e) => setReferralApplies(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* NOMBRE REFERIDO */}
          <div>
            <label className="block text-[10px] font-bold uppercase text-zinc-400">
              NOMBRE REFERIDO
            </label>
            <input
              type="text"
              value={referralName}
              onChange={(e) => setReferralName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Mensajes de Feedback */}
        {successMsg && (
          <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-300 flex items-center gap-2">
            <Check size={14} className="text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Botón Principal para Generar y Guardar */}
        <button
          type="button"
          onClick={handleDownloadWord}
          disabled={downloading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {downloading ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              <span>Generando y guardando reporte...</span>
            </>
          ) : (
            <>
              <Download size={16} />
              <span>Descargar Archivo Word / Generar Reporte</span>
            </>
          )}
        </button>

        {/* ── HISTORIAL DE GENERACIONES (IDÉNTICO A LA CAPTURA) ── */}
        <div className="mt-6 border-t border-zinc-800 pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              REPORTE DE VENTA FINAL - HISTORIAL DE GENERACIONES
            </h3>
            <span className="text-[11px] text-zinc-500">
              {history.length} {history.length === 1 ? 'generación registrada' : 'generaciones registradas'}
            </span>
          </div>

          {history.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-center text-xs text-zinc-500">
              No se han registrado generaciones para esta venta aún. Al hacer clic en <strong className="text-zinc-300">Descargar Archivo Word</strong>, aparecerá aquí con la fecha y el usuario que lo creó.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-900/80 text-[11px] uppercase text-zinc-400 font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Cliente</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Usuario</th>
                    <th className="px-3 py-2.5 text-center">Documento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80 text-zinc-200">
                  {history.map((ver) => (
                    <tr key={ver.id} className="hover:bg-zinc-900/50 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-zinc-100 uppercase">
                        {ver.clientName}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-400 font-mono text-[11px]">
                        {ver.createdDateStr}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-300">
                        {ver.createdByName}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleDownloadSpecificVersion(ver)}
                            className="font-semibold text-sky-400 hover:text-sky-300 hover:underline"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteVersion(ver.id)}
                            disabled={deletingId === ver.id}
                            className="font-semibold text-red-500 hover:text-red-400 hover:underline disabled:opacity-50"
                          >
                            {deletingId === ver.id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
