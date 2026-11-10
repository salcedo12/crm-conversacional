import { useState } from 'react';
import { Target, X, Save, AlertCircle } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { saveCommercialGoalsConfig } from '../services/commercialGoals.service';
import type {
  CommercialGoalConfig,
  AdvisorGoalItem,
  AdvisorLeaderboardItem,
} from '../types/commercialGoals.types';

interface CommercialGoalsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  companyId: string;
  defaultGoals: CommercialGoalConfig;
  advisorGoals: Record<string, AdvisorGoalItem>;
  advisors: AdvisorLeaderboardItem[];
}

export function CommercialGoalsConfigModal({
  isOpen,
  onClose,
  onSaved,
  companyId,
  defaultGoals: initialDefaultGoals,
  advisorGoals: initialAdvisorGoals,
  advisors,
}: CommercialGoalsConfigModalProps) {
  const [defaultGoals, setDefaultGoals] = useState<CommercialGoalConfig>({
    citasTarget: initialDefaultGoals.citasTarget || 15,
    visitasTarget: initialDefaultGoals.visitasTarget || 6,
    ventasTarget: initialDefaultGoals.ventasTarget || 2,
    gestionesTarget: initialDefaultGoals.gestionesTarget || 40,
  });

  const [advisorGoals, setAdvisorGoals] = useState<Record<string, AdvisorGoalItem>>(
    initialAdvisorGoals || {}
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'global' | 'advisors'>('global');

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveCommercialGoalsConfig(companyId, defaultGoals, advisorGoals);
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('[CommercialGoalsConfigModal] Error saving goals:', err);
      setError(err?.message || 'No se pudieron guardar las metas. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdvisorGoalChange = (
    advisorId: string,
    field: keyof AdvisorGoalItem,
    val: number | undefined
  ) => {
    setAdvisorGoals((prev) => {
      const current = prev[advisorId] || {};
      const updated = { ...current, [field]: val };
      return { ...prev, [advisorId]: updated };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl text-zinc-100 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
              <Target size={20} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">
                Configurar Metas Comerciales
              </h2>
              <p className="text-xs text-zinc-400">
                Define las cuotas mensuales del equipo y personaliza por asesor.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab('global')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'global'
                ? 'bg-violet-600 text-white shadow'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            🎯 Meta General del Equipo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('advisors')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'advisors'
                ? 'bg-violet-600 text-white shadow'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            👥 Cuotas Individuales por Asesor ({advisors.length})
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Body content */}
        <div className="min-h-0 flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          {activeTab === 'global' ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400">
                Esta meta se aplica automáticamente a todos los asesores como cuota estándar mensual del mes activo.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">🎯 Ventas / Lotes Cerrados</span>
                    <span className="text-emerald-400 text-xs font-mono font-bold">Mes</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={defaultGoals.ventasTarget}
                    onChange={(e) =>
                      setDefaultGoals({ ...defaultGoals, ventasTarget: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 font-bold focus:border-violet-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Número de lotes vendidos o promesas firmadas esperadas por asesor.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">🏡 Visitas a Terreno</span>
                    <span className="text-blue-400 text-xs font-mono font-bold">Mes</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={defaultGoals.visitasTarget}
                    onChange={(e) =>
                      setDefaultGoals({ ...defaultGoals, visitasTarget: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 font-bold focus:border-violet-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Visitas presenciales a proyectos (Melgar, Alvarado, Mariquita, etc.).
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">🎥 Citas / Videollamadas</span>
                    <span className="text-violet-400 text-xs font-mono font-bold">Mes</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={defaultGoals.citasTarget}
                    onChange={(e) =>
                      setDefaultGoals({ ...defaultGoals, citasTarget: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 font-bold focus:border-violet-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Citas virtuales agendadas o reuniones telefónicas de presentación.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">⚡ Gestiones / Bitácoras</span>
                    <span className="text-amber-400 text-xs font-mono font-bold">Mes</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={defaultGoals.gestionesTarget}
                    onChange={(e) =>
                      setDefaultGoals({ ...defaultGoals, gestionesTarget: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 font-bold focus:border-violet-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Total de seguimientos y fichas técnicas diligenciadas en el mes.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Puedes personalizar las metas para un asesor específico (si dejas en blanco, usará la meta general).
              </p>

              {advisors.map((adv) => {
                const custom = advisorGoals[adv.advisorId] || {};
                return (
                  <div
                    key={adv.advisorId}
                    className="p-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-violet-600/30 text-violet-300 font-bold text-xs flex items-center justify-center">
                          {adv.advisorName[0]?.toUpperCase() || 'A'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-zinc-100">{adv.advisorName}</p>
                          <p className="text-[10px] text-zinc-500">{adv.email}</p>
                        </div>
                      </div>
                      <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400 font-mono">
                        Puesto #{adv.rank}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">🎯 Ventas:</label>
                        <input
                          type="number"
                          placeholder={String(defaultGoals.ventasTarget)}
                          value={custom.ventasTarget !== undefined ? custom.ventasTarget : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value) || 0;
                            handleAdvisorGoalChange(adv.advisorId, 'ventasTarget', val);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">🏡 Terreno:</label>
                        <input
                          type="number"
                          placeholder={String(defaultGoals.visitasTarget)}
                          value={custom.visitasTarget !== undefined ? custom.visitasTarget : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value) || 0;
                            handleAdvisorGoalChange(adv.advisorId, 'visitasTarget', val);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">🎥 Citas:</label>
                        <input
                          type="number"
                          placeholder={String(defaultGoals.citasTarget)}
                          value={custom.citasTarget !== undefined ? custom.citasTarget : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value) || 0;
                            handleAdvisorGoalChange(adv.advisorId, 'citasTarget', val);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">⚡ Gestiones:</label>
                        <input
                          type="number"
                          placeholder={String(defaultGoals.gestionesTarget)}
                          value={custom.gestionesTarget !== undefined ? custom.gestionesTarget : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value) || 0;
                            handleAdvisorGoalChange(adv.advisorId, 'gestionesTarget', val);
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-2 transition shadow cursor-pointer disabled:opacity-50"
          >
            {saving ? <Spinner size="sm" /> : <Save size={14} />}
            <span>Guardar Metas</span>
          </button>
        </div>
      </div>
    </div>
  );
}
