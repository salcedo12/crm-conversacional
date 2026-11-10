import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BadgeDollarSign, Building2, CheckCircle2, Download, FileCheck2, FileText, Filter,
  Handshake, Loader2, MapPin, Paperclip, Phone, RefreshCw, Search, Trash2,
  Upload, UserRound, X, XCircle,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import {
  DEAL_STATUS_LABELS,
  deleteDealAttachment,
  downloadDealAttachment,
  downloadDealDocument,
  fetchDealDocumentPdf,
  listCompanyDeals,
  listInventoryProjects,
  uploadDealAttachment,
  type DealAttachment,
  type DealAttachmentCategory,
  type DealDocumentKind,
  type DealStatus,
  type DealSummary,
} from '../services/deals.service';
import { referralName } from '../utils/paymentPlan';
import { listSmartHomeSales, syncSmartHomeSalesNow, type InventoryOnlySale, type SmartHomeSale } from '../services/smarthomeSales.service';
import { DealSignatureStatus } from '../components/DealSignatureStatus';
import { DealDocumentPreview } from '../components/DealDocumentPreview';
import { NewDealByPhoneModal } from '../components/NewDealByPhoneModal';
import { SmartHomeSalesPanel } from '../components/SmartHomeSalesPanel';

const PROJECT_NAMES: Record<string, string> = {
  'rio-claro': 'Río Claro',
  'cañon-arizona': 'Cañón de Arizona',
  'arizona-1': 'Arizona 1',
  'arizona-2': 'Arizona 2',
  'gran-arizona': 'Gran Arizona',
  'laguna-mar': 'Laguna Mar',
  'sobre-montañas': 'Sobre Montañas',
  'llano-grande': 'Llano Grande',
};

interface ProjectCatalogItem {
  key: string;
  name: string;
  subtitle: string;
  projectIds: string[];
  logo: string;
  accent: string;
}

const PROJECT_CATALOG: ProjectCatalogItem[] = [
  { key: 'cañon-arizona', name: 'Cañón de Arizona', subtitle: 'Bungalow Luxury Living Club', projectIds: ['cañon-arizona', 'arizona-1', 'arizona-2', 'gran-arizona'], logo: '/project-logos/canon-de-arizona.png', accent: 'from-emerald-950/80 to-lime-950/30' },
  { key: 'llano-grande', name: 'Llano Grande', subtitle: 'Proyecto campestre', projectIds: ['llano-grande'], logo: '/project-logos/llano-grande.png', accent: 'from-amber-950/70 to-orange-950/30' },
  { key: 'rio-claro', name: 'Río Claro', subtitle: 'Luxury Living Club', projectIds: ['rio-claro'], logo: '/project-logos/rio-claro.png', accent: 'from-sky-950/80 to-cyan-950/30' },
  { key: 'sobre-montañas', name: 'Sobre Montañas', subtitle: 'Condominio campestre', projectIds: ['sobre-montañas'], logo: '/project-logos/sobre-montanas.png', accent: 'from-violet-950/80 to-fuchsia-950/30' },
  { key: 'laguna-mar', name: 'Laguna Mar', subtitle: 'Ciudad Country', projectIds: ['laguna-mar'], logo: '/project-logos/laguna-mar.png', accent: 'from-blue-950/80 to-teal-950/30' },
];

const LAGUNA_SECTORS = [
  { key: 'MAR SANTORINI', name: 'Mar Santorini', subtitle: 'Laguna Mar', logo: '/project-logos/mar-santorini.png', accent: 'from-indigo-950/80 to-sky-950/30' },
  { key: 'MAR CANARIAS', name: 'Mar Canarias', subtitle: 'Laguna Mar', logo: '/project-logos/mar-canarias.png', accent: 'from-cyan-950/80 to-emerald-950/30' },
];

const CATEGORY_LABELS: Record<DealAttachmentCategory, string> = {
  buyer_identification: 'Cédula / documento del comprador',
  benefit_authorization: 'Autorización de bono o descuento',
  referral_evidence: 'Pantallazo o evidencia del referido',
  separation_payment: 'Soporte de pago de separación',
};

const STATUS_STYLE: Record<DealStatus, string> = {
  borrador: 'border-zinc-700 bg-zinc-800 text-zinc-300',
  plan_listo: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  preventa_en_firma: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  preventa_firmada: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  promesa_en_firma: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  promesa_firmada: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  anulado: 'border-red-500/30 bg-red-500/10 text-red-300',
};

function money(value = 0) {
  return `$ ${Math.round(value).toLocaleString('es-CO')}`;
}

function dateTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function projectName(projectId: string | undefined) {
  if (!projectId) return 'Proyecto sin definir';
  return PROJECT_NAMES[projectId] || projectId.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function supportStats(deal: DealSummary) {
  const attachments = deal.attachments ?? [];
  const buyerDocs = new Set(attachments.filter((a) => a.category === 'buyer_identification').map((a) => a.buyerClientId)).size;
  const paymentProofs = attachments.filter((a) => a.category === 'separation_payment').length;
  const authorization = attachments.some((a) => a.category === 'benefit_authorization');
  const referral = attachments.some((a) => a.category === 'referral_evidence');
  const separationPayments = deal.plan?.simple?.separationPayments?.length
    ?? deal.plan?.rows.filter((row) => row.kind === 'separacion').reduce((sum, row) => sum + row.count, 0)
    ?? 0;
  return { buyerDocs, paymentProofs, authorization, referral, separationPayments };
}

export function DealsPage() {
  const { companyId, role, platformAdmin, user } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DealStatus>('all');
  const [advisor, setAdvisor] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [view, setView] = useState<'crm' | 'smarthome'>('crm');
  const [shSales, setShSales] = useState<SmartHomeSale[]>([]);
  const [shEnabled, setShEnabled] = useState(false);
  const [shLastSync, setShLastSync] = useState<number | null>(null);
  const [shSyncing, setShSyncing] = useState(false);
  const [shInventoryOnly, setShInventoryOnly] = useState<InventoryOnlySale[]>([]);
  const [shInventoryCheckedAt, setShInventoryCheckedAt] = useState<number | null>(null);
  const [creatingDeal, setCreatingDeal] = useState(false);
  /** Lotes DISPONIBLES por proyecto del inventario (null = no se pudo leer). */
  const [available, setAvailable] = useState<Record<string, number> | null>(null);

  const loadSmartHome = async () => {
    if (!companyId) return;
    const result = await listSmartHomeSales(companyId);
    setShEnabled(result.enabled);
    setShSales(result.sales);
    setShLastSync(result.lastSyncAt);
    setShInventoryOnly(result.inventoryOnly ?? []);
    setShInventoryCheckedAt(result.inventoryCheckedAt ?? null);
  };

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    const [crm, smartHome, inventory] = await Promise.allSettled([listCompanyDeals(companyId), loadSmartHome(), listInventoryProjects(companyId)]);
    if (crm.status === 'fulfilled') setDeals(crm.value);
    setAvailable(inventory.status === 'fulfilled' ? Object.fromEntries(inventory.value.map((p) => [p.id, p.available])) : null);
    const failed = crm.status === 'rejected' ? crm.reason : smartHome.status === 'rejected' ? smartHome.reason : null;
    if (failed) setError(failed instanceof Error ? failed.message : 'No se pudieron cargar los negocios.');
    setLoading(false);
  };

  const syncSmartHome = async () => {
    if (!companyId) return;
    setShSyncing(true);
    setError(null);
    try {
      const result = await syncSmartHomeSalesNow(companyId);
      await loadSmartHome();
      if (result.failedProjects?.length) {
        setError(`SmartHome no respondió para ${result.failedProjects.join(', ')}. Se actualizó lo demás; vuelve a intentar en unos minutos.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo traer la información de SmartHome.');
    } finally {
      setShSyncing(false);
    }
  };

  useEffect(() => { void load(); }, [companyId]);

  const selectedProjectConfig = PROJECT_CATALOG.find((project) => project.key === selectedProject) ?? null;
  const scopedSales = useMemo(() => {
    if (!selectedProjectConfig) return shSales;
    return shSales.filter((sale) => {
      if (sale.crmProjectId !== selectedProjectConfig.key) return false;
      if (selectedProjectConfig.key === 'laguna-mar' && selectedSector && selectedSector !== 'all') return sale.sector === selectedSector;
      return true;
    });
  }, [shSales, selectedProjectConfig, selectedSector]);
  const scopedInventoryOnly = useMemo(() => shInventoryOnly.filter((lot) => {
    if (!selectedProjectConfig || lot.crmProjectId !== selectedProjectConfig.key) return false;
    if (selectedProjectConfig.key === 'laguna-mar' && selectedSector && selectedSector !== 'all') return lot.sector === selectedSector;
    return true;
  }), [shInventoryOnly, selectedProjectConfig, selectedSector]);
  const scopedDeals = useMemo(() => {
    if (!selectedProjectConfig) return deals;
    return deals.filter((deal) => {
      if (!deal.lot || !selectedProjectConfig.projectIds.includes(deal.lot.projectId)) return false;
      if (selectedProjectConfig.key === 'laguna-mar' && selectedSector && selectedSector !== 'all') {
        return deal.lot.sector.trim().toUpperCase() === selectedSector;
      }
      return true;
    });
  }, [deals, selectedProjectConfig, selectedSector]);

  const advisors = useMemo(() => Array.from(new Map(
    scopedDeals.map((deal) => [deal.advisorId, deal.advisorName || deal.advisorId]),
  ).entries()).sort((a, b) => a[1].localeCompare(b[1], 'es')), [scopedDeals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedDeals.filter((deal) => {
      if (status !== 'all' && deal.status !== status) return false;
      if (advisor !== 'all' && deal.advisorId !== advisor) return false;
      if (!q) return true;
      return [deal.leadName, deal.advisorName, ...(deal.buyerNames ?? []), deal.lot?.sector, deal.lot?.lotNumber]
        .some((value) => String(value ?? '').toLowerCase().includes(q));
    });
  }, [scopedDeals, search, status, advisor]);

  const selected = deals.find((deal) => deal.id === selectedId) ?? null;
  const active = scopedDeals.filter((deal) => deal.status !== 'anulado').length;
  const complete = scopedDeals.filter((deal) => deal.status === 'promesa_firmada').length;
  const totalValue = scopedDeals.filter((deal) => deal.status !== 'anulado').reduce((sum, deal) => sum + (deal.plan?.landValue ?? 0), 0);

  if (!selectedProject) {
    return <>
      {creatingDeal && companyId && <NewDealByPhoneModal companyId={companyId} onClose={() => setCreatingDeal(false)} onChanged={() => void load()} />}
      <ProjectSelection deals={deals} sales={shEnabled ? shSales : null} available={available} onNewDeal={() => setCreatingDeal(true)} loading={loading} error={error} onRefresh={() => void load()} onSelect={(project) => {
      setSelectedProject(project.key);
      setSelectedSector(project.key === 'laguna-mar' ? null : 'all');
      setSearch(''); setStatus('all'); setAdvisor('all');
    }} />
    </>;
  }

  if (selectedProject === 'laguna-mar' && selectedSector === null) {
    const lagunaDeals = deals.filter((deal) => deal.lot?.projectId === 'laguna-mar');
    const lagunaSales = shEnabled ? shSales.filter((sale) => sale.crmProjectId === 'laguna-mar') : null;
    return <LagunaSectorSelection deals={lagunaDeals} sales={lagunaSales} onBack={() => setSelectedProject(null)} onSelect={(sector) => setSelectedSector(sector)} />;
  }

  const realSales = scopedSales.filter((sale) => !sale.ignored).length;

  return (
    <div className="deal-touch h-full overflow-y-auto bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button onClick={() => {
              if (selectedProject === 'laguna-mar' && selectedSector !== null) setSelectedSector(null);
              else setSelectedProject(null);
            }} className="mt-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100"><ArrowLeft size={16} /></button>
            <div>
            <div className="flex items-center gap-2">
              <ProjectLogo src={selectedSector && selectedSector !== 'all' ? LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.logo || selectedProjectConfig?.logo || '' : selectedProjectConfig?.logo || ''} name={selectedSector && selectedSector !== 'all' ? LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.name || '' : selectedProjectConfig?.name || ''} compact />
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Negocios del proyecto</p><h1 className="text-xl font-extrabold text-zinc-100">{selectedSector && selectedSector !== 'all' ? LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.name : selectedProjectConfig?.name}</h1></div>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Seguimiento comercial, documentos y soportes de cada negocio{isAdmin ? ' por asesor' : ''}.
            </p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <button onClick={() => setCreatingDeal(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><Phone size={14} /> Nuevo negocio</button>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>
        </header>

        {shEnabled && (
          <nav className="flex w-full rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs font-semibold sm:inline-flex sm:w-auto">
            <button onClick={() => setView('crm')} className={`flex-1 rounded-lg px-3 py-2.5 transition sm:flex-none sm:px-4 sm:py-2 ${view === 'crm' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
              Negocios del CRM <span className="ml-1 text-zinc-500">{scopedDeals.length}</span>
            </button>
            <button onClick={() => setView('smarthome')} className={`flex-1 rounded-lg px-3 py-2.5 transition sm:flex-none sm:px-4 sm:py-2 ${view === 'smarthome' ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
              Vendidos en SmartHome <span className="ml-1 text-zinc-500">{realSales}</span>
            </button>
          </nav>
        )}

        {shEnabled && view === 'smarthome' ? (
          <>
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
            {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-sky-400" /></div> : companyId && (
              <SmartHomeSalesPanel
                sales={scopedSales}
                inventoryOnly={scopedInventoryOnly}
                inventoryCheckedAt={shInventoryCheckedAt}
                companyId={companyId}
                isAdmin={isAdmin}
                lastSyncAt={shLastSync}
                syncing={shSyncing}
                onSync={() => void syncSmartHome()}
                onChanged={(updated) => setShSales((rows) => rows.map((row) => row.id === updated.id ? updated : row))}
              />
            )}
          </>
        ) : (<>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={Handshake} label="Negocios" value={String(scopedDeals.length)} />
          <Metric icon={FileCheck2} label="Activos" value={String(active)} />
          <Metric icon={CheckCircle2} label="Promesas firmadas" value={String(complete)} />
          <Metric icon={BadgeDollarSign} label="Valor activo" value={money(totalValue)} />
        </section>

        <section className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:flex sm:flex-wrap">
          <label className="relative sm:min-w-[220px] sm:flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar comprador, lote o asesor" className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-xs text-zinc-100 outline-none focus:border-emerald-500/60" />
          </label>
          <label className="relative">
            <Filter size={14} className="absolute left-3 top-2.5 text-zinc-500" />
            <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | DealStatus)} className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-8 text-xs text-zinc-300 outline-none sm:h-9 sm:w-auto">
              <option value="all">Todos los estados</option>
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {isAdmin && (
            <select value={advisor} onChange={(e) => setAdvisor(e.target.value)} className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none sm:h-9 sm:w-auto">
              <option value="all">Todos los asesores</option>
              {advisors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </section>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {loading && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-emerald-400" /></div>}
        {!loading && !filtered.length && <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">No hay negocios con estos filtros.</div>}

        {!loading && filtered.length > 0 && (
          <section className="grid gap-3 xl:grid-cols-2">
            {filtered.map((deal) => {
              const stats = supportStats(deal);
              return (
                <button key={deal.id} onClick={() => setSelectedId(deal.id)} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-left transition hover:border-emerald-500/30 hover:bg-zinc-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-zinc-100">{deal.buyerNames?.join(', ') || deal.leadName || 'Sin compradores'}</p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500"><UserRound size={11} /> {deal.advisorName || 'Asesor'} · {dateTime(deal.updatedAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLE[deal.status]}`}>{DEAL_STATUS_LABELS[deal.status]}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-[1.5fr_0.8fr] gap-2 text-xs">
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400"><MapPin size={11} /> Proyecto y lote</p>
                      <p className="mt-1 text-base font-extrabold text-zinc-100">{projectName(deal.lot?.projectId)}</p>
                      <p className="mt-0.5 text-sm font-semibold text-emerald-300">{deal.lot ? `${deal.lot.sector} · Lote ${deal.lot.lotNumber}` : 'Sin lote seleccionado'}</p>
                      {deal.lot && <p className="mt-1 text-[10px] text-zinc-500">{deal.lot.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²{deal.lot.corner ? ' · Esquinero' : ''}</p>}
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-zinc-400"><BadgeDollarSign size={14} className="mb-2 text-amber-400" /><p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">Valor</p><p className="mt-1 text-sm font-bold text-zinc-200">{deal.plan ? money(deal.plan.landValue) : 'Sin plan'}</p></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <SupportPill ok={stats.buyerDocs >= deal.buyers.length && deal.buyers.length > 0} label={`Cédulas ${stats.buyerDocs}/${deal.buyers.length}`} />
                    {Boolean(deal.plan?.benefit) && <SupportPill ok={stats.authorization} label="Autorización bono" />}
                    {Boolean(referralName(deal.plan?.referredBy)) && <SupportPill ok={stats.referral} label="Referido" />}
                    {stats.separationPayments > 0 && <SupportPill ok={stats.paymentProofs >= stats.separationPayments} label={`Separaciones ${stats.paymentProofs}/${stats.separationPayments}`} />}
                    <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-400"><Paperclip size={10} className="mr-1 inline" />{deal.attachments?.length ?? 0} soportes</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}
        </>)}
      </div>

      {creatingDeal && companyId && <NewDealByPhoneModal companyId={companyId} onClose={() => setCreatingDeal(false)} onChanged={() => void load()} />}
      {selected && companyId && (
        <DealDetailModal
          deal={selected}
          companyId={companyId}
          currentUserId={user?.uid || ''}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onChanged={(updated) => setDeals((rows) => rows.map((row) => row.id === updated.id ? updated : row))}
          onReload={() => void load()}
        />
      )}
    </div>
  );
}

function ProjectSelection({ deals, sales, available, loading, error, onRefresh, onNewDeal, onSelect }: {
  onNewDeal: () => void;
  deals: DealSummary[];
  /** Lotes DISPONIBLES por proyecto del inventario de disponibilidad. */
  available: Record<string, number> | null;
  /** null = SmartHome no activo para la empresa (se muestran solo cifras del CRM). */
  sales: SmartHomeSale[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (project: ProjectCatalogItem) => void;
}) {
  return (
    <div className="deal-touch h-full overflow-y-auto bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><Building2 className="text-emerald-400" size={25} /><h1 className="text-2xl font-extrabold text-zinc-100">Negocios por proyecto</h1></div><p className="mt-1 text-sm text-zinc-500">Selecciona un proyecto para consultar sus compradores, lotes, documentos y soportes.</p></div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <button onClick={onNewDeal} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><Phone size={14} /> Nuevo negocio</button>
            <button onClick={onRefresh} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
          </div>
        </header>
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-emerald-400" /></div> : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {PROJECT_CATALOG.map((project) => {
              const rows = deals.filter((deal) => deal.lot && project.projectIds.includes(deal.lot.projectId));
              const active = rows.filter((deal) => deal.status !== 'anulado').length;
              const sold = sales?.filter((sale) => sale.crmProjectId === project.key && !sale.ignored) ?? null;
              const free = available ? project.projectIds.reduce((sum, id) => sum + (available[id] ?? 0), 0) : null;
              return (
                <button key={project.key} onClick={() => onSelect(project)} className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 text-left shadow-xl shadow-black/40 transition duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-emerald-950/40">
                  <ProjectHero src={project.logo} name={project.name} accent={project.accent} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-extrabold text-zinc-100 transition group-hover:text-emerald-300">{project.name}</h2>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{project.subtitle}</p>
                      </div>
                      <span className="mt-1 shrink-0 rounded-full border border-zinc-700 p-1.5 text-zinc-500 transition group-hover:border-emerald-500/50 group-hover:text-emerald-300"><ArrowLeft size={14} className="rotate-180" /></span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-zinc-950/60 p-3 text-center">
                      {sold ? <>
                        <ProjectStat label="Vendidos" value={String(sold.length)} />
                        <ProjectStat label="Negocios CRM" value={String(active)} />
                        <ProjectStat label="Disponibles" value={free === null ? '—' : String(free)} />
                      </> : <>
                        <ProjectStat label="Negocios" value={String(rows.length)} />
                        <ProjectStat label="Activos" value={String(active)} />
                        <ProjectStat label="Disponibles" value={free === null ? '—' : String(free)} />
                      </>}
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function LagunaSectorSelection({ deals, sales, onBack, onSelect }: { deals: DealSummary[]; sales: SmartHomeSale[] | null; onBack: () => void; onSelect: (sector: string) => void }) {
  const cards = [
    { key: 'all', name: 'Todos los negocios', subtitle: 'Laguna Mar', logo: '/project-logos/laguna-mar.png', accent: 'from-blue-950/80 to-teal-950/30' },
    ...LAGUNA_SECTORS,
  ];
  return (
    <div className="deal-touch h-full overflow-y-auto bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-start gap-3"><button onClick={onBack} className="mt-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100"><ArrowLeft size={16} /></button><div><p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Laguna Mar</p><h1 className="text-2xl font-extrabold text-zinc-100">Selecciona el sector</h1><p className="mt-1 text-sm text-zinc-500">Consulta todos los negocios o entra directamente a Mar Santorini o Mar Canarias.</p></div></header>
        <section className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const rows = card.key === 'all' ? deals : deals.filter((deal) => deal.lot?.sector.trim().toUpperCase() === card.key);
            const value = rows.filter((deal) => deal.status !== 'anulado').reduce((sum, deal) => sum + (deal.plan?.landValue ?? 0), 0);
            const sold = sales?.filter((sale) => !sale.ignored && (card.key === 'all' || sale.sector === card.key)) ?? null;
            return <button key={card.key} onClick={() => onSelect(card.key)} className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 text-left shadow-xl shadow-black/40 transition duration-300 hover:-translate-y-1 hover:border-sky-500/40"><ProjectHero src={card.logo} name={card.name} accent={card.accent} /><div className="p-5"><h2 className="text-lg font-extrabold text-zinc-100 group-hover:text-sky-300">{card.name}</h2><p className="text-xs text-zinc-500">{card.subtitle}</p><div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3"><span className="text-xs text-zinc-400">{sold && <><strong className="text-zinc-100">{sold.length}</strong> vendido(s) · </>}<strong className="text-zinc-100">{rows.length}</strong> negocio(s) CRM</span><span className="text-xs font-bold text-emerald-300">{value ? money(value) : 'Sin valor registrado'}</span></div></div></button>;
          })}
        </section>
      </div>
    </div>
  );
}

function ProjectHero({ src, name, accent }: { src: string; name: string; accent: string }) {
  return (
    <div className={`relative flex h-44 items-center sm:h-60 justify-center overflow-hidden bg-gradient-to-br ${accent}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.16),transparent_55%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 sm:h-52 sm:w-52 -translate-y-1/2 rounded-full border border-white/10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-900/80 to-transparent" />
      <div className="relative transition duration-500 group-hover:scale-105"><ProjectLogo src={src} name={name} /></div>
    </div>
  );
}

function ProjectLogo({ src, name, compact = false }: { src: string; name: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className={`${compact ? 'h-10 w-10 text-[8px]' : 'h-28 w-64 text-xl'} flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-center font-black uppercase tracking-wide text-white/80`}>{compact ? name.slice(0, 2) : name}</div>;
  return <img src={src} alt={`Logo ${name}`} onError={() => setFailed(true)} className={compact ? 'h-11 w-11 object-contain drop-shadow-md' : 'h-32 w-32 object-contain sm:h-44 sm:w-44 drop-shadow-[0_12px_28px_rgba(0,0,0,0.55)]'} />;
}

function ProjectStat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-wide text-zinc-600">{label}</p><p className={`mt-1 truncate font-extrabold text-zinc-200 ${small ? 'text-[11px]' : 'text-base'}`}>{value}</p></div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Handshake; label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"><Icon size={15} className="text-emerald-400" /><p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-0.5 truncate text-base font-bold text-zinc-100">{value}</p></div>;
}

function SupportPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full border px-2 py-1 ${ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{ok ? '✓' : '!'} {label}</span>;
}

function DealDetailModal({ deal, companyId, currentUserId, isAdmin, onClose, onChanged, onReload }: {
  deal: DealSummary;
  companyId: string;
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (deal: DealSummary) => void;
  /** Recarga los negocios (tras enviar a firma o actualizar su estado). */
  onReload: () => void;
}) {
  const [preview, setPreview] = useState<{ title: string; kind: DealDocumentKind; version: number; pdf: { fileName: string; blob: Blob } } | null>(null);
  const [category, setCategory] = useState<DealAttachmentCategory>('buyer_identification');
  const [buyerClientId, setBuyerClientId] = useState(deal.buyers[0]?.clientId ?? '');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingDocument, setDownloadingDocument] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachments = deal.attachments ?? [];
  const stats = supportStats(deal);

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const attachment = await uploadDealAttachment({
        companyId, dealId: deal.id, category, file,
        ...(category === 'buyer_identification' ? { buyerClientId } : {}),
        ...(category === 'separation_payment' ? { paymentAmount: Number(paymentAmount.replace(/\D/g, '')), paymentDate } : {}),
        note,
      });
      onChanged({ ...deal, attachments: [...attachments, attachment], updatedAt: Date.now() });
      setFile(null); setNote(''); setPaymentAmount(''); setPaymentDate('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo subir el soporte.'); }
    finally { setBusy(false); }
  };

  const handleDelete = async (attachment: DealAttachment) => {
    if (!window.confirm(`¿Eliminar “${attachment.fileName}”?`)) return;
    setBusy(true); setError(null);
    try {
      await deleteDealAttachment(companyId, deal.id, attachment.id);
      onChanged({ ...deal, attachments: attachments.filter((item) => item.id !== attachment.id), updatedAt: Date.now() });
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar el soporte.'); }
    finally { setBusy(false); }
  };

  /** Ver el contrato (PDF) o, si ya está firmado por todos, el PDF firmado que trajo el CRM de DocuBlock. */
  const handleView = async (kind: DealDocumentKind, version: number, signed = false) => {
    const key = `${signed ? 'signed' : 'view'}-${kind}-${version}`;
    setDownloadingDocument(key); setError(null);
    try {
      const pdf = await fetchDealDocumentPdf(companyId, deal.id, kind, version, signed);
      setPreview({ title: `${kind === 'preventa' ? 'Contrato de preventa' : 'Promesa de compraventa'} · v${version}${signed ? ' · FIRMADO' : ''}`, kind, version, pdf });
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo abrir el documento.'); }
    finally { setDownloadingDocument(null); }
  };

  const handleDocumentDownload = async (kind: DealDocumentKind, version: number) => {
    const key = `${kind}-${version}`;
    setDownloadingDocument(key); setError(null);
    try { await downloadDealDocument(companyId, deal.id, kind, version); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo descargar el documento.'); }
    finally { setDownloadingDocument(null); }
  };

  return (
    <div className="deal-touch fixed inset-0 z-50 flex items-stretch justify-center bg-black/75 sm:items-center sm:p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {preview && <DealDocumentPreview title={preview.title} pdf={preview.pdf} onDownloadWord={isAdmin ? () => downloadDealDocument(companyId, deal.id, preview.kind, preview.version) : undefined} onClose={() => setPreview(null)} />}
      <div className="h-[100dvh] w-full max-w-5xl overflow-y-auto overscroll-contain bg-zinc-950 pb-[var(--safe-bottom)] shadow-2xl sm:h-auto sm:max-h-[94dvh] sm:rounded-2xl sm:border sm:border-zinc-700">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-zinc-800 bg-zinc-950/95 px-4 pb-3 pt-[max(0.75rem,var(--safe-top))] backdrop-blur sm:p-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">{projectName(deal.lot?.projectId)}</p>
            <h2 className="mt-0.5 text-lg font-extrabold text-zinc-100 sm:text-xl">{deal.lot ? `${deal.lot.sector} · Lote ${deal.lot.lotNumber}` : 'Sin lote seleccionado'}</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">{deal.buyerNames?.join(', ') || deal.leadName} · {deal.advisorName}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 sm:mr-0 sm:h-9 sm:w-9"><X size={18} /></button>
        </header>

        <div className="grid gap-5 p-4 lg:grid-cols-[0.9fr_1.4fr]">
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Resumen</h3>
              <div className="mt-3 space-y-2 text-xs text-zinc-400">
                <p><strong className="text-zinc-200">Estado:</strong> {DEAL_STATUS_LABELS[deal.status]}</p>
                <p><strong className="text-zinc-200">Valor:</strong> {deal.plan ? money(deal.plan.landValue) : 'Sin plan'}</p>
                <p><strong className="text-zinc-200">Bono/descuento:</strong> {deal.plan?.benefit ? money(deal.plan.benefit) : 'No aplica'}</p>
                <p><strong className="text-zinc-200">Referido por:</strong> {referralName(deal.plan?.referredBy) || 'No aplica'}</p>
                <p><strong className="text-zinc-200">Documentos generados:</strong> {deal.documents?.length ?? 0}</p>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Control documental</h3>
              <div className="mt-3 space-y-2">
                <Checklist ok={stats.buyerDocs >= deal.buyers.length && deal.buyers.length > 0} text={`Documentos compradores: ${stats.buyerDocs}/${deal.buyers.length}`} />
                {Boolean(deal.plan?.benefit) && <Checklist ok={stats.authorization} text="Autorización de bono/descuento" />}
                {Boolean(referralName(deal.plan?.referredBy)) && <Checklist ok={stats.referral} text="Evidencia del referido" />}
                {stats.separationPayments > 0 && <Checklist ok={stats.paymentProofs >= stats.separationPayments} text={`Soportes de separación: ${stats.paymentProofs}/${stats.separationPayments}`} />}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">Agregar soporte</h3>
              <div className="mt-3 space-y-2">
                <select value={category} onChange={(e) => setCategory(e.target.value as DealAttachmentCategory)} className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200">
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {category === 'buyer_identification' && (
                  <select value={buyerClientId} onChange={(e) => setBuyerClientId(e.target.value)} className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200">
                    {deal.buyers.sort((a, b) => a.order - b.order).map((buyer) => <option key={buyer.clientId} value={buyer.clientId}>{deal.buyerNames?.[buyer.order - 1] || `Comprador ${buyer.order}`}</option>)}
                  </select>
                )}
                {category === 'separation_payment' && <div className="grid grid-cols-2 gap-2"><input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Valor pagado" className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200" /><input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200" /></div>}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota opcional: autorización, número de recibo, observación…" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200" />
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-xs text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300"><Upload size={14} />{file ? file.name : 'Seleccionar imagen o PDF (máx. 10 MB)'}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
                <button onClick={() => void handleUpload()} disabled={!file || busy || (category === 'buyer_identification' && !buyerClientId) || (category === 'separation_payment' && (!paymentAmount || !paymentDate))} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Guardar soporte</button>
                {error && <p className="text-xs text-red-300">{error}</p>}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100"><FileCheck2 size={16} className="text-emerald-400" /> Contratos y promesas</h3><span className="text-xs text-zinc-500">{deal.documents?.length ?? 0} documento(s)</span></div>
              {!deal.documents?.length && <div className="mt-3 rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500"><FileText size={22} className="mx-auto mb-2" />Aún no se han generado contratos ni promesas.</div>}
              <div className="mt-3 space-y-2">
                {[...(deal.documents ?? [])].reverse().map((document) => (
                  <div key={`${document.kind}-${document.version}`} className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-100">{document.kind === 'preventa' ? 'Contrato de preventa' : 'Promesa de compraventa'} · v{document.version}</p>
                      <p className="mt-1 text-[10px] text-zinc-500">Generado: {dateTime(document.generatedAt)} · Estado: {document.signatureStatus || 'generado'}</p>
                      <p className="mt-1 truncate text-[10px] font-medium text-emerald-400">{projectName(deal.lot?.projectId)} · {deal.lot?.sector} · Lote {deal.lot?.lotNumber}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                      {document.signatureStatus === 'firmado' && document.signedPdfStoragePath && (
                        <button onClick={() => void handleView(document.kind, document.version, true)} disabled={!!downloadingDocument}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
                          {downloadingDocument === `signed-${document.kind}-${document.version}` ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Firmado
                        </button>
                      )}
                      <button onClick={() => void handleView(document.kind, document.version)} disabled={!!downloadingDocument}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                        {downloadingDocument === `view-${document.kind}-${document.version}` ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Ver
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => void handleDocumentDownload(document.kind, document.version)}
                          disabled={downloadingDocument === `${document.kind}-${document.version}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          {downloadingDocument === `${document.kind}-${document.version}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Word
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Estado de la firma en DocuBlock: quién firmó, reenviar, actualizar y enviar a firma. */}
              <DealSignatureStatus companyId={companyId} deal={deal} canManage={isAdmin} onChanged={onReload} onViewSigned={(doc) => handleView(doc.kind, doc.version, true)} />
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-zinc-200">Soportes del negocio</h3><span className="text-xs text-zinc-500">{attachments.length} archivo(s)</span></div>
              {!attachments.length && <div className="mt-4 rounded-xl border border-dashed border-zinc-800 py-12 text-center text-xs text-zinc-500"><FileText size={24} className="mx-auto mb-2" />Aún no hay soportes cargados.</div>}
              <div className="mt-3 space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">{CATEGORY_LABELS[attachment.category]}</p><p className="mt-1 truncate text-xs font-semibold text-zinc-200">{attachment.fileName}</p><p className="mt-1 text-[10px] text-zinc-500">{attachment.buyerName || ''}{attachment.paymentAmount ? `${attachment.buyerName ? ' · ' : ''}${money(attachment.paymentAmount)} · ${attachment.paymentDate}` : ''}</p>{attachment.note && <p className="mt-2 text-xs text-zinc-400">{attachment.note}</p>}<p className="mt-2 text-[10px] text-zinc-600">{attachment.uploadedByName} · {dateTime(attachment.uploadedAt)}</p></div>
                    <div className="flex shrink-0 gap-1"><button onClick={() => void downloadDealAttachment(companyId, deal.id, attachment.id)} title="Descargar" className="rounded-lg border border-zinc-700 p-2 text-emerald-300 hover:bg-zinc-800"><Download size={14} /></button>{(isAdmin || attachment.uploadedBy === currentUserId) && <button onClick={() => void handleDelete(attachment)} title="Eliminar" disabled={busy} className="rounded-lg border border-zinc-700 p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={14} /></button>}</div>
                  </div>
                </div>
              ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Checklist({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${ok ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>{ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {text}</div>;
}
