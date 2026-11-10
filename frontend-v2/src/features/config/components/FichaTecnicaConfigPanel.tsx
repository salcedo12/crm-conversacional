import { useEffect, useState } from 'react';
import {
  saveFichaTecnicaConfig,
  subscribeFichaTecnicaConfig,
  DEFAULT_FICHA_CONFIG,
  type FichaTecnicaConfig,
  type FichaActionTypeOption,
  type FichaNextStepOption,
} from '../services/fichaTecnicaConfig.service';
import { PIPELINE_STAGES } from '@/features/pipeline/types/pipeline.types';
import { Spinner } from '@/shared/components/Spinner';
import {
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  Save,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

const COMMON_EMOJIS = ['📩', '📞', '🎥', '🏡', '💬', '🏢', '🤝', '📄', '💳', '❌', '⏹️', '🚗', '👥', '⭐', '📍', '📋'];

export function FichaTecnicaConfigPanel({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<FichaTecnicaConfig>(DEFAULT_FICHA_CONFIG);
  const [activeSubTab, setActiveSubTab] = useState<'actions' | 'results' | 'nextSteps'>('actions');

  // Subtab 2: Gestión seleccionada para ver/editar sus resultados
  const [selectedActionIdForResults, setSelectedActionIdForResults] = useState<string>('envio_informacion');
  const [newResultText, setNewResultText] = useState<string>('');

  // Modales / Formulario inline para crear/editar Tipo de Gestión (Punto 1)
  const [editingAction, setEditingAction] = useState<FichaActionTypeOption | null>(null);
  const [isCreatingAction, setIsCreatingAction] = useState<boolean>(false);

  // Modales / Formulario inline para crear/editar Próximo Paso (Punto 3)
  const [editingNextStep, setEditingNextStep] = useState<FichaNextStepOption | null>(null);
  const [isCreatingNextStep, setIsCreatingNextStep] = useState<boolean>(false);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const unsubscribe = subscribeFichaTecnicaConfig(
      companyId,
      (c) => {
        setConfig(c);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [companyId]);

  const handleSave = async (customCfg?: FichaTecnicaConfig) => {
    setSaving(true);
    setError(null);
    setSavedSuccess(false);
    try {
      const cfgToSave = customCfg || config;
      await saveFichaTecnicaConfig(companyId, cfgToSave);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      console.error('[FichaTecnicaConfigPanel] Error guardando config:', err);
      setError(err?.message || 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (!window.confirm('¿Seguro que deseas restablecer todos los puntos de la Ficha Técnica a los valores predeterminados? Se perderán las personalizaciones no guardadas.')) return;
    setConfig(DEFAULT_FICHA_CONFIG);
    setSelectedActionIdForResults('envio_informacion');
    handleSave(DEFAULT_FICHA_CONFIG);
  };

  // ── Operaciones Punto 1: Tipos de Gestión ──
  const handleSaveAction = (item: FichaActionTypeOption) => {
    const existingIndex = config.actions.findIndex((a) => a.id === item.id);
    let newActions = [...config.actions];
    if (existingIndex >= 0) {
      newActions[existingIndex] = item;
    } else {
      newActions.push(item);
      // Inicializar lista de resultados vacía o básica si es nueva
      if (!config.results[item.id]) {
        setConfig((prev) => ({
          ...prev,
          results: {
            ...prev.results,
            [item.id]: ['Gestión completada con éxito', 'Pendiente de respuesta'],
          },
        }));
      }
    }
    const updated = { ...config, actions: newActions };
    setConfig(updated);
    setEditingAction(null);
    setIsCreatingAction(false);
  };

  const handleDeleteAction = (id: string) => {
    if (config.actions.length <= 1) {
      alert('Debe existir al menos un tipo de gestión.');
      return;
    }
    if (!window.confirm('¿Deseas eliminar este tipo de gestión de la Ficha Técnica?')) return;
    const newActions = config.actions.filter((a) => a.id !== id);
    const updated = { ...config, actions: newActions };
    setConfig(updated);
    if (selectedActionIdForResults === id) {
      setSelectedActionIdForResults(newActions[0]?.id || '');
    }
  };

  // ── Operaciones Punto 2: Resultados por Tipo de Gestión ──
  const currentResultsList = config.results[selectedActionIdForResults] || [];

  const handleAddResult = () => {
    const text = newResultText.trim();
    if (!text) return;
    if (currentResultsList.includes(text)) {
      alert('Ese resultado ya existe para esta gestión.');
      return;
    }
    const updatedList = [...currentResultsList, text];
    setConfig((prev) => ({
      ...prev,
      results: {
        ...prev.results,
        [selectedActionIdForResults]: updatedList,
      },
    }));
    setNewResultText('');
  };

  const handleDeleteResult = (resultText: string) => {
    const updatedList = currentResultsList.filter((r) => r !== resultText);
    setConfig((prev) => ({
      ...prev,
      results: {
        ...prev.results,
        [selectedActionIdForResults]: updatedList,
      },
    }));
  };

  // ── Operaciones Punto 3: Conclusiones y Próximos Pasos ──
  const handleSaveNextStep = (step: FichaNextStepOption) => {
    const existingIndex = config.nextSteps.findIndex((s) => s.id === step.id);
    let newSteps = [...config.nextSteps];
    if (existingIndex >= 0) {
      newSteps[existingIndex] = step;
    } else {
      newSteps.push(step);
    }
    const updated = { ...config, nextSteps: newSteps };
    setConfig(updated);
    setEditingNextStep(null);
    setIsCreatingNextStep(false);
  };

  const handleDeleteNextStep = (id: string) => {
    if (config.nextSteps.length <= 1) {
      alert('Debe existir al menos una conclusión / próximo paso comercial.');
      return;
    }
    if (!window.confirm('¿Deseas eliminar esta opción de conclusión o próximo paso?')) return;
    const newSteps = config.nextSteps.filter((s) => s.id !== id);
    setConfig({ ...config, nextSteps: newSteps });
  };

  const getStageLabel = (stageId?: string) => {
    if (!stageId) return 'Mantener etapa actual';
    const found = PIPELINE_STAGES.find((s) => s.id === stageId);
    return found ? `${found.label} (${found.probabilityLabel})` : stageId;
  };

  const renderActionForm = () => {
    if (!editingAction) return null;
    return (
      <div className="p-4 rounded-2xl border border-emerald-500/40 bg-zinc-900/90 space-y-3.5 shadow-xl animate-in fade-in">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
            <span>✏️</span>
            <span>{isCreatingAction ? 'Agregar Nuevo Tipo de Gestión' : 'Editar Tipo de Gestión'}</span>
          </h4>
          <button
            type="button"
            onClick={() => {
              setIsCreatingAction(false);
              setEditingAction(null);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
          >
            ✕ Cancelar
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Emoji / Icono */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Icono / Emoji</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={4}
                value={editingAction.icon}
                onChange={(e) => setEditingAction({ ...editingAction, icon: e.target.value })}
                className="w-full text-center text-lg h-9 rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            {/* Selector rápido de emojis */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {COMMON_EMOJIS.slice(0, 8).map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setEditingAction({ ...editingAction, icon: em })}
                  className="text-xs p-1 rounded hover:bg-zinc-800 cursor-pointer"
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Nombre de la gestión */}
          <div className="sm:col-span-5">
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Nombre de la Gestión</label>
            <input
              type="text"
              placeholder="Ej. Envío de Información, Llamada..."
              value={editingAction.label}
              onChange={(e) => {
                const val = e.target.value;
                const slug = isCreatingAction
                  ? val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                  : editingAction.id;
                setEditingAction({
                  ...editingAction,
                  label: val,
                  id: slug || editingAction.id,
                });
              }}
              className="w-full h-9 px-3 rounded-xl border border-zinc-700 bg-zinc-950 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[10px] text-zinc-500 mt-1">ID técnico: <code className="text-zinc-400">{editingAction.id}</code></p>
          </div>

          {/* Etapa del Embudo (Pipeline) a la que avanza */}
          <div className="sm:col-span-5">
            <label className="block text-[11px] font-semibold text-emerald-400 mb-1 flex items-center gap-1">
              <ArrowRight size={12} />
              <span>Avanza a la Etapa del Embudo (Pipeline)</span>
            </label>
            <select
              value={editingAction.defaultStageId || ''}
              onChange={(e) => setEditingAction({ ...editingAction, defaultStageId: e.target.value })}
              className="w-full h-9 px-3 rounded-xl border border-emerald-500/40 bg-zinc-950 text-xs text-emerald-300 font-medium focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              <option value="">Mantener etapa actual / Sin cambio automático</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.probabilityLabel}) — Fase {s.group.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Descripción */}
          <div className="sm:col-span-12">
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Descripción / Ayuda para el Asesor (Opcional)</label>
            <input
              type="text"
              placeholder="Ej. Brochure, cotización o planos por WhatsApp/Email"
              value={editingAction.desc || ''}
              onChange={(e) => setEditingAction({ ...editingAction, desc: e.target.value })}
              className="w-full h-9 px-3 rounded-xl border border-zinc-700 bg-zinc-950 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setIsCreatingAction(false);
              setEditingAction(null);
            }}
            className="px-3 py-1.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (!editingAction.label.trim()) {
                alert('El nombre de la gestión es obligatorio.');
                return;
              }
              handleSaveAction(editingAction);
            }}
            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
          >
            Guardar en Lista
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-400">
        <Spinner />
        <span className="text-xs">Cargando configuración de la Ficha Técnica...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Encabezado y Acciones */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <span>📋</span>
            <span>Configuración de Ficha Técnica & Seguimientos</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400 max-w-2xl leading-relaxed">
            Personaliza los puntos de la Ficha Técnica oficial del CRM: agrega, edita o elimina gestiones,
            resultados rápidos y próximos pasos comerciales, y define a qué <strong>etapa del embudo (pipeline)</strong> avanza automáticamente el prospecto en cada caso.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={saving}
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={14} />
            <span>Restablecer</span>
          </button>

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <Spinner />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>Guardar Cambios</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Alertas */}
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2.5">
          <AlertTriangle size={18} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {savedSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          <span>¡Configuración de la Ficha Técnica guardada exitosamente! Ya está activa para todos los asesores.</span>
        </div>
      )}

      {/* Sub-Pestañas: Punto 1, Punto 2, Punto 3 */}
      <div className="flex border-b border-zinc-800 gap-1 bg-zinc-900/50 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveSubTab('actions')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'actions'
              ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/80'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>1️⃣</span>
          <span>Punto 1: Tipos de Gestión ({config.actions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('results')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'results'
              ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/80'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>2️⃣</span>
          <span>Punto 2: Opciones de Resultado</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('nextSteps')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'nextSteps'
              ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/80'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>3️⃣</span>
          <span>Punto 3: Próximos Pasos & Etapas ({config.nextSteps.length})</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SUBTAB 1: TIPOS DE GESTIÓN (PUNTO 1)
         ───────────────────────────────────────────────────────────── */}
      {activeSubTab === 'actions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400">
              Opciones que el asesor puede elegir al iniciar el diligenciamiento. Puedes asignar a qué <strong>etapa del embudo</strong> avanza el lead cuando se realiza cada gestión.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsCreatingAction(true);
                setEditingAction({
                  id: `gestion_${Date.now()}`,
                  label: '',
                  icon: '💬',
                  desc: '',
                  defaultStageId: '',
                  active: true,
                });
              }}
              className="px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>Nuevo Tipo de Gestión</span>
            </button>
          </div>

          {/* Formulario de creación / edición de Tipo de Gestión */}
          {renderActionForm()}

          {/* Lista de Tipos de Gestión */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {config.actions.map((act) => (
              <div
                key={act.id}
                className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 flex flex-col justify-between gap-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="text-2xl shrink-0 p-1.5 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                      {act.icon}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-zinc-100 truncate">{act.label}</h4>
                      {act.desc && <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{act.desc}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingAction(false);
                        setEditingAction(act);
                      }}
                      title="Editar gestión"
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAction(act.id)}
                      title="Eliminar gestión"
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Etapa asociada */}
                <div className="pt-2 border-t border-zinc-800/70 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500 flex items-center gap-1">
                    <span>📊 Etapa automática:</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium ${
                    act.defaultStageId
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {getStageLabel(act.defaultStageId)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SUBTAB 2: RESULTADOS POR TIPO DE GESTIÓN (PUNTO 2)
         ───────────────────────────────────────────────────────────── */}
      {activeSubTab === 'results' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-zinc-400">
              Cada tipo de gestión tiene sus propias respuestas y resultados predeterminados para que el asesor seleccione rápidamente con 1 toque.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsCreatingAction(true);
                setEditingAction({
                  id: `gestion_${Date.now()}`,
                  label: '',
                  icon: '💬',
                  desc: '',
                  defaultStageId: '',
                  active: true,
                });
              }}
              className="px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>+ Nuevo Tipo de Gestión</span>
            </button>
          </div>

          {/* Formulario si está creando/editando gestión desde aquí */}
          {renderActionForm()}

          {/* Selector de qué gestión estamos configurando */}
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {config.actions.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => setSelectedActionIdForResults(act.id)}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                  selectedActionIdForResults === act.id
                    ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/40 shadow-md'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span>{act.icon}</span>
                <span>{act.label}</span>
                <span className="text-[10px] opacity-75">({config.results[act.id]?.length || 0})</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setIsCreatingAction(true);
                setEditingAction({
                  id: `gestion_${Date.now()}`,
                  label: '',
                  icon: '💬',
                  desc: '',
                  defaultStageId: '',
                  active: true,
                });
              }}
              title="Crear un nuevo tipo de gestión para agregarle opciones"
              className="py-2 px-3 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={13} />
              <span>+ Agregar Gestión</span>
            </button>
          </div>

          {/* Caja para agregar nuevo resultado */}
          <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-3">
            <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <span>➕</span>
              <span>
                Agregar resultado rápido para:{' '}
                <strong className="text-emerald-400">
                  {config.actions.find((a) => a.id === selectedActionIdForResults)?.label || selectedActionIdForResults}
                </strong>
              </span>
            </h4>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ej. Contestó pero no tiene tiempo hoy / Solicita llamada el viernes..."
                value={newResultText}
                onChange={(e) => setNewResultText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddResult();
                  }
                }}
                className="flex-1 h-9 px-3 rounded-xl border border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddResult}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} />
                <span>Agregar</span>
              </button>
            </div>
          </div>

          {/* Lista de resultados activos para la gestión seleccionada */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-zinc-400 block uppercase tracking-wider">
              Resultados disponibles ({currentResultsList.length})
            </span>

            {currentResultsList.length === 0 ? (
              <div className="p-6 rounded-2xl border border-dashed border-zinc-800 text-center text-xs text-zinc-500">
                No hay resultados configurados para esta gestión. Agrega al menos uno arriba.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {currentResultsList.map((r) => (
                  <div
                    key={r}
                    className="p-3 rounded-xl border border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 flex items-center justify-between gap-2 text-xs text-zinc-200 transition-colors"
                  >
                    <span className="truncate flex items-center gap-2">
                      <span className="text-emerald-400">●</span>
                      <span>{r}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteResult(r)}
                      title="Eliminar este resultado"
                      className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SUBTAB 3: CONCLUSIÓN & PRÓXIMOS PASOS (PUNTO 3)
         ───────────────────────────────────────────────────────────── */}
      {activeSubTab === 'nextSteps' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400">
              Opciones de conclusión comercial (Punto 3). Aquí defines si la opción requiere agendar fecha/hora, si es un desistimiento/cierre definitivo, y la <strong>etapa del embudo comercial (pipeline)</strong> a la que debe moverse el prospecto.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsCreatingNextStep(true);
                setEditingNextStep({
                  id: `paso_${Date.now()}`,
                  label: '',
                  icon: '🎯',
                  requiresSchedule: true,
                  isDesistimiento: false,
                  isReferralProgram: false,
                  defaultStageId: '',
                  active: true,
                });
              }}
              className="px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>Nuevo Próximo Paso</span>
            </button>
          </div>

          {/* Formulario de creación / edición de Próximo Paso */}
          {(isCreatingNextStep || editingNextStep) && editingNextStep && (
            <div className="p-4 rounded-2xl border border-emerald-500/40 bg-zinc-900/90 space-y-3.5 shadow-xl animate-in fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                  <span>✏️</span>
                  <span>{isCreatingNextStep ? 'Agregar Nueva Conclusión / Próximo Paso' : 'Editar Próximo Paso'}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNextStep(false);
                    setEditingNextStep(null);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  ✕ Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Emoji / Icono */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Icono / Emoji</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={editingNextStep.icon}
                    onChange={(e) => setEditingNextStep({ ...editingNextStep, icon: e.target.value })}
                    className="w-full text-center text-lg h-9 rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {['📞', '🏠', '📄', '🤝', '💳', '❌', '⏹️', '⏳'].map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setEditingNextStep({ ...editingNextStep, icon: em })}
                        className="text-xs p-1 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nombre de la opción */}
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">Texto de la Opción</label>
                  <input
                    type="text"
                    placeholder="Ej. Próxima Llamada, Visita a Terreno, Desistimiento..."
                    value={editingNextStep.label}
                    onChange={(e) => {
                      const val = e.target.value;
                      const slug = isCreatingNextStep
                        ? val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                        : editingNextStep.id;
                      setEditingNextStep({
                        ...editingNextStep,
                        label: val,
                        id: slug || editingNextStep.id,
                      });
                    }}
                    className="w-full h-9 px-3 rounded-xl border border-zinc-700 bg-zinc-950 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">ID técnico: <code className="text-zinc-400">{editingNextStep.id}</code></p>
                </div>

                {/* Etapa en el embudo (Pipeline) */}
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-semibold text-emerald-400 mb-1 flex items-center gap-1">
                    <ArrowRight size={12} />
                    <span>Mover Prospecto a la Etapa del Pipeline</span>
                  </label>
                  <select
                    value={editingNextStep.defaultStageId || ''}
                    onChange={(e) => setEditingNextStep({ ...editingNextStep, defaultStageId: e.target.value })}
                    className="w-full h-9 px-3 rounded-xl border border-emerald-500/40 bg-zinc-950 text-xs text-emerald-300 font-medium focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    <option value="">Mantener etapa actual / Sin cambio</option>
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} ({s.probabilityLabel}) — Fase {s.group.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Comportamiento: Agendamiento vs Desistimiento */}
                <div className="sm:col-span-12 space-y-2 pt-1 border-t border-zinc-800">
                  <span className="block text-[11px] font-semibold text-zinc-300">
                    Comportamiento de Seguimiento & Alarmas:
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                      editingNextStep.requiresSchedule
                        ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                    }`}>
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={editingNextStep.requiresSchedule}
                        onChange={() => setEditingNextStep({
                          ...editingNextStep,
                          requiresSchedule: true,
                          isDesistimiento: false,
                        })}
                        className="mt-0.5 text-amber-500 focus:ring-0"
                      />
                      <div>
                        <strong className="block text-amber-300">⏰ Requiere agendar fecha y hora</strong>
                        <span className="text-[11px] opacity-80">Muestra selector de fecha rápida, calendario y sincronización con Google Calendar.</span>
                      </div>
                    </label>

                    <label className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 cursor-pointer transition-colors ${
                      !editingNextStep.requiresSchedule
                        ? 'border-rose-500 bg-rose-500/10 text-rose-200'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                    }`}>
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={!editingNextStep.requiresSchedule}
                        onChange={() => setEditingNextStep({
                          ...editingNextStep,
                          requiresSchedule: false,
                          isDesistimiento: true,
                        })}
                        className="mt-0.5 text-rose-500 focus:ring-0"
                      />
                      <div>
                        <strong className="block text-rose-300">🛑 Desistimiento / Cierre de Gestión (Sin Seguimiento)</strong>
                        <span className="text-[11px] opacity-80">Guarda en bitácora, NO pide fecha futura y cierra todas las alarmas y tareas pendientes de este lead.</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNextStep(false);
                    setEditingNextStep(null);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!editingNextStep.label.trim()) {
                      alert('El nombre de la conclusión o próximo paso es obligatorio.');
                      return;
                    }
                    handleSaveNextStep(editingNextStep);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  Guardar en Lista
                </button>
              </div>
            </div>
          )}

          {/* Lista de Próximos Pasos */}
          <div className="space-y-2">
            {config.nextSteps.map((step) => {
              const isDesist = step.isDesistimiento || !step.requiresSchedule;
              return (
                <div
                  key={step.id}
                  className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl shrink-0 p-1.5 bg-zinc-800/80 rounded-xl border border-zinc-700/60">
                      {step.icon}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-zinc-100 flex items-center gap-2 truncate">
                        <span className="truncate">{step.label}</span>
                        {isDesist ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium">
                            🛑 Sin Más Seguimiento
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium flex items-center gap-1">
                            <Calendar size={11} /> Agendable
                          </span>
                        )}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] text-zinc-500 block">Etapa del Embudo:</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-lg font-semibold inline-block ${
                        step.defaultStageId
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {getStageLabel(step.defaultStageId)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 pl-2 border-l border-zinc-800">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingNextStep(false);
                          setEditingNextStep(step);
                        }}
                        title="Editar próximo paso"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteNextStep(step.id)}
                        title="Eliminar opción"
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
