import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, RefreshCw, Settings, ChevronLeft, ChevronRight,
  Sparkles, Users, AlertCircle
} from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { fetchCommercialLeaderboard } from '../services/commercialGoals.service';
import { CommercialGoalsConfigModal } from './CommercialGoalsConfigModal';
import type { CommercialLeaderboardResponse } from '../types/commercialGoals.types';

interface CommercialLeaderboardProps {
  companyId: string;
  isAdmin: boolean;
  currentUserId?: string;
}

export function CommercialLeaderboard({
  companyId,
  isAdmin,
  currentUserId,
}: CommercialLeaderboardProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState<string>(() => {
    const now = new Date();
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  });
  const [data, setData] = useState<CommercialLeaderboardResponse | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'my'>('all');

  const loadLeaderboard = useCallback(async (isSilent = false) => {
    if (!companyId) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await fetchCommercialLeaderboard(companyId, monthKey);
      setData(res);
    } catch (err: any) {
      console.error('[CommercialLeaderboard] Error cargando ranking:', err);
      setError(err?.message || 'No se pudo cargar el tablero de metas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId, monthKey]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const changeMonth = (offset: number) => {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + offset, 1);
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    setMonthKey(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 space-y-3">
        <Spinner size="lg" />
        <p className="text-xs text-zinc-400">Calculando metas y ranking del equipo...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl max-w-md mx-auto text-xs flex items-center gap-2 justify-center">
          <AlertCircle size={16} />
          <span>{error || 'Error desconocido al cargar las metas.'}</span>
        </div>
        <button
          type="button"
          onClick={() => loadLeaderboard()}
          className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const advisors = data.leaderboard || [];
  const top1 = advisors[0];
  const top2 = advisors[1];
  const top3 = advisors[2];

  const displayedAdvisors = selectedFilter === 'my' && currentUserId
    ? advisors.filter((a) => a.advisorId === currentUserId)
    : advisors;

  const totals = data.companyTotals;

  return (
    <div className="space-y-6">
      {/* ── Barra Superior: Mes & Acciones ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-3xl bg-zinc-900/70 border border-zinc-800/80 shadow-md">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Trophy size={22} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-1.5">
                <span>Tablero de Metas & Ranking</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-600/20 text-violet-300 border border-violet-500/30 font-semibold font-mono">
                  {data.monthLabel}
                </span>
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Rendimiento en ventas, visitas presenciales a terreno y citas virtuales.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Navegador de meses */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1 shadow-inner">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition"
              title="Mes anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-semibold text-zinc-200 px-3 min-w-[100px] text-center">
              {data.monthLabel}
            </span>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition"
              title="Mes siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Botón Administrador: Configurar Metas */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 text-xs font-semibold transition cursor-pointer shadow-sm"
              title="Ajustar metas mensuales de ventas y visitas"
            >
              <Settings size={14} />
              <span>Configurar Metas</span>
            </button>
          )}

          {/* Botón Refrescar */}
          <button
            type="button"
            onClick={() => loadLeaderboard(true)}
            disabled={refreshing}
            className="p-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition cursor-pointer"
            title="Actualizar datos"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Resumen de Metas Globales del Equipo ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metas Ventas */}
        <div className="p-4 rounded-3xl bg-zinc-900/60 border border-emerald-500/20 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <span>🎯</span>
              <span>Ventas / Lotes</span>
            </span>
            <span className="text-[11px] font-mono font-bold text-emerald-400">
              {totals.totalVentas} / {totals.targetVentas}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-100 font-mono">
              {totals.totalVentas}
            </span>
            <span className="text-xs text-emerald-400 font-semibold font-mono">
              ({totals.targetVentas > 0 ? Math.round((totals.totalVentas / totals.targetVentas) * 100) : 100}%)
            </span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, totals.targetVentas > 0 ? (totals.totalVentas / totals.targetVentas) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>

        {/* Metas Visitas Terreno */}
        <div className="p-4 rounded-3xl bg-zinc-900/60 border border-blue-500/20 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <span>🏡</span>
              <span>Visitas Terreno</span>
            </span>
            <span className="text-[11px] font-mono font-bold text-blue-400">
              {totals.totalVisitas} / {totals.targetVisitas}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-100 font-mono">
              {totals.totalVisitas}
            </span>
            <span className="text-xs text-blue-400 font-semibold font-mono">
              ({totals.targetVisitas > 0 ? Math.round((totals.totalVisitas / totals.targetVentas > 0 ? (totals.totalVisitas / totals.targetVisitas) * 100 : 100)) : 100}%)
            </span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, totals.targetVisitas > 0 ? (totals.totalVisitas / totals.targetVisitas) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>

        {/* Metas Citas Virtuales */}
        <div className="p-4 rounded-3xl bg-zinc-900/60 border border-violet-500/20 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <span>🎥</span>
              <span>Citas Virtuales</span>
            </span>
            <span className="text-[11px] font-mono font-bold text-violet-400">
              {totals.totalCitas} / {totals.targetCitas}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-100 font-mono">
              {totals.totalCitas}
            </span>
            <span className="text-xs text-violet-400 font-semibold font-mono">
              ({totals.targetCitas > 0 ? Math.round((totals.totalCitas / totals.targetCitas) * 100) : 100}%)
            </span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-violet-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, totals.targetCitas > 0 ? (totals.totalCitas / totals.targetCitas) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>

        {/* Metas Gestiones / Bitácoras */}
        <div className="p-4 rounded-3xl bg-zinc-900/60 border border-amber-500/20 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <span>⚡</span>
              <span>Gestiones Hechas</span>
            </span>
            <span className="text-[11px] font-mono font-bold text-amber-400">
              {totals.totalGestiones} / {totals.targetGestiones}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-100 font-mono">
              {totals.totalGestiones}
            </span>
            <span className="text-xs text-amber-400 font-semibold font-mono">
              ({totals.targetGestiones > 0 ? Math.round((totals.totalGestiones / totals.targetGestiones) * 100) : 100}%)
            </span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, totals.targetGestiones > 0 ? (totals.totalGestiones / totals.targetGestiones) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Podio Comercial: Top 3 Asesores ── */}
      {advisors.length > 0 && (
        <div className="p-6 rounded-3xl bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-zinc-800/90 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-amber-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
                Podio de Honor del Mes
              </h3>
            </div>
            <span className="text-xs text-zinc-400 font-medium">
              Gamificación en tiempo real
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {/* 2do Lugar (Plata) */}
            {top2 ? (
              <div className="order-2 md:order-1 p-5 rounded-3xl bg-zinc-900/80 border border-slate-400/30 shadow-lg flex flex-col items-center text-center space-y-3 relative">
                <div className="w-14 h-14 rounded-full bg-slate-400/20 border-2 border-slate-300 text-slate-200 font-extrabold text-xl flex items-center justify-center shadow-md">
                  🥈
                </div>
                <div>
                  <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    2do Lugar
                  </span>
                  <h4 className="text-base font-bold text-zinc-100 truncate max-w-[200px]">
                    {top2.advisorName}
                  </h4>
                  <p className="text-xs text-zinc-400">{top2.score} pts</p>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full pt-2 border-t border-zinc-800 text-center">
                  <div>
                    <span className="block text-[10px] text-zinc-500">Ventas</span>
                    <span className="text-xs font-bold text-emerald-400">{top2.actuals.ventas}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-500">Visitas</span>
                    <span className="text-xs font-bold text-blue-400">{top2.actuals.visitas}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-500">Citas</span>
                    <span className="text-xs font-bold text-violet-400">{top2.actuals.citas}</span>
                  </div>
                </div>
              </div>
            ) : <div className="order-2 md:order-1 hidden md:block" />}

            {/* 1er Lugar (Oro) */}
            {top1 && (
              <div className="order-1 md:order-2 p-6 rounded-3xl bg-gradient-to-b from-amber-500/15 to-zinc-900 border-2 border-amber-500/50 shadow-2xl flex flex-col items-center text-center space-y-3 relative transform md:-translate-y-2">
                <div className="absolute -top-3.5 px-3 py-0.5 rounded-full bg-amber-500 text-zinc-950 font-extrabold text-[11px] uppercase tracking-wider shadow-md">
                  👑 Líder Comercial
                </div>
                <div className="w-18 h-18 rounded-full bg-amber-500/20 border-2 border-amber-400 text-amber-300 font-extrabold text-3xl flex items-center justify-center shadow-lg">
                  🥇
                </div>
                <div>
                  <span className="text-xs font-extrabold text-amber-400 uppercase tracking-widest">
                    1er Lugar
                  </span>
                  <h4 className="text-lg font-extrabold text-zinc-50 truncate max-w-[220px]">
                    {top1.advisorName}
                  </h4>
                  <p className="text-xs font-bold text-amber-300/90 font-mono">
                    {top1.score} puntos acumulados
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full pt-3 border-t border-amber-500/20 text-center">
                  <div className="p-1 rounded-xl bg-amber-500/10">
                    <span className="block text-[10px] text-zinc-400">Ventas</span>
                    <span className="text-sm font-extrabold text-emerald-400 font-mono">{top1.actuals.ventas}</span>
                  </div>
                  <div className="p-1 rounded-xl bg-amber-500/10">
                    <span className="block text-[10px] text-zinc-400">Visitas</span>
                    <span className="text-sm font-extrabold text-blue-400 font-mono">{top1.actuals.visitas}</span>
                  </div>
                  <div className="p-1 rounded-xl bg-amber-500/10">
                    <span className="block text-[10px] text-zinc-400">Citas</span>
                    <span className="text-sm font-extrabold text-violet-400 font-mono">{top1.actuals.citas}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3er Lugar (Bronce) */}
            {top3 ? (
              <div className="order-3 p-5 rounded-3xl bg-zinc-900/80 border border-amber-700/30 shadow-lg flex flex-col items-center text-center space-y-3 relative">
                <div className="w-14 h-14 rounded-full bg-amber-700/20 border-2 border-amber-600 text-amber-500 font-extrabold text-xl flex items-center justify-center shadow-md">
                  🥉
                </div>
                <div>
                  <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">
                    3er Lugar
                  </span>
                  <h4 className="text-base font-bold text-zinc-100 truncate max-w-[200px]">
                    {top3.advisorName}
                  </h4>
                  <p className="text-xs text-zinc-400">{top3.score} pts</p>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full pt-2 border-t border-zinc-800 text-center">
                  <div>
                    <span className="block text-[10px] text-zinc-500">Ventas</span>
                    <span className="text-xs font-bold text-emerald-400">{top3.actuals.ventas}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-500">Visitas</span>
                    <span className="text-xs font-bold text-blue-400">{top3.actuals.visitas}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-500">Citas</span>
                    <span className="text-xs font-bold text-violet-400">{top3.actuals.citas}</span>
                  </div>
                </div>
              </div>
            ) : <div className="order-3 hidden md:block" />}
          </div>
        </div>
      )}

      {/* ── Tabla Detallada & Tarjetas de Asesores ── */}
      <div className="p-5 rounded-3xl bg-zinc-900/70 border border-zinc-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Users size={16} className="text-violet-400" />
              <span>Desglose Individual de Cuotas & Rendimiento</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Progreso de cada asesor respecto a sus metas del mes.
            </p>
          </div>

          {currentUserId && (
            <div className="flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => setSelectedFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  selectedFilter === 'all'
                    ? 'bg-zinc-800 text-zinc-100 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Todo el Equipo
              </button>
              <button
                type="button"
                onClick={() => setSelectedFilter('my')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  selectedFilter === 'my'
                    ? 'bg-violet-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Mi Rendimiento
              </button>
            </div>
          )}
        </div>

        {displayedAdvisors.length === 0 ? (
          <p className="text-center py-10 text-xs text-zinc-500">
            No hay asesores registrados para este período.
          </p>
        ) : (
          <div className="space-y-3">
            {displayedAdvisors.map((adv) => {
              const isCurrentUser = adv.advisorId === currentUserId;
              return (
                <div
                  key={adv.advisorId}
                  className={`p-4 rounded-2xl border transition-all ${
                    isCurrentUser
                      ? 'bg-violet-500/5 border-violet-500/40 shadow-md ring-1 ring-violet-500/20'
                      : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Info Asesor */}
                    <div className="flex items-center gap-3 min-w-[200px]">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 font-extrabold text-xs text-zinc-200 shrink-0">
                        {adv.rank <= 3 ? (
                          adv.rank === 1 ? '🥇' : adv.rank === 2 ? '🥈' : '🥉'
                        ) : (
                          `#${adv.rank}`
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-zinc-100 truncate">
                            {adv.advisorName}
                          </h4>
                          {isCurrentUser && (
                            <span className="text-[10px] bg-violet-600/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.2 rounded font-semibold">
                              Tú
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[11px] text-zinc-400 font-mono">
                            {adv.score} pts
                          </span>
                          {adv.badges.map((b, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.2 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/60"
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Barras de Progreso Métricas */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                      {/* Ventas */}
                      <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800/80">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400 font-medium">🎯 Ventas:</span>
                          <span className="font-mono font-bold text-emerald-400">
                            {adv.actuals.ventas} / {adv.targets.ventasTarget}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, adv.percentages.ventasPct)}%` }}
                          />
                        </div>
                      </div>

                      {/* Visitas Terreno */}
                      <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800/80">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400 font-medium">🏡 Terreno:</span>
                          <span className="font-mono font-bold text-blue-400">
                            {adv.actuals.visitas} / {adv.targets.visitasTarget}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, adv.percentages.visitasPct)}%` }}
                          />
                        </div>
                      </div>

                      {/* Citas Virtuales */}
                      <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800/80">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400 font-medium">🎥 Citas:</span>
                          <span className="font-mono font-bold text-violet-400">
                            {adv.actuals.citas} / {adv.targets.citasTarget}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-violet-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, adv.percentages.citasPct)}%` }}
                          />
                        </div>
                      </div>

                      {/* Gestiones Hechas */}
                      <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800/80">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400 font-medium">⚡ Fichas:</span>
                          <span className="font-mono font-bold text-amber-400">
                            {adv.actuals.gestiones} / {adv.targets.gestionesTarget}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-amber-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, adv.percentages.gestionesPct)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Configuración de Metas */}
      {showConfigModal && (
        <CommercialGoalsConfigModal
          isOpen={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          onSaved={() => loadLeaderboard(true)}
          companyId={companyId}
          defaultGoals={data.defaultGoals}
          advisorGoals={data.advisorGoals}
          advisors={advisors}
        />
      )}
    </div>
  );
}
