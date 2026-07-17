import { Download, ListFilter, MoreHorizontal, Plus, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import type { LeadList, LeadListFilters } from '../services/leadLists.service';

interface LeadListsBarProps {
  lists: LeadList[];
  selectedId: string;
  total: number;
  countForList: (list: LeadList) => number;
  onSelect: (list: LeadList | null) => void;
  onImport: () => void;
  onHistory: () => void;
  onCreate: () => void;
  onDelete: (list: LeadList) => void;
  canImport: boolean;
}

export function LeadListsBar({ lists, selectedId, total, countForList, onSelect, onImport, onHistory, onCreate, onDelete, canImport }: LeadListsBarProps) {
  const [menuId, setMenuId] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button onClick={() => onSelect(null)} className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-xs transition-colors ${selectedId === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}>
          <UsersRound size={13} /> Todos <span className="text-[10px] text-zinc-600">{total}</span>
        </button>
        {lists.map((list) => (
          <div key={list.id} className="relative flex shrink-0 items-center">
            <button onClick={() => onSelect(list)} className={`flex h-8 items-center gap-2 rounded-md pl-3 pr-8 text-xs transition-colors ${selectedId === list.id ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}>
              <ListFilter size={13} /> {list.name} <span className="text-[10px] opacity-60">{countForList(list)}</span>
            </button>
            <button onClick={() => setMenuId(menuId === list.id ? null : list.id)} title="Opciones de lista" className="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:text-zinc-300"><MoreHorizontal size={14} /></button>
            {menuId === list.id && (
              <div className="absolute right-0 top-9 z-20 w-36 rounded-md border border-zinc-700 bg-zinc-800 p-1 shadow-xl">
                <button onClick={() => { setMenuId(null); onDelete(list); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><X size={13} /> Eliminar lista</button>
              </div>
            )}
          </div>
        ))}
        <button onClick={onCreate} className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs text-zinc-500 hover:text-violet-300"><Plus size={13} /> Lista inteligente</button>
      </div>
      {canImport && (
        <div className="ml-3 flex shrink-0 gap-2">
          <Button onClick={onHistory} variant="ghost" size="sm">Historial</Button>
          <Button onClick={onImport} variant="secondary" size="sm"><Download size={14} /> Importar</Button>
        </div>
      )}
    </div>
  );
}

export function ImportHistoryModal({
  lists,
  onClose,
}: {
  lists: LeadList[];
  onClose: () => void;
}) {
  const imports = lists.filter((list) => list.kind === 'import').sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div className="relative z-10 w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Historial de importaciones</h2>
            <p className="mt-1 text-xs text-zinc-500">Auditoria de archivos importados y resumen de resultados.</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={17} /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-5">
          {imports.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">Aun no hay importaciones.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              {imports.map((list) => (
                <div key={list.id} className="grid gap-3 border-b border-zinc-800 bg-zinc-900/40 p-4 last:border-b-0 md:grid-cols-[1fr_110px_110px_110px_110px]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{list.name}</p>
                    <p className="mt-1 truncate text-[11px] text-zinc-500">
                      {list.sourceFileName || 'Archivo no registrado'} - {list.createdAt ? new Date(list.createdAt).toLocaleString('es-CO') : ''}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-600">{list.sourceRowCount ?? 0} filas leidas</p>
                  </div>
                  <ImportStat label="Total" value={list.importedCount ?? 0} />
                  <ImportStat label="Creados" value={list.importedCreated ?? 0} tone="text-emerald-400" />
                  <ImportStat label="Actualizados" value={list.importedUpdated ?? 0} tone="text-sky-400" />
                  <ImportStat label="Omitidos" value={list.importedInvalid ?? 0} tone="text-amber-400" />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-zinc-800 px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  );
}

function ImportStat({ label, value, tone = 'text-zinc-300' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2">
      <p className={`text-sm font-semibold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}

interface SmartListModalProps {
  filters: LeadListFilters;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export function SmartListModal({ filters, onClose, onCreate }: SmartListModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = [
    filters.status !== 'all' ? `Estado: ${filters.status}` : null,
    filters.aiEnabled !== 'all' ? `Atención: ${filters.aiEnabled === 'active' ? 'IA activa' : 'manual'}` : null,
    filters.assignedTo !== 'all' ? `Asesor: ${filters.assignedTo === 'unassigned' ? 'sin asignar' : 'seleccionado'}` : null,
    filters.inboxId !== 'all' ? 'Número específico' : null,
    ...filters.tags.map((tag) => `Etiqueta: ${tag}`),
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (createError) {
      setError(createError instanceof Error ? createError.message.replace(/^FirebaseError:\s*/, '') : 'No se pudo crear la lista.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
          <div><h2 className="text-sm font-semibold text-zinc-100">Nueva lista inteligente</h2><p className="mt-1 text-xs text-zinc-500">Guardará los filtros actuales y se actualizará automáticamente.</p></div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={17} /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="text-xs text-zinc-400">Nombre<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Leads calificados sin asesor" className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" /></label>
          <div><p className="mb-2 text-[10px] font-semibold uppercase text-zinc-600">Reglas guardadas</p><div className="flex flex-wrap gap-1.5">{rules.length ? rules.map((rule) => <span key={rule} className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300">{rule}</span>) : <span className="text-xs text-zinc-600">Sin filtros: incluirá todos los contactos.</span>}</div></div>
          {error && <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4"><Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button><Button size="sm" onClick={submit} loading={saving} disabled={!name.trim()}>Crear lista</Button></div>
      </div>
    </div>
  );
}
