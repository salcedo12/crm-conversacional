import { useEffect, useMemo, useState } from 'react';
import {
  Users, Building, Search, RefreshCw, Filter, Layers, X, SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { Spinner } from '@/shared/components/Spinner';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';
import {
  PIPELINE_STAGES,
  type PipelineCardItem,
  type PipelineGroup,
} from '../types/pipeline.types';
import {
  fetchPipelineCards, updateLeadPipelineStage,
  type PipelineFilterOptions, type PipelineFilterStats,
} from '../services/pipeline.service';
import { PipelineColumn } from '../components/PipelineColumn';
import { PipelineFilterDropdown, type FilterOption } from '../components/PipelineFilterDropdown';
import { PipelineFilterDrawer } from '../components/PipelineFilterDrawer';
import {
  CommercialDateFilter,
  buildPresetRange,
  formatFriendlyRange,
  type DateRangeValue,
} from '@/features/commercial/components/CommercialDateFilter';

const OFFICIAL_PROJECTS = [
  'Cañón de Arizona',
  'Laguna Mar',
  'Río Claro',
  'Llano Grande',
  'Sobre Montañas (Alvarado)',
];

export function PipelinePage() {
  const { companyId, user, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  // "Solo lectura": ve el embudo, pero no mueve tarjetas de etapa.
  const readOnly = !platformAdmin && role === 'viewer';

  const [cards, setCards] = useState<PipelineCardItem[]>([]);
  const [advisors, setAdvisors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fichaTargetCard, setFichaTargetCard] = useState<PipelineCardItem | null>(null);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  // Filtro de Fecha Interactivo (Calendario & Presets idénticos a Gestión Comercial)
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => buildPresetRange('30d'));

  // Opciones de filtros avanzados (SmartHome & Pauta)
  const [filterOptions, setFilterOptions] = useState<PipelineFilterOptions>(() => {
    const initPreset = buildPresetRange('30d');
    return {
      advisorId: isAdmin ? 'all' : (user?.uid || ''),
      projectFilter: 'all',
      groupFilter: 'all',
      sourceFilter: 'all',
      followUpStatus: 'all',
      dateRange: 'last_30_days',
      startDate: initPreset.startDate,
      endDate: initPreset.endDate,
      limitCount: 500,
    };
  });

  const [stats, setStats] = useState<PipelineFilterStats>({
    totalSample: 0,
    byProject: {},
    bySource: {},
    byFollowUp: { uncontacted: 0, overdue: 0, active: 0 },
    byYear: { '2026': 0, '2025': 0, '2024': 0 },
    byAge: { under30Days: 0, from30to60Days: 0, over60Days: 0 },
  });

  // Carga de datos con las opciones activas
  const loadData = async (opts = filterOptions) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const effectiveOpts = isAdmin ? opts : { ...opts, advisorId: user?.uid || '' };
      const res = await fetchPipelineCards(companyId, effectiveOpts);
      setCards(res.cards);
      setAdvisors(res.advisors);
      setStats(res.stats);
    } catch (err) {
      console.error('[PipelinePage] Error cargando embudo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!companyId) return;
    // Si el usuario conectado es un asesor, bloquear estrictamente en sus prospectos asignados
    const defaultAdv = (!isAdmin && user?.uid) ? user.uid : 'all';
    const initOpts: PipelineFilterOptions = {
      ...filterOptions,
      advisorId: defaultAdv,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    };
    setFilterOptions(initOpts);
    loadData(initOpts);
  }, [companyId, user?.uid, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterOptions.advisorId && filterOptions.advisorId !== 'all') count++;
    if (filterOptions.projectFilter && filterOptions.projectFilter !== 'all') count++;
    if (filterOptions.groupFilter && filterOptions.groupFilter !== 'all') count++;
    if (filterOptions.sourceFilter && filterOptions.sourceFilter !== 'all') count++;
    if (filterOptions.followUpStatus && filterOptions.followUpStatus !== 'all') count++;
    if (dateRange.preset !== 'all' && dateRange.startDate !== null) count++;
    return count;
  }, [filterOptions, dateRange]);

  // Filtrado en memoria por buscador y fase
  const filteredCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (term) {
        const match =
          c.name.toLowerCase().includes(term) ||
          c.phone.toLowerCase().includes(term) ||
          (c.email && c.email.toLowerCase().includes(term)) ||
          c.project.toLowerCase().includes(term);
        if (!match) return false;
      }
      if (filterOptions.groupFilter && filterOptions.groupFilter !== 'all' && c.group !== filterOptions.groupFilter) {
        return false;
      }
      return true;
    });
  }, [cards, search, filterOptions.groupFilter]);

  // Columnas a mostrar (todas o por grupo seleccionado)
  const visibleStages = useMemo(() => {
    if (!filterOptions.groupFilter || filterOptions.groupFilter === 'all') return PIPELINE_STAGES;
    return PIPELINE_STAGES.filter((s) => s.group === filterOptions.groupFilter);
  }, [filterOptions.groupFilter]);

  // Manejar cambio de etapa (drag & drop o selector de menú)
  const handleStageChange = async (cardId: string, targetStageId: string) => {
    if (!companyId) return;
    const targetStage = PIPELINE_STAGES.find((s) => s.id === targetStageId);
    if (!targetStage) return;

    // Actualización optimista inmediata
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? {
              ...c,
              stageId: targetStage.id,
              stageLabel: targetStage.label,
              group: targetStage.group,
              probability: targetStage.probability,
              probabilityLabel: targetStage.probabilityLabel,
            }
          : c
      )
    );

    try {
      await updateLeadPipelineStage(companyId, cardId, targetStageId, user?.displayName || 'Asesor');
    } catch (err) {
      console.error('[PipelinePage] Error actualizando etapa en Firestore:', err);
      // Revertir en caso de fallo
      loadData();
    }
  };

  // Métricas rápidas del embudo (calculadas sobre las tarjetas en pantalla)
  const metrics = useMemo(() => {
    let captacion = 0;
    let linea = 0;
    let cierre = 0;
    let noInteresado = 0;

    filteredCards.forEach((c) => {
      if (c.group === 'captacion') captacion++;
      else if (c.group === 'linea') linea++;
      else if (c.group === 'cierre') cierre++;
      else if (c.group === 'no_interesado') noInteresado++;
    });

    const activeTotal = captacion + linea + cierre;
    const conversionRate = activeTotal > 0 ? Math.round((cierre / activeTotal) * 100) : 0;

    return { total: filteredCards.length, captacion, linea, cierre, noInteresado, conversionRate };
  }, [filteredCards]);

  // Opciones para los selectores modernos con soporte dark mode completo
  const advisorOptions: FilterOption<string>[] = useMemo(() => {
    const list: FilterOption<string>[] = [
      { id: 'all', label: 'Todos los Asesores', icon: <Users size={14} className="text-violet-400" /> },
    ];
    // Si el usuario actual es asesor, destacar "Mis Prospectos" de primero
    if (role === 'advisor' && user?.uid) {
      list.push({
        id: user.uid,
        label: `Mis Prospectos (${user.displayName || 'Asesor'})`,
        icon: <Users size={14} className="text-emerald-400 font-semibold" />,
      });
    }
    advisors
      .filter((adv) => adv.id !== user?.uid)
      .forEach((adv) => {
        list.push({
          id: adv.id,
          label: adv.name,
          icon: <Users size={13} className="text-zinc-500" />,
        });
      });
    return list;
  }, [advisors, user, role]);

  const groupOptions: FilterOption<PipelineGroup | 'all'>[] = useMemo(() => [
    { id: 'all', label: 'Todas las Fases (12 Etapas)', icon: <Filter size={13} className="text-violet-400" /> },
    { id: 'captacion', label: '1. Captación (5% - 20%)', badge: metrics.captacion },
    { id: 'linea', label: '2. En Línea (35% - 65%)', badge: metrics.linea },
    { id: 'cierre', label: '3. Cierre (75% - 100%)', badge: metrics.cierre },
    { id: 'no_interesado', label: '4. No Interesado / Descarte', badge: metrics.noInteresado },
  ], [metrics]);

  const projectOptions: FilterOption<string>[] = useMemo(() => [
    { id: 'all', label: 'Todos los Proyectos', icon: <Building size={14} className="text-emerald-400" /> },
    ...OFFICIAL_PROJECTS.map((p) => ({
      id: p,
      label: p,
      icon: <Building size={13} className="text-zinc-500" />,
    })),
  ], []);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* ── Top Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 p-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 border border-violet-500/30">
                <Layers className="h-4 w-4" />
              </span>
              <h1 className="text-base font-bold text-white tracking-wide">
                Embudo de Ventas & Tablero Comercial
              </h1>
              <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400 font-mono border border-zinc-700">
                {filteredCards.length} leads
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Visualiza y gestiona el avance de los prospectos por etapas (Captación, Línea, Cierre y Descarte).
            </p>
          </div>

          {/* Métricas rápidas estilo píldora */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData()}
              disabled={loading}
              title="Refrescar datos"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ── Barra de Filtros ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-zinc-800/80">
          {/* Calendario y Rango de Fechas Interactivo (Idéntico a Gestión Comercial) */}
          <CommercialDateFilter
            value={dateRange}
            onChange={(newRange) => {
              setDateRange(newRange);
              const updated: PipelineFilterOptions = {
                ...filterOptions,
                dateRange: newRange.preset === 'all' ? 'all' : (newRange.preset === '30d' ? 'last_30_days' : 'custom'),
                startDate: newRange.startDate,
                endDate: newRange.endDate,
              };
              setFilterOptions(updated);
              loadData(updated);
            }}
          />

          {/* Selector de Asesor (solo administradores) o Cartera Bloqueada (asesores) */}
          {isAdmin ? (
            <PipelineFilterDropdown
              value={filterOptions.advisorId || 'all'}
              onChange={(val) => {
                const advObj = advisors.find((a) => a.id === val);
                const updated: PipelineFilterOptions = {
                  ...filterOptions,
                  advisorId: val,
                  advisorName: advObj ? advObj.name : '',
                };
                setFilterOptions(updated);
                loadData(updated);
              }}
              options={advisorOptions}
              icon={<Users size={14} className="text-violet-400" />}
              placeholder="Todos los Asesores"
              searchable
            />
          ) : (
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-2.5 py-1.5 shadow-sm text-emerald-300 text-xs font-semibold">
              <Users size={13} className="text-emerald-400 shrink-0" />
              <span className="text-[11px] font-medium text-emerald-400/80 shrink-0">Mi Cartera:</span>
              <span className="truncate max-w-[150px]">{user?.displayName || 'Asesor'}</span>
            </div>
          )}

          {/* Selector de Fase / Grupo */}
          <PipelineFilterDropdown
            value={filterOptions.groupFilter || 'all'}
            onChange={(val) => {
              const updated = { ...filterOptions, groupFilter: val as any };
              setFilterOptions(updated);
              loadData(updated);
            }}
            options={groupOptions}
            icon={<Filter size={14} className="text-violet-400" />}
            placeholder="Todas las Fases"
          />

          {/* Selector de Proyecto */}
          <PipelineFilterDropdown
            value={filterOptions.projectFilter || 'all'}
            onChange={(val) => {
              const updated = { ...filterOptions, projectFilter: val };
              setFilterOptions(updated);
              loadData(updated);
            }}
            options={projectOptions}
            icon={<Building size={14} className="text-emerald-400" />}
            placeholder="Todos los Proyectos"
            searchable
          />

          {/* Botón Filtros Avanzados */}
          <button
            type="button"
            onClick={() => setShowFilterDrawer(true)}
            className={`flex h-9 items-center gap-1.5 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer shadow-sm ${
              activeFiltersCount > 0
                ? 'bg-violet-600/25 border-violet-500 text-violet-200 ring-1 ring-violet-500/30'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white'
            }`}
          >
            <SlidersHorizontal size={13} className="text-violet-400" />
            <span className="hidden sm:inline">Filtros Avanzados</span>
            <span className="sm:hidden">Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="rounded-full bg-violet-500 text-white px-1.5 py-0.2 text-[10px] font-mono">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {/* Buscador de Texto */}
          <div className="flex h-9 items-center gap-2 flex-1 min-w-[200px] rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 text-xs focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/30 transition-all">
            <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, teléfono o proyecto..."
              className="w-full bg-transparent text-zinc-100 outline-none placeholder:text-zinc-500 text-xs"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Resumen Píldoras Métricas */}
          <div className="hidden lg:flex items-center gap-2 text-[11px] font-medium">
            <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
              Captación: {metrics.captacion}
            </span>
            <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              En Línea: {metrics.linea}
            </span>
            <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Cierre: {metrics.cierre}
            </span>
            {metrics.noInteresado > 0 && (
              <span className="px-2 py-1 rounded bg-red-500/10 text-red-300 border border-red-500/20">
                Descarte: {metrics.noInteresado}
              </span>
            )}
            <span className="px-2 py-1 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
              Conversión: {metrics.conversionRate}%
            </span>
          </div>
        </div>
      </header>

      {/* ── Contenedor del Tablero Kanban (Scroll Horizontal Suave) ───────────── */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-4 bg-zinc-950/90">
        {loading && cards.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex gap-4 h-full items-start">
            {visibleStages.map((stage) => {
              const stageCards = filteredCards.filter((c) => c.stageId === stage.id);
              return (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  cards={stageCards}
                  onOpenFicha={(card) => setFichaTargetCard(card)}
                  onChangeStage={readOnly ? undefined : handleStageChange}
                  onDropCard={readOnly ? undefined : handleStageChange}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* ── Modal de Ficha Técnica Integrada ──────────────────────────────────── */}
      {fichaTargetCard && companyId && (
        <FichaTecnicaModal
          isOpen={!!fichaTargetCard}
          onClose={() => setFichaTargetCard(null)}
          companyId={companyId}
          lead={{
            id: fichaTargetCard.id,
            name: fichaTargetCard.name,
            phone: fichaTargetCard.phone,
            project: fichaTargetCard.project,
            advisorName: fichaTargetCard.advisorName,
          }}
          onSuccess={() => {
            setFichaTargetCard(null);
            loadData();
          }}
        />
      )}

      {/* ── Drawer Lateral de Filtros Avanzados CRM Meraki ─────────────── */}
      <PipelineFilterDrawer
        isOpen={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        filters={filterOptions}
        onApplyFilters={(newOpts) => {
          const safeOpts = isAdmin ? newOpts : { ...newOpts, advisorId: user?.uid || '' };
          setFilterOptions(safeOpts);
          if (safeOpts.startDate && safeOpts.endDate) {
            setDateRange({
              preset: safeOpts.dateRange === 'last_30_days' ? '30d' : 'custom',
              startDate: safeOpts.startDate,
              endDate: safeOpts.endDate,
              label: safeOpts.dateRange === 'last_30_days' ? 'Últimos 30 días' : formatFriendlyRange(safeOpts.startDate, safeOpts.endDate),
            });
          } else if (safeOpts.dateRange === 'all') {
            setDateRange(buildPresetRange('all'));
          }
          loadData(safeOpts);
        }}
        advisors={advisors}
        stats={stats}
        isAdmin={isAdmin}
      />
    </div>
  );
}
