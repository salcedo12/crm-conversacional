import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  formatArea,
  listAvailableLots,
  listInventoryProjects,
  reserveDealLot,
  type AvailableLot,
  type DealSummary,
  type InventoryProject,
} from '../services/deals.service';

interface DealLotPickerModalProps {
  companyId:         string;
  deal:              DealSummary;
  /** Proyecto de interés del lead ('Laguna Mar') para preseleccionarlo. */
  projectHint?:      string;
  onClose:           () => void;
  onReserved:        () => void;
}

/** Cada cuánto se vuelve a pedir la disponibilidad mientras el selector está abierto. */
const REFRESH_MS = 20_000;

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function DealLotPickerModal({ companyId, deal, projectHint, onClose, onReserved }: DealLotPickerModalProps) {
  const [projects, setProjects] = useState<InventoryProject[]>([]);
  const [projectId, setProjectId] = useState(deal.lot?.projectId ?? '');
  const [lots, setLots] = useState<AvailableLot[]>([]);
  const [sector, setSector] = useState<string>('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AvailableLot | null>(null);
  const [loadingLots, setLoadingLots] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listInventoryProjects(companyId)
      .then((list) => {
        setProjects(list);
        if (!projectId && list.length) {
          const hint = projectHint ? normalize(projectHint) : '';
          const match = list.find((p) => hint && (normalize(p.name) === hint || normalize(p.id) === hint));
          setProjectId((match ?? list[0]).id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el inventario.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const loadLots = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setLoadingLots(true);
    try {
      const res = await listAvailableLots(companyId, projectId);
      setLots(res.lots);
      setRefreshedAt(new Date());
      // Si el lote elegido ya no está disponible (otro asesor lo tomó), se deselecciona.
      setSelected((cur) => (cur && !res.lots.some((l) => l.id === cur.id) ? null : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la disponibilidad.');
    } finally {
      if (!silent) setLoadingLots(false);
    }
  }, [companyId, projectId]);

  useEffect(() => {
    setSector('');
    setSelected(null);
    void loadLots();
    const timer = window.setInterval(() => void loadLots(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadLots]);

  const project = projects.find((p) => p.id === projectId);
  const sectors = useMemo(() => Array.from(new Set(lots.map((l) => l.sector))), [lots]);
  const visible = useMemo(() => lots.filter((l) =>
    (!sector || l.sector === sector) && (!query.trim() || l.number.startsWith(query.trim()) || l.code.includes(query.trim()))),
  [lots, sector, query]);

  const handleReserve = async () => {
    if (!selected) return;
    setReserving(true);
    setError(null);
    try {
      await reserveDealLot(companyId, deal.id, selected.id);
      onReserved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo apartar el lote.');
      void loadLots(true);
    } finally {
      setReserving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Lote del negocio</h2>
            <p className="text-[11px] text-zinc-500">Disponibilidad en vivo del inventario. Al apartarlo queda en negociación por 24 horas.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-3 border-b border-zinc-800 px-5 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-800/90 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              aria-label="Proyecto"
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.available} disponibles</option>)}
            </select>
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por número o código"
                inputMode="numeric"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800/90 py-1.5 pl-8 pr-2.5 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadLots()}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
              title="Actualizar disponibilidad"
            >
              <RefreshCw size={12} className={loadingLots ? 'animate-spin' : ''} />
              {refreshedAt ? refreshedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Actualizar'}
            </button>
          </div>
          {sectors.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <SectorChip label={`Todos (${lots.length})`} active={!sector} onClick={() => setSector('')} />
              {sectors.map((s) => (
                <SectorChip
                  key={s}
                  label={`${s} (${lots.filter((l) => l.sector === s).length})`}
                  active={sector === s}
                  onClick={() => setSector(s)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingLots && !lots.length ? (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500"><Loader2 size={12} className="animate-spin" /> Cargando disponibilidad…</p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-zinc-500">{project ? 'No hay lotes disponibles con ese filtro.' : 'Selecciona un proyecto.'}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {visible.map((lot) => {
                const active = selected?.id === lot.id;
                return (
                  <button
                    key={lot.id}
                    type="button"
                    onClick={() => setSelected(lot)}
                    className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                      active
                        ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/50'
                        : 'border-zinc-800 bg-zinc-950/40 hover:border-emerald-500/50'
                    }`}
                  >
                    <p className="text-sm font-semibold text-zinc-100">{lot.number}</p>
                    <p className="truncate text-[10px] text-zinc-500">{formatArea(lot.areaM2)}</p>
                    {(sectors.length > 1 && !sector) && <p className="truncate text-[9px] text-zinc-600">{lot.sector}</p>}
                    {lot.corner && <p className="mt-0.5 text-[9px] font-semibold uppercase text-amber-300/90">Esquinero</p>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-zinc-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-xs text-red-300">{error}</p>
          ) : selected ? (
            <p className="flex items-center gap-1.5 text-xs text-zinc-300">
              <MapPin size={13} className="text-emerald-400" />
              {selected.sector} · Lote {selected.number} · {formatArea(selected.areaM2)}{selected.corner ? ' · Esquinero' : ''}
            </p>
          ) : (
            <span className="text-[11px] text-zinc-500">Elige un lote disponible.</span>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={handleReserve} loading={reserving} disabled={!selected}>
              Apartar lote
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SectorChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
        active ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}
