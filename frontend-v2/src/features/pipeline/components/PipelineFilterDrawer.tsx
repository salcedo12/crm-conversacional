import { useState } from 'react';
import {
  X, Filter, RotateCcw, Check, Users, Building, Calendar,
  Clock, Flame, ShieldAlert,
} from 'lucide-react';
import type { PipelineFilterOptions, PipelineFilterStats } from '../services/pipeline.service';

interface PipelineFilterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  filters: PipelineFilterOptions;
  onApplyFilters: (newFilters: PipelineFilterOptions) => void;
  advisors: { id: string; name: string }[];
  stats: PipelineFilterStats;
  isAdmin?: boolean;
}

const OFFICIAL_PROJECTS = [
  'Cañón de Arizona',
  'Laguna Mar',
  'Río Claro',
  'Llano Grande',
  'Sobre Montañas (Alvarado)',
];

export function PipelineFilterDrawer({
  isOpen,
  onClose,
  filters,
  onApplyFilters,
  advisors,
  stats,
  isAdmin = false,
}: PipelineFilterDrawerProps) {
  const [localFilters, setLocalFilters] = useState<PipelineFilterOptions>(filters);

  if (!isOpen) return null;

  const handleApply = () => {
    onApplyFilters(localFilters);
    onClose();
  };

  const handleReset = () => {
    const defaultFilters: PipelineFilterOptions = {
      advisorId: 'all',
      projectFilter: 'all',
      groupFilter: 'all',
      sourceFilter: 'all',
      followUpStatus: 'all',
      dateRange: 'all',
      limitCount: 500,
    };
    setLocalFilters(defaultFilters);
    onApplyFilters(defaultFilters);
    onClose();
  };

  // Presets rápidos
  const applyPreset = (preset: 'recent' | 'pauta' | 'smarthome' | 'overdue') => {
    if (preset === 'recent') {
      setLocalFilters({
        ...localFilters,
        dateRange: 'last_30_days',
        sourceFilter: 'all',
        followUpStatus: 'all',
      });
    } else if (preset === 'pauta') {
      setLocalFilters({
        ...localFilters,
        sourceFilter: 'meta_ads',
        dateRange: 'all',
      });
    } else if (preset === 'smarthome') {
      setLocalFilters({
        ...localFilters,
        sourceFilter: 'smarthome',
        dateRange: 'all',
      });
    } else if (preset === 'overdue') {
      setLocalFilters({
        ...localFilters,
        followUpStatus: 'overdue',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <aside
        className="w-full max-w-md h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 border border-violet-500/30">
              <Filter className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Filtros Avanzados • CRM Meraki
              </h2>
              <p className="text-[11px] text-zinc-400">
                Segmenta y analiza tus prospectos según proyecto, asesor, seguimiento y origen.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido con scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Presets Rápidos estilo Pills */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              ⚡ Filtros Rápidos (1-Clic)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('recent')}
                className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  localFilters.dateRange === 'last_30_days'
                    ? 'bg-violet-600/20 text-violet-200 border-violet-500/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <Flame size={13} className="text-amber-400 shrink-0" />
                <span className="truncate">Últimos 30 días</span>
              </button>

              <button
                type="button"
                onClick={() => applyPreset('pauta')}
                className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  localFilters.sourceFilter === 'meta_ads'
                    ? 'bg-blue-600/20 text-blue-200 border-blue-500/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <span className="text-blue-400 shrink-0">📣</span>
                <span className="truncate">Meta Ads (Pauta)</span>
              </button>

              <button
                type="button"
                onClick={() => applyPreset('smarthome')}
                className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  localFilters.sourceFilter === 'smarthome'
                    ? 'bg-sky-600/20 text-sky-200 border-sky-500/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <span className="text-sky-400 shrink-0">📁</span>
                <span className="truncate">Base de Datos General</span>
              </button>

              <button
                type="button"
                onClick={() => applyPreset('overdue')}
                className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  localFilters.followUpStatus === 'overdue'
                    ? 'bg-rose-600/20 text-rose-200 border-rose-500/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <Clock size={13} className="text-rose-400 shrink-0" />
                <span className="truncate">Seguimiento Vencido</span>
              </button>
            </div>
          </div>

          {/* 1. Asesor Responsable (solo administradores) */}
          {isAdmin && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                <Users size={13} className="text-violet-400" />
                <span>1. Asesor Asignado</span>
              </label>
              <select
                value={localFilters.advisorId || 'all'}
                onChange={(e) => setLocalFilters({ ...localFilters, advisorId: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none cursor-pointer"
              >
                <option value="all">👥 Todos los Asesores</option>
                {advisors.map((adv) => (
                  <option key={adv.id} value={adv.id}>
                    {adv.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 2. Proyecto */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Building size={13} className="text-emerald-400" />
                <span>2. Proyecto</span>
              </span>
              <span className="text-[10px] text-zinc-500 font-mono font-normal">
                {stats.totalSample} analizados
              </span>
            </label>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setLocalFilters({ ...localFilters, projectFilter: 'all' })}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                  localFilters.projectFilter === 'all'
                    ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 font-bold'
                    : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span>🏡 Todos los Proyectos</span>
                {localFilters.projectFilter === 'all' && <Check size={14} />}
              </button>

              {OFFICIAL_PROJECTS.map((proj) => {
                const isSelected = localFilters.projectFilter === proj;
                const count = stats.byProject[proj] || 0;
                return (
                  <button
                    key={proj}
                    type="button"
                    onClick={() => setLocalFilters({ ...localFilters, projectFilter: proj })}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 font-bold'
                        : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="truncate">{proj}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 ml-2">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Estado de Seguimiento Comercial */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
              <Clock size={13} className="text-amber-400" />
              <span>3. Estado de Seguimiento Comercial</span>
            </label>
            <div className="space-y-1">
              {[
                { id: 'all', label: 'Todos los estados', count: stats.totalSample },
                { id: 'uncontacted', label: 'Sin Contactar', count: stats.byFollowUp.uncontacted },
                { id: 'overdue', label: 'Seguimiento Vencido', count: stats.byFollowUp.overdue },
                { id: 'active', label: 'Con Seguimiento Activo / Cita', count: stats.byFollowUp.active },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLocalFilters({ ...localFilters, followUpStatus: item.id as any })}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                    (localFilters.followUpStatus || 'all') === item.id
                      ? 'bg-amber-600/20 text-amber-300 border-amber-500/40 font-bold'
                      : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 4. Medio / Canal de Origen */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              4. Medio / Origen del Lead
            </label>
            <div className="space-y-1">
              {[
                { id: 'all', label: 'Todos los orígenes', icon: '🌐' },
                { id: 'meta_ads', label: 'Pauta Meta Ads (PAUTA WHATSAPP 317)', icon: '📣' },
                { id: 'campo', label: 'Trabajo de campo (Captación Asesor)', icon: '🏃' },
                { id: 'referidos', label: 'Referidos', icon: '👥' },
                { id: 'whatsapp_ia', label: 'Línea Central 317 (WhatsApp)', icon: '🤖' },
                { id: 'advisor_whatsapp', label: 'WhatsApp Directo Asesores', icon: '📱' },
                { id: 'web', label: 'Página Web', icon: '💻' },
                { id: 'ferias', label: 'Ferias y Eventos Comerciales', icon: '🎪' },
                { id: 'smarthome', label: 'Base de Datos General', icon: '📁' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLocalFilters({ ...localFilters, sourceFilter: item.id })}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                    (localFilters.sourceFilter || 'all') === item.id
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 font-bold'
                      : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                  {(localFilters.sourceFilter || 'all') === item.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Antigüedad & Período de Registro */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
              <Calendar size={13} className="text-cyan-400" />
              <span>5. Período / Antigüedad de Registro</span>
            </label>
            <div className="space-y-1">
              {[
                { id: 'all', label: 'Todos los períodos', badge: stats.totalSample },
                { id: 'last_30_days', label: 'Últimos 30 días (Recientes)', badge: stats.byAge.under30Days },
                { id: 'last_60_days', label: 'De 1 a 2 meses', badge: stats.byAge.from30to60Days },
                { id: 'year_2026', label: 'Año 2026', badge: stats.byYear['2026'] },
                { id: 'year_2025', label: 'Año 2025 (Histórico)', badge: stats.byYear['2025'] },
                { id: 'year_2024', label: 'Año 2024 (Histórico)', badge: stats.byYear['2024'] },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLocalFilters({ ...localFilters, dateRange: p.id as any })}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                    (localFilters.dateRange || 'all') === p.id
                      ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40 font-bold'
                      : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                    {p.badge}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 6. Control de Lecturas Firestore (Ahorro de Costos) */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <ShieldAlert size={14} />
              <span>Control de Lecturas Firestore</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Define cuántos prospectos cargar en el tablero. Evita lecturas masivas innecesarias de la base de 11.787 leads.
            </p>
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[100, 250, 500, 1000].map((lim) => (
                <button
                  key={lim}
                  type="button"
                  onClick={() => setLocalFilters({ ...localFilters, limitCount: lim })}
                  className={`py-1.5 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer ${
                    (localFilters.limitCount || 500) === lim
                      ? 'bg-amber-500 text-zinc-950 border-amber-400'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  {lim}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer con botones de acción */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Restablecer</span>
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex-2 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer"
          >
            <span>⚡ Filtrar y Actualizar</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
