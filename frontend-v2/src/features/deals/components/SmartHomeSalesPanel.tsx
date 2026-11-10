import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign, CalendarDays, Download, Eye, EyeOff, ExternalLink, FileText, Filter, Loader2, MapPin,
  Paperclip, Phone, RefreshCw, RotateCcw, Search, UserRound, X,
} from 'lucide-react';
import {
  fetchSmartHomeFile, saveBlob, setSmartHomeSaleIgnored, smartHomeFilesUrl,
  type InventoryOnlySale, type SmartHomeFileBlob, type SmartHomeSale,
} from '../services/smarthomeSales.service';

type InventoryFilter = 'all' | 'mismatch' | 'missing';

const INVENTORY_PILL: Record<'ok' | 'mismatch' | 'missing', string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  mismatch: 'border-red-500/40 bg-red-500/10 text-red-300',
  missing: 'border-zinc-600 bg-zinc-800/60 text-zinc-400',
};

function inventoryLabel(sale: SmartHomeSale): string | null {
  if (!sale.inventoryMatch) return null;
  if (sale.inventoryMatch === 'missing') return 'No está en disponibilidad';
  return `Disponibilidad: ${sale.inventoryStatus}`;
}

/** Lotes vendidos en SmartHome de un proyecto (o sector de Laguna Mar). Solo lectura. */

function money(value = 0) {
  return `$ ${Math.round(value).toLocaleString('es-CO')}`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-CO', { dateStyle: 'medium' });
}

function syncLabel(value: number | null) {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca';
}

export function SmartHomeSalesPanel({ sales, inventoryOnly, inventoryCheckedAt, companyId, isAdmin, lastSyncAt, syncing, onSync, onChanged }: {
  sales: SmartHomeSale[];
  /** Lotes que la disponibilidad da por vendidos y SmartHome no. */
  inventoryOnly: InventoryOnlySale[];
  inventoryCheckedAt: number | null;
  companyId: string;
  isAdmin: boolean;
  lastSyncAt: number | null;
  syncing: boolean;
  onSync: () => void;
  onChanged: (sale: SmartHomeSale) => void;
}) {
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('all');
  const [advisor, setAdvisor] = useState('all');
  const [showIgnored, setShowIgnored] = useState(false);
  const [filesFilter, setFilesFilter] = useState<'all' | 'with' | 'without'>('all');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [showInventoryOnly, setShowInventoryOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => sales.filter((sale) => showIgnored || !sale.ignored), [sales, showIgnored]);
  const sectors = useMemo(() => Array.from(new Set(visible.map((sale) => sale.sector))).sort((a, b) => a.localeCompare(b, 'es')), [visible]);
  const advisors = useMemo(() => Array.from(new Set(visible.map((sale) => sale.advisorName || 'Sin asesor'))).sort((a, b) => a.localeCompare(b, 'es')), [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible
      .filter((sale) => sector === 'all' || sale.sector === sector)
      .filter((sale) => advisor === 'all' || (sale.advisorName || 'Sin asesor') === advisor)
      .filter((sale) => filesFilter === 'all' || (filesFilter === 'with') === (sale.files.length > 0))
      .filter((sale) => inventoryFilter === 'all' || sale.inventoryMatch === inventoryFilter)
      .filter((sale) => !q || [sale.buyerName, sale.identificationNumber, sale.mobileNumber, sale.lotNumber, sale.lotName, sale.sector, sale.advisorName]
        .some((value) => String(value ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.sector.localeCompare(b.sector, 'es') || a.lotNumber.localeCompare(b.lotNumber, 'es', { numeric: true }));
  }, [visible, search, sector, advisor, filesFilter, inventoryFilter]);
  const withoutFiles = visible.filter((sale) => !sale.ignored && !sale.files.length).length;
  const mismatches = visible.filter((sale) => !sale.ignored && sale.inventoryMatch === 'mismatch').length;
  const missingInInventory = visible.filter((sale) => !sale.ignored && sale.inventoryMatch === 'missing').length;
  const discrepancies = mismatches + missingInInventory + inventoryOnly.length;

  const counted = visible.filter((sale) => !sale.ignored);
  const allFiles = counted.flatMap((sale) => sale.files);
  const copiedFiles = allFiles.filter((file) => file.copied).length;
  const totalValue = counted.reduce((sum, sale) => sum + sale.value, 0);
  const ignoredCount = sales.filter((sale) => sale.ignored).length;
  const selected = sales.find((sale) => sale.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={MapPin} label="Lotes vendidos" value={String(counted.length)} />
        <Stat icon={Paperclip} label="Archivos en el CRM" value={`${copiedFiles} / ${allFiles.length}`} />
        <Stat icon={BadgeDollarSign} label="Valor vendido" value={money(totalValue)} />
        <Stat icon={RefreshCw} label="Actualizado" value={syncLabel(lastSyncAt)} small />
      </section>

      {inventoryCheckedAt && discrepancies > 0 && (
        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-zinc-300">
          <p className="font-bold text-red-300">{discrepancies} lote(s) no coinciden con la disponibilidad</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {mismatches > 0 && (
              <button onClick={() => setInventoryFilter('mismatch')} className="rounded-lg border border-red-500/40 px-2.5 py-1 text-[11px] text-red-200 hover:bg-red-500/10">
                {mismatches} vendido(s) en SmartHome que la disponibilidad no da por vendidos
              </button>
            )}
            {missingInInventory > 0 && (
              <button onClick={() => setInventoryFilter('missing')} className="rounded-lg border border-zinc-600 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
                {missingInInventory} que no están en la disponibilidad
              </button>
            )}
            {inventoryOnly.length > 0 && (
              <button onClick={() => setShowInventoryOnly((value) => !value)} className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-500/10">
                {inventoryOnly.length} vendido(s) en disponibilidad que SmartHome no da por vendidos
              </button>
            )}
          </div>
          {showInventoryOnly && inventoryOnly.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {inventoryOnly.map((lot) => (
                <li key={`${lot.sector}-${lot.lotNumber}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-semibold text-zinc-100">{lot.sector} · Lote {lot.lotNumber}</span>
                  <span className="text-[11px] text-zinc-400">Disponibilidad: VENDIDO · SmartHome: {lot.smartHomeStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar comprador, cédula, celular o lote" className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-xs text-zinc-100 outline-none focus:border-emerald-500/60" />
        </label>
        {sectors.length > 1 && (
          <label className="relative">
            <Filter size={14} className="absolute left-3 top-2.5 text-zinc-500" />
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-8 text-xs text-zinc-300 outline-none">
              <option value="all">Todos los sectores</option>
              {sectors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <select value={filesFilter} onChange={(e) => setFilesFilter(e.target.value as typeof filesFilter)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none">
          <option value="all">Con y sin archivos</option>
          <option value="with">Con archivos</option>
          <option value="without">Sin archivos ({withoutFiles})</option>
        </select>
        {inventoryCheckedAt && (
          <select value={inventoryFilter} onChange={(e) => setInventoryFilter(e.target.value as InventoryFilter)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none">
            <option value="all">Disponibilidad: todos</option>
            <option value="mismatch">No coincide ({mismatches})</option>
            <option value="missing">No está en disponibilidad ({missingInInventory})</option>
          </select>
        )}
        {isAdmin && advisors.length > 1 && (
          <select value={advisor} onChange={(e) => setAdvisor(e.target.value)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none">
            <option value="all">Todos los asesores</option>
            {advisors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {isAdmin && ignoredCount > 0 && (
          <label className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
            <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} className="accent-emerald-500" />
            Ver pruebas ({ignoredCount})
          </label>
        )}
        {isAdmin && (
          <button onClick={onSync} disabled={syncing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Trayendo…' : 'Traer de SmartHome'}
          </button>
        )}
        {syncing && <p className="w-full text-[11px] text-zinc-500">Trae los 3 proyectos de SmartHome y copia archivos; puede tardar varios minutos. No cierres esta pantalla.</p>}
      </section>

      {!filtered.length ? (
        <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">
          {sales.length ? 'No hay ventas con estos filtros.' : 'Aún no hay ventas sincronizadas de SmartHome para este proyecto.'}
        </div>
      ) : (
        <section className="grid gap-3 xl:grid-cols-2">
          {filtered.map((sale) => (
            <button key={sale.id} onClick={() => setSelectedId(sale.id)} className={`rounded-xl border bg-zinc-900/70 p-4 text-left transition hover:border-sky-500/30 hover:bg-zinc-900 ${sale.ignored ? 'border-dashed border-zinc-700 opacity-60' : 'border-zinc-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-zinc-100">{sale.buyerName || 'Sin comprador en SmartHome'}</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500"><UserRound size={11} /> {sale.advisorName || 'Sin asesor'} · {shortDate(sale.closeDate || sale.createdDate)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${sale.ignored ? 'border-zinc-600 text-zinc-400' : 'border-sky-500/30 bg-sky-500/10 text-sky-300'}`}>
                  {sale.ignored ? 'Prueba' : sale.stageName || sale.unitStatusLabel}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-[1.5fr_0.8fr] gap-2 text-xs">
                <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
                  <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-sky-400"><MapPin size={11} /> Lote</p>
                  <p className="mt-1 text-sm font-extrabold text-zinc-100">{sale.sector} · Lote {sale.lotNumber}</p>
                  <p className="mt-1 text-[10px] text-zinc-500">{sale.areaM2 ? `${sale.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m² · ` : ''}{sale.unitStatusLabel}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-zinc-400"><BadgeDollarSign size={14} className="mb-2 text-amber-400" /><p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">Valor</p><p className="mt-1 text-sm font-bold text-zinc-200">{sale.value ? money(sale.value) : '—'}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                <span className={`rounded-full border px-2 py-1 ${sale.files.length ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                  <Paperclip size={10} className="mr-1 inline" />{sale.files.length ? `${sale.files.length} archivo(s)${sale.files.every((file) => file.fromLot) ? ' de otro lote' : ''}` : 'Sin archivos'}
                </span>
                {sale.identificationNumber && <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-400">CC {sale.identificationNumber}</span>}
                {inventoryLabel(sale) && sale.inventoryMatch && (
                  <span className={`rounded-full border px-2 py-1 ${INVENTORY_PILL[sale.inventoryMatch]}`}>{inventoryLabel(sale)}</span>
                )}
              </div>
            </button>
          ))}
        </section>
      )}

      {selected && (
        <SmartHomeSaleModal
          sale={selected}
          companyId={companyId}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function SmartHomeSaleModal({ sale, companyId, isAdmin, onClose, onChanged }: {
  sale: SmartHomeSale;
  companyId: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (sale: SmartHomeSale) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<(SmartHomeFileBlob & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filesUrl = sale.prospectId && sale.smartHomeProjectId ? smartHomeFilesUrl(sale) : null;
  const copiedCount = sale.files.filter((file) => file.copied).length;
  const missingCount = sale.files.filter((file) => file.missing).length;
  const copyingCount = sale.files.length - copiedCount - missingCount;

  // Libera la URL del archivo abierto al cambiarlo o cerrar.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const openFile = async (fileId: string, mode: 'view' | 'download') => {
    setDownloading(`${mode}:${fileId}`);
    setError(null);
    try {
      const file = await fetchSmartHomeFile(companyId, fileId);
      if (mode === 'download') saveBlob(file.blob, file.fileName);
      else setPreview({ ...file, url: URL.createObjectURL(file.blob) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el archivo.');
    } finally {
      setDownloading(null);
    }
  };

  const toggleIgnored = async () => {
    setSaving(true);
    setError(null);
    try {
      await setSmartHomeSaleIgnored(companyId, sale.id, !sale.ignored);
      onChanged({ ...sale, ignored: !sale.ignored });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-zinc-800 bg-zinc-950/95 p-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Vendido en SmartHome</p>
            <h2 className="mt-0.5 text-xl font-extrabold text-zinc-100">{sale.sector} · Lote {sale.lotNumber}</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">{sale.lotName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X size={18} /></button>
        </header>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Comprador</h3>
            <div className="mt-3 space-y-2 text-xs text-zinc-400">
              <p className="text-sm font-bold text-zinc-100">{sale.buyerName || 'Sin comprador'}</p>
              {sale.identificationNumber && <p><strong className="text-zinc-200">Cédula:</strong> {sale.identificationNumber}</p>}
              {sale.mobileNumber && <p className="flex items-center gap-1"><Phone size={11} /> {sale.mobileNumber}</p>}
              {sale.email && <p className="truncate"><strong className="text-zinc-200">Correo:</strong> {sale.email}</p>}
              {sale.city && <p><strong className="text-zinc-200">Ciudad:</strong> {sale.city}</p>}
            </div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Venta</h3>
            <div className="mt-3 space-y-2 text-xs text-zinc-400">
              <p><strong className="text-zinc-200">Valor:</strong> {sale.value ? money(sale.value) : '—'}</p>
              {sale.deposit > 0 && <p><strong className="text-zinc-200">Separación:</strong> {money(sale.deposit)}</p>}
              <p><strong className="text-zinc-200">Etapa:</strong> {[sale.saleCycleName, sale.stageName].filter(Boolean).join(' · ') || '—'}</p>
              <p><strong className="text-zinc-200">Asesor:</strong> {sale.advisorName || '—'}</p>
              <p className="flex items-center gap-1"><CalendarDays size={11} /> Creado {shortDate(sale.createdDate)} · Cierre {shortDate(sale.closeDate)}</p>
              <p><strong className="text-zinc-200">Área:</strong> {sale.areaM2 ? `${sale.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²` : '—'} · {sale.unitStatusLabel}</p>
              {sale.inventoryMatch && (
                <p className={sale.inventoryMatch === 'ok' ? 'text-emerald-300' : sale.inventoryMatch === 'mismatch' ? 'text-red-300' : 'text-zinc-400'}>
                  <strong className="text-zinc-200">Disponibilidad:</strong>{' '}
                  {sale.inventoryMatch === 'missing' ? 'este lote no está en la disponibilidad' : sale.inventoryStatus}
                  {sale.inventoryMatch === 'mismatch' && ' — no coincide con SmartHome'}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Archivos subidos en SmartHome ({sale.files.length})</h3>
              {filesUrl && sale.files.length > 0 && (
                <a href={filesUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20">
                  <ExternalLink size={12} /> Ver en SmartHome
                </a>
              )}
            </div>
            {sale.files.length ? (
              <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                {sale.files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300">
                    <FileText size={13} className="shrink-0 text-sky-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {file.title}
                      {file.fromLot && <span className="ml-2 text-[10px] text-zinc-500">· subido en {file.fromLot}</span>}
                    </span>
                    {file.copied ? (
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => void openFile(file.id, 'view')} disabled={downloading !== null} title="Ver" className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 px-2 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
                          {downloading === `view:${file.id}` ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Ver
                        </button>
                        <button onClick={() => void openFile(file.id, 'download')} disabled={downloading !== null} title="Descargar" className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-zinc-800 disabled:opacity-50">
                          {downloading === `download:${file.id}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Descargar
                        </button>
                      </div>
                    ) : file.missing
                      ? <span className="shrink-0 text-[10px] text-red-300" title="SmartHome lo lista pero el archivo ya no existe en su almacenamiento">No existe en SmartHome</span>
                      : <span className="shrink-0 text-[10px] text-amber-300">Copiando…</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-xs text-zinc-500">Este cliente no tiene archivos en SmartHome.</p>}
            {sale.files.length > 0 && (
              <p className="mt-2 text-[10px] text-zinc-500">
                {copiedCount === sale.files.length
                  ? 'Todos los archivos están guardados en el CRM.'
                  : [
                    `${copiedCount} de ${sale.files.length} guardados en el CRM.`,
                    copyingCount > 0 ? `${copyingCount} se siguen intentando copiar cada hora.` : '',
                    missingCount > 0 ? `${missingCount} ya no existen en SmartHome: hay que conseguirlos por otro lado.` : '',
                  ].filter(Boolean).join(' ')}
              </p>
            )}
          </section>
        </div>

        {isAdmin && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 p-4">
            {error && <p className="mr-auto text-xs text-red-300">{error}</p>}
            <button onClick={() => void toggleIgnored()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : sale.ignored ? <RotateCcw size={13} /> : <EyeOff size={13} />}
              {sale.ignored ? 'Contar como venta real' : 'Marcar como prueba'}
            </button>
          </footer>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <header className="mx-auto flex w-full max-w-5xl items-center gap-2 pb-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">{preview.fileName}</p>
            <button onClick={() => saveBlob(preview.blob, preview.fileName)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
              <Download size={13} /> Descargar
            </button>
            <button onClick={() => setPreview(null)} title="Cerrar" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X size={18} /></button>
          </header>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center overflow-auto rounded-xl border border-zinc-800 bg-zinc-950">
            {preview.kind === 'image' && <img src={preview.url} alt={preview.fileName} className="max-h-full max-w-full object-contain" />}
            {preview.kind === 'pdf' && <iframe src={preview.url} title={preview.fileName} className="h-full w-full rounded-xl bg-white" />}
            {preview.kind === 'other' && (
              <div className="p-8 text-center text-sm text-zinc-400">
                <FileText size={32} className="mx-auto mb-3 text-sky-400" />
                Este tipo de archivo ({preview.contentType}) no se puede ver aquí.
                <button onClick={() => saveBlob(preview.blob, preview.fileName)} className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">
                  <Download size={13} /> Descargar para abrirlo
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, small = false }: { icon: typeof MapPin; label: string; value: string; small?: boolean }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><Icon size={15} className="text-sky-400" /><p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p><p className={`mt-0.5 truncate font-bold text-zinc-100 ${small ? 'text-xs' : 'text-base'}`}>{value}</p></div>;
}
