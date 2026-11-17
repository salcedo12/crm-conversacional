import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { DealSheet, DealSheetFooter, dealInputCls } from './DealSheet';
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
    <DealSheet
      title="Lote del negocio"
      subtitle="Disponibilidad en vivo del inventario. Al apartarlo queda en negociación por 24 horas."
      icon={<MapPin size={18} />}
      onClose={onClose}
      width="lg"
      toolbar={
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex sm:items-center">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={`${dealInputCls} col-span-2 sm:w-auto`}
              aria-label="Proyecto"
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.available} disponibles</option>)}
            </select>
            <div className="relative min-w-0 sm:flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Número o código"
                inputMode="numeric"
                type="search"
                className={`${dealInputCls} pl-9 sm:pl-8`}
              />
            </div>
            <button
              type="button"
              onClick={() => void loadLots()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-400 hover:text-zinc-200 sm:rounded-md sm:px-2.5 sm:py-1.5 sm:text-[11px]"
              title="Actualizar disponibilidad"
              aria-label="Actualizar disponibilidad"
            >
              <RefreshCw size={14} className={loadingLots ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">
                {refreshedAt ? refreshedAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Actualizar'}
              </span>
            </button>
          </div>
          {sectors.length > 1 && (
            // En celular los sectores se deslizan de lado en vez de ocupar varias filas.
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
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
      }
      footer={
        <DealSheetFooter
          error={error}
          info={selected ? (
            <span className="flex items-center gap-1.5 text-sm text-zinc-200 sm:text-xs">
              <MapPin size={14} className="shrink-0 text-emerald-400" />
              <span className="truncate">
                {selected.sector} · Lote {selected.number}{selected.code ? ` · Cód. ${selected.code}` : ''} · {formatArea(selected.areaM2)}{selected.corner ? ' · Esquinero' : ''}
              </span>
            </span>
          ) : 'Toca un lote disponible para escogerlo.'}
          actions={<>
            <Button variant="ghost" onClick={onClose} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">Cancelar</Button>
            <Button onClick={handleReserve} loading={reserving} disabled={!selected} className="h-11 sm:h-auto sm:px-3 sm:py-1.5 sm:text-xs">
              {selected ? `Apartar lote ${selected.number}` : 'Apartar lote'}
            </Button>
          </>}
        />
      }
    >
      {loadingLots && !lots.length ? (
        <p className="flex items-center gap-1.5 text-sm text-zinc-500 sm:text-xs"><Loader2 size={14} className="animate-spin" /> Cargando disponibilidad…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-zinc-500 sm:text-xs">{project ? 'No hay lotes disponibles con ese filtro.' : 'Selecciona un proyecto.'}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6">
          {visible.map((lot) => {
            const active = selected?.id === lot.id;
            return (
              <button
                key={lot.id}
                type="button"
                onClick={() => setSelected(lot)}
                aria-pressed={active}
                className={`min-h-[64px] rounded-lg border px-2 py-2 text-left transition-colors ${
                  active
                    ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/50'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-emerald-500/50'
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-base font-semibold text-zinc-100 sm:text-sm">{lot.number}</p>
                  {lot.code && (
                    <span className="font-mono text-[10px] text-zinc-400 sm:text-[9px]">
                      {lot.code}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-zinc-500 sm:text-[10px]">{formatArea(lot.areaM2)}</p>
                {(sectors.length > 1 && !sector) && <p className="truncate text-[10px] text-zinc-600 sm:text-[9px]">{lot.sector}</p>}
                {lot.corner && <p className="mt-0.5 text-[10px] font-semibold uppercase text-amber-300/90 sm:text-[9px]">Esquinero</p>}
              </button>
            );
          })}
        </div>
      )}
    </DealSheet>
  );
}

function SectorChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs sm:px-2.5 sm:py-0.5 sm:text-[11px] ${
        active ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}
