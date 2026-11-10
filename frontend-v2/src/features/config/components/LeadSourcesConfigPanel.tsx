import { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Edit2,
  Save,
  X,
  AlertCircle,
  Radio,
  Layers,
} from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import {
  subscribeLeadSources,
  createLeadSource,
  toggleLeadSourceActive,
  updateLeadSourceName,
  type LeadSourceItem,
} from '../services/leadSources.service';

interface LeadSourcesConfigPanelProps {
  companyId: string;
}

export function LeadSourcesConfigPanel({ companyId }: LeadSourcesConfigPanelProps) {
  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal para nueva fuente
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Edición inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeLeadSources(
      companyId,
      (data) => {
        setSources(data);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [companyId]);

  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      if (filter === 'active' && !s.active) return false;
      if (filter === 'inactive' && s.active) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [sources, filter, search]);

  const activeCount = useMemo(() => sources.filter((s) => s.active).length, [sources]);
  const inactiveCount = sources.length - activeCount;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;

    setCreating(true);
    setError(null);
    try {
      await createLeadSource(companyId, newName, newDesc);
      setNewName('');
      setNewDesc('');
      setShowAddModal(false);
    } catch (err: any) {
      setError(err?.message || 'Error al crear la fuente');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (source: LeadSourceItem) => {
    try {
      await toggleLeadSourceActive(companyId, source.id, !source.active);
    } catch (err: any) {
      setError(err?.message || 'Error al cambiar estado de la fuente');
    }
  };

  const startEdit = (source: LeadSourceItem) => {
    setEditingId(source.id);
    setEditName(source.name);
    setEditDesc(source.description || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDesc('');
  };

  const saveEdit = async (sourceId: string) => {
    if (!editName.trim() || savingEdit) return;

    setSavingEdit(true);
    try {
      await updateLeadSourceName(companyId, sourceId, editName, editDesc);
      setEditingId(null);
    } catch (err: any) {
      setError(err?.message || 'Error al actualizar la fuente');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Encabezado */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 pb-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Compass className="h-5 w-5 text-emerald-400" />
            <span>Fuentes de Ubicación y Captación</span>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              {sources.length} totales
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400 max-w-2xl">
            Gestiona los canales y orígenes de tus prospectos. Puedes <strong className="text-zinc-200">desactivar fuentes</strong> de eventos o ferias pasadas para que no saturen el formulario de los asesores al crear datos, sin afectar los prospectos históricos que ya la tienen.
          </p>
        </div>

        <Button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 self-start sm:self-auto bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs"
        >
          <Plus className="h-4 w-4" />
          <span>Nueva Fuente</span>
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Barra de filtros y búsqueda */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar fuente (ej. Trabajo de campo, Pauta 317, Feria...)"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-zinc-800 text-zinc-100 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Todas ({sources.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('active')}
            className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === 'active'
                ? 'bg-emerald-500/20 text-emerald-300 shadow border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Activas ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('inactive')}
            className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === 'inactive'
                ? 'bg-zinc-800 text-zinc-300 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            Desactivadas ({inactiveCount})
          </button>
        </div>
      </div>

      {/* Lista de fuentes */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-xs text-zinc-500">
          No se encontraron fuentes de ubicación con los criterios aplicados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 shadow-sm">
          <div className="divide-y divide-zinc-800/60">
            {filteredSources.map((source) => {
              const isEditing = editingId === source.id;

              return (
                <div
                  key={source.id}
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 transition-colors ${
                    !source.active ? 'opacity-70 bg-zinc-950/20' : 'hover:bg-zinc-900/60'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full sm:w-72 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Descripción o notas (opcional)"
                        className="w-full sm:flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-emerald-500"
                      />
                      <div className="flex items-center gap-1 mt-1 sm:mt-0">
                        <button
                          type="button"
                          onClick={() => saveEdit(source.id)}
                          disabled={savingEdit}
                          className="flex items-center gap-1 rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400"
                        >
                          <Save className="h-3 w-3" />
                          <span>Guardar</span>
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-zinc-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                          source.active
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-zinc-700 bg-zinc-800/40 text-zinc-500'
                        }`}
                      >
                        {source.active ? (
                          <Radio className="h-3.5 w-3.5" />
                        ) : (
                          <Layers className="h-3.5 w-3.5" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-zinc-100">
                            {source.name}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                              source.active
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {source.active ? 'Activa en selector' : 'Desactivada'}
                          </span>
                          {(source.leadCount ?? 0) > 0 && (
                            <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300 font-medium tabular-nums">
                              {source.leadCount?.toLocaleString()} prospectos
                            </span>
                          )}
                        </div>

                        {source.description && (
                          <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-1">
                            {source.description}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(source)}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                        title="Editar nombre"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(source)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium border transition-colors ${
                          source.active
                            ? 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-red-300'
                            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        }`}
                      >
                        {source.active ? (
                          <>
                            <XCircle className="h-3.5 w-3.5 text-zinc-400" />
                            <span>Desactivar</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Activar</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal para crear nueva fuente */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Compass className="h-4 w-4 text-emerald-400" />
                <span>Nueva Fuente de Ubicación</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-300">
                  Nombre de la fuente *
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej. FERIA CORFERIAS DICIEMBRE 2026, TikTok Ads, etc."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-emerald-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-300">
                  Descripción o notas (opcional)
                </label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Detalles sobre el evento, stand o campaña..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-xs text-zinc-100 outline-none focus:border-emerald-500 resize-none h-20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <Button
                  type="submit"
                  disabled={!newName.trim() || creating}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs"
                >
                  {creating ? 'Guardando...' : 'Crear y Activar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
