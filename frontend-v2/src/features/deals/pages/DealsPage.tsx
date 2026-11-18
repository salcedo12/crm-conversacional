import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BadgeDollarSign, Building2, CheckCircle2, Download, FileCheck2, Filter,
  Handshake, Loader2, MapPin, Paperclip, Phone, RefreshCw, Search, UserRound, XCircle,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole, isViewerRole } from '@/features/auth/types';
import {
  DEAL_STATUS_LABELS,
  listCompanyDeals,
  listInventoryProjects,
  projectName,
  type DealAttachmentCategory,
  type DealStatus,
  type DealSummary,
} from '../services/deals.service';
import { isAttachmentFromOtherLot } from '../utils/documentLot';
import { referralName } from '../utils/paymentPlan';
import { listSmartHomeSales, syncSmartHomeSalesNow, type InventoryOnlySale, type SmartHomeSale } from '../services/smarthomeSales.service';
import { NewDealByPhoneModal } from '../components/NewDealByPhoneModal';
import { SmartHomeSalesPanel } from '../components/SmartHomeSalesPanel';

const NO_LOT_PROJECT_KEY = '__sin_lote__';

export { projectName };

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

export const CATEGORY_LABELS: Record<DealAttachmentCategory, string> = {
  buyer_identification: 'Cédula / documento del comprador',
  benefit_authorization: 'Autorización de bono o descuento',
  referral_evidence: 'Pantallazo o evidencia del referido',
  separation_payment: 'Soporte de pago de separación',
};

export const STATUS_STYLE: Record<DealStatus, string> = {
  borrador: 'border-zinc-700 bg-zinc-800 text-zinc-300',
  plan_listo: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  preventa_en_firma: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  preventa_firmada: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  promesa_en_firma: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  promesa_firmada: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  anulado: 'border-red-500/30 bg-red-500/10 text-red-300',
};

export function money(value = 0) {
  return `$ ${Math.round(value).toLocaleString('es-CO')}`;
}

export function dateTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function supportStats(deal: DealSummary) {
  const attachments = deal.attachments ?? [];
  const currentBuyerIds = new Set(deal.buyers.map((b) => b.clientId));
  const buyerDocs = new Set(
    attachments
      .filter((a) => a.category === 'buyer_identification' && a.buyerClientId && currentBuyerIds.has(a.buyerClientId))
      .map((a) => a.buyerClientId),
  ).size;
  const currentPayments = attachments.filter((a) => a.category === 'separation_payment' && !isAttachmentFromOtherLot(a, deal));
  const paymentProofs = currentPayments.length;
  const separationPaid = currentPayments.reduce((sum, a) => sum + (a.paymentAmount ?? 0), 0);
  const separationRequired =
    deal.plan?.simple?.separationTotal
    ?? deal.plan?.rows.filter((row) => row.kind === 'separacion').reduce((sum, row) => sum + row.amount * row.count, 0)
    ?? 0;
  const authorization = attachments.some((a) => a.category === 'benefit_authorization');
  const referral = attachments.some((a) => a.category === 'referral_evidence');
  const separationPayments = deal.plan?.simple?.separationPayments?.length
    ?? deal.plan?.rows.filter((row) => row.kind === 'separacion').reduce((sum, row) => sum + row.count, 0)
    ?? 0;
  const buyersOk = deal.buyers.length > 0 && buyerDocs >= deal.buyers.length;
  const benefitOk = !deal.plan?.benefit || authorization;
  const referralOk = !referralName(deal.plan?.referredBy) || referral;
  const paymentOk = separationPayments === 0 || (paymentProofs >= separationPayments && separationPaid >= separationRequired);
  const allOk = buyersOk && benefitOk && referralOk && paymentOk;
  return {
    buyerDocs,
    paymentProofs,
    separationPaid,
    separationRequired,
    authorization,
    referral,
    separationPayments,
    buyersOk,
    benefitOk,
    referralOk,
    paymentOk,
    allOk,
  };
}

export function missingSupportsSummary(deal: DealSummary): string[] {
  const s = supportStats(deal);
  const missing: string[] = [];
  if (!deal.buyers.length) missing.push('Faltan compradores registrados');
  else if (!s.buyersOk) missing.push(`Cédulas de compradores (${s.buyerDocs}/${deal.buyers.length})`);
  if (!s.benefitOk) missing.push('Autorización de bono o descuento');
  if (!s.referralOk) missing.push('Evidencia del referido');
  if (!s.paymentOk) {
    missing.push(
      s.separationPaid < s.separationRequired
        ? `Soporte de separación (${money(s.separationPaid)} / ${money(s.separationRequired)})`
        : `Comprobantes de separación (${s.paymentProofs}/${s.separationPayments})`,
    );
  }
  return missing;
}

export function dealNetValue(deal: DealSummary): number {
  const plan = deal.plan;
  if (!plan) return 0;
  return Math.max(0, (plan.landValue ?? 0) - (plan.benefit ?? 0));
}

export function DealsPage() {
  const navigate = useNavigate();
  const { companyId, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const readOnly = !platformAdmin && isViewerRole(role);
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DealStatus>('all');
  const [advisor, setAdvisor] = useState('all');
  const [supportFilter, setSupportFilter] = useState<'all' | 'complete' | 'pending'>('all');
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

  const isNoLotView = selectedProject === NO_LOT_PROJECT_KEY;
  const selectedProjectConfig = isNoLotView
    ? null
    : PROJECT_CATALOG.find((project) => project.key === selectedProject) ?? null;
  const scopedSales = useMemo(() => {
    if (!selectedProjectConfig) return [];
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
    if (isNoLotView) return deals.filter((deal) => !deal.lot);
    if (!selectedProjectConfig) return deals;
    return deals.filter((deal) => {
      if (!deal.lot || !selectedProjectConfig.projectIds.includes(deal.lot.projectId)) return false;
      if (selectedProjectConfig.key === 'laguna-mar' && selectedSector && selectedSector !== 'all') {
        return deal.lot.sector.trim().toUpperCase() === selectedSector;
      }
      return true;
    });
  }, [deals, isNoLotView, selectedProjectConfig, selectedSector]);

  const advisors = useMemo(() => Array.from(new Map(
    scopedDeals.map((deal) => [deal.advisorId, deal.advisorName || deal.advisorId]),
  ).entries()).sort((a, b) => a[1].localeCompare(b[1], 'es')), [scopedDeals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedDeals.filter((deal) => {
      if (status !== 'all' && deal.status !== status) return false;
      if (advisor !== 'all' && deal.advisorId !== advisor) return false;
      if (supportFilter !== 'all') {
        const { allOk } = supportStats(deal);
        if (supportFilter === 'complete' && !allOk) return false;
        if (supportFilter === 'pending' && allOk) return false;
      }
      if (!q) return true;
      const buyerIds = deal.buyerProfiles.flatMap((b) => [b.identificationNumber, b.mobile]);
      return [
        deal.id,
        deal.leadName,
        deal.advisorName,
        ...(deal.buyerNames ?? []),
        ...buyerIds,
        deal.lot?.sector,
        deal.lot?.lotNumber,
        deal.lot?.lotCode,
      ].some((value) => String(value ?? '').toLowerCase().includes(q));
    });
  }, [scopedDeals, search, status, advisor, supportFilter]);

  const active = scopedDeals.filter((deal) => deal.status !== 'anulado').length;
  const complete = scopedDeals.filter((deal) => deal.status === 'promesa_firmada').length;
  const totalValue = scopedDeals.filter((deal) => deal.status !== 'anulado').reduce((sum, deal) => sum + dealNetValue(deal), 0);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['ID', 'Estado', 'Compradores', 'Cédulas', 'Asesor', 'Proyecto', 'Sector', 'Lote', 'Código', 'Valor neto', 'Bono', 'Soportes faltantes', 'Actualizado'];
    const rows = filtered.map((deal) => [
      deal.id,
      DEAL_STATUS_LABELS[deal.status],
      deal.buyerNames?.join(' / ') || deal.leadName || '',
      deal.buyerProfiles.map((b) => `${b.identificationKind} ${b.identificationNumber}`).join(' / '),
      deal.advisorName || '',
      projectName(deal.lot?.projectId),
      deal.lot?.sector || '',
      deal.lot?.lotNumber || '',
      deal.lot?.lotCode || '',
      dealNetValue(deal),
      deal.plan?.benefit ?? 0,
      missingSupportsSummary(deal).join('; '),
      dateTime(deal.updatedAt),
    ]);
    const csv = `\uFEFF${[header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `negocios-${selectedProject || 'crm'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!selectedProject) {
    return <>
      {creatingDeal && companyId && (
        <NewDealByPhoneModal
          companyId={companyId}
          onClose={() => setCreatingDeal(false)}
          onChanged={() => void load()}
        />
      )}
      <ProjectSelection
        deals={deals}
        sales={shEnabled ? shSales : null}
        available={available}
        onNewDeal={readOnly ? undefined : () => setCreatingDeal(true)}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onSelectNoLot={() => {
          setSelectedProject(NO_LOT_PROJECT_KEY);
          setSelectedSector('all');
          setSearch(''); setStatus('all'); setAdvisor('all'); setSupportFilter('all');
        }}
        onSelect={(project) => {
          setSelectedProject(project.key);
          setSelectedSector(project.key === 'laguna-mar' ? null : 'all');
          setSearch(''); setStatus('all'); setAdvisor('all'); setSupportFilter('all');
        }}
      />
    </>;
  }

  if (selectedProject === 'laguna-mar' && selectedSector === null) {
    const lagunaDeals = deals.filter((deal) => deal.lot?.projectId === 'laguna-mar');
    const lagunaSales = shEnabled ? shSales.filter((sale) => sale.crmProjectId === 'laguna-mar') : null;
    return <LagunaSectorSelection deals={lagunaDeals} sales={lagunaSales} onBack={() => setSelectedProject(null)} onSelect={(sector) => setSelectedSector(sector)} />;
  }

  const realSales = scopedSales.filter((sale) => !sale.ignored).length;
  const activeProjectLabel = isNoLotView
    ? undefined
    : (selectedSector && selectedSector !== 'all'
      ? `${selectedProjectConfig?.name || 'Laguna Mar'} · ${LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.name || selectedSector}`
      : selectedProjectConfig?.name);

  return (
    <div className="deal-touch h-full overflow-y-auto overflow-x-hidden bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-7xl min-w-0 space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <button onClick={() => {
              if (selectedProject === 'laguna-mar' && selectedSector !== null) setSelectedSector(null);
              else setSelectedProject(null);
            }} className="mt-0.5 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100"><ArrowLeft size={16} /></button>
            <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {!isNoLotView && (
                <ProjectLogo
                  src={selectedSector && selectedSector !== 'all' ? LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.logo || selectedProjectConfig?.logo || '' : selectedProjectConfig?.logo || ''}
                  name={selectedSector && selectedSector !== 'all' ? (LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.name || selectedSector) : (selectedProjectConfig?.name || '')}
                  compact
                />
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  {isNoLotView ? 'Borradores iniciales' : 'Negocios del proyecto'}
                </p>
                <h1 className="truncate text-xl font-extrabold text-zinc-100">
                  {isNoLotView
                    ? 'Negocios sin lote asignado'
                    : (selectedSector && selectedSector !== 'all'
                      ? (LAGUNA_SECTORS.find((sector) => sector.key === selectedSector)?.name || selectedSector)
                      : selectedProjectConfig?.name)}
                </h1>
              </div>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Seguimiento comercial, documentos y soportes de cada negocio{isAdmin ? ' por asesor' : ''}.
            </p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {!readOnly && <button onClick={() => setCreatingDeal(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><Phone size={14} /> Nuevo negocio</button>}
            <button onClick={exportCsv} disabled={loading || filtered.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
              <Download size={14} /> CSV ({filtered.length})
            </button>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>
        </header>

        {shEnabled && !isNoLotView && (
          <nav className="flex w-full rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs font-semibold sm:inline-flex sm:w-auto">
            <button onClick={() => setView('crm')} className={`flex-1 rounded-lg px-3 py-2.5 transition sm:flex-none sm:px-4 sm:py-2 ${view === 'crm' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
              Negocios del CRM <span className="ml-1 text-zinc-500">{scopedDeals.length}</span>
            </button>
            <button onClick={() => setView('smarthome')} className={`flex-1 rounded-lg px-3 py-2.5 transition sm:flex-none sm:px-4 sm:py-2 ${view === 'smarthome' ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
              Vendidos en SmartHome <span className="ml-1 text-zinc-500">{realSales}</span>
            </button>
          </nav>
        )}

        {shEnabled && !isNoLotView && view === 'smarthome' ? (
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
          <Metric icon={BadgeDollarSign} label="Valor activo neto" value={money(totalValue)} />
        </section>

        <section className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 sm:flex sm:flex-wrap">
          <label className="relative min-w-0 sm:min-w-[220px] sm:flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar comprador, cédula, lote, código o asesor" className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-xs text-zinc-100 outline-none focus:border-emerald-500/60" />
          </label>
          <label className="relative min-w-0">
            <Filter size={14} className="absolute left-3 top-2.5 text-zinc-500" />
            <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | DealStatus)} className="h-10 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-8 text-xs text-zinc-300 outline-none sm:h-9 sm:w-auto">
              <option value="all">Todos los estados</option>
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <select value={supportFilter} onChange={(e) => setSupportFilter(e.target.value as 'all' | 'complete' | 'pending')} className="h-10 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none sm:h-9 sm:w-auto">
            <option value="all">Todos los soportes</option>
            <option value="pending">Soportes pendientes</option>
            <option value="complete">Soportes completos</option>
          </select>
          {isAdmin && (
            <select value={advisor} onChange={(e) => setAdvisor(e.target.value)} className="h-10 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-300 outline-none sm:h-9 sm:w-auto">
              <option value="all">Todos los asesores</option>
              {advisors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </section>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {loading && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-emerald-400" /></div>}
        {!loading && !filtered.length && <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">No hay negocios con estos filtros.</div>}

        {!loading && filtered.length > 0 && (
          <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map((deal) => {
              const stats = supportStats(deal);
              return (
                <button key={deal.id} onClick={() => navigate(`/dashboard/deals/${deal.id}`)} className="w-full min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-left transition hover:border-emerald-500/30 hover:bg-zinc-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words text-sm font-bold text-zinc-100">{deal.buyerNames?.join(', ') || deal.leadName || 'Sin compradores'}</p>
                      <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-zinc-500"><UserRound size={11} className="shrink-0" /> <span className="truncate">{deal.advisorName || 'Asesor'} · {dateTime(deal.updatedAt)}</span></p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLE[deal.status]}`}>{DEAL_STATUS_LABELS[deal.status]}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs min-[380px]:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)]">
                    <div className="min-w-0 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400"><MapPin size={11} className="shrink-0" /> Proyecto y lote</p>
                      <p className="mt-1 truncate text-base font-extrabold text-zinc-100">{projectName(deal.lot?.projectId)}</p>
                      <p className="mt-0.5 break-words text-sm font-semibold text-emerald-300">{deal.lot ? `${deal.lot.sector} · Lote ${deal.lot.lotNumber}${deal.lot.lotCode ? ` · Cód. ${deal.lot.lotCode}` : ''}` : 'Sin lote seleccionado'}</p>
                      {deal.lot && <p className="mt-1 text-[10px] text-zinc-500">{deal.lot.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²{deal.lot.corner ? ' · Esquinero' : ''}</p>}
                    </div>
                    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-zinc-400"><BadgeDollarSign size={14} className="mb-2 text-amber-400" /><p className="text-[9px] font-bold uppercase tracking-wide text-zinc-500">Valor neto</p><p className="mt-1 truncate text-sm font-bold text-zinc-200">{deal.plan ? money(dealNetValue(deal)) : 'Sin plan'}</p></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <SupportPill ok={stats.buyersOk} label={`Cédulas ${stats.buyerDocs}/${deal.buyers.length}`} />
                    {Boolean(deal.plan?.benefit) && <SupportPill ok={stats.benefitOk} label="Autorización bono" />}
                    {Boolean(referralName(deal.plan?.referredBy)) && <SupportPill ok={stats.referralOk} label="Referido" />}
                    {stats.separationPayments > 0 && <SupportPill ok={stats.paymentOk} label={`Separaciones ${stats.paymentProofs}/${stats.separationPayments}`} />}
                    <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-400"><Paperclip size={10} className="mr-1 inline" />{deal.attachments?.length ?? 0} soportes</span>
                  </div>
                </button>
              );
            })}
          </section>
        )}
        </>)}
      </div>

      {creatingDeal && companyId && (
        <NewDealByPhoneModal
          companyId={companyId}
          projectHint={isNoLotView ? undefined : (selectedProject ?? undefined)}
          projectLabel={activeProjectLabel}
          onClose={() => setCreatingDeal(false)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function ProjectSelection({ deals, sales, available, loading, error, onRefresh, onNewDeal, onSelect, onSelectNoLot }: {
  onNewDeal?: () => void;
  deals: DealSummary[];
  /** Lotes DISPONIBLES por proyecto del inventario de disponibilidad. */
  available: Record<string, number> | null;
  /** null = SmartHome no activo para la empresa (se muestran solo cifras del CRM). */
  sales: SmartHomeSale[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (project: ProjectCatalogItem) => void;
  onSelectNoLot: () => void;
}) {
  const noLotDeals = deals.filter((deal) => !deal.lot);
  const noLotActive = noLotDeals.filter((deal) => deal.status !== 'anulado').length;
  return (
    <div className="deal-touch h-full overflow-y-auto overflow-x-hidden bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><Building2 className="text-emerald-400" size={25} /><h1 className="text-2xl font-extrabold text-zinc-100">Negocios por proyecto</h1></div><p className="mt-1 text-sm text-zinc-500">Selecciona un proyecto para consultar sus compradores, lotes, documentos y soportes.</p></div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {noLotDeals.length > 0 && (
              <button onClick={onSelectNoLot} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20">
                Sin lote ({noLotActive > 0 ? noLotActive : noLotDeals.length})
              </button>
            )}
            {onNewDeal && <button onClick={onNewDeal} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><Phone size={14} /> Nuevo negocio</button>}
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
                <button key={project.key} onClick={() => onSelect(project)} className="group w-full min-w-0 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 text-left shadow-xl shadow-black/40 transition duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-emerald-950/40">
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
  const knownKeys = new Set(LAGUNA_SECTORS.map((s) => s.key));
  const extraSectorKeys = Array.from(new Set([
    ...deals.map((d) => d.lot?.sector?.trim().toUpperCase()).filter((s): s is string => !!s && !knownKeys.has(s)),
    ...(sales ?? []).map((s) => s.sector?.trim().toUpperCase()).filter((s): s is string => !!s && !knownKeys.has(s)),
  ]));
  const cards = [
    { key: 'all', name: 'Todos los negocios', subtitle: 'Laguna Mar', logo: '/project-logos/laguna-mar.png', accent: 'from-blue-950/80 to-teal-950/30' },
    ...LAGUNA_SECTORS,
    ...extraSectorKeys.map((key) => ({ key, name: key, subtitle: 'Laguna Mar', logo: '/project-logos/laguna-mar.png', accent: 'from-slate-900 to-zinc-900' })),
  ];
  return (
    <div className="deal-touch h-full overflow-y-auto overflow-x-hidden bg-zinc-950 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-start gap-3"><button onClick={onBack} className="mt-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100"><ArrowLeft size={16} /></button><div><p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Laguna Mar</p><h1 className="text-2xl font-extrabold text-zinc-100">Selecciona el sector</h1><p className="mt-1 text-sm text-zinc-500">Consulta todos los negocios o entra directamente a un sector.</p></div></header>
        <section className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const rows = card.key === 'all' ? deals : deals.filter((deal) => deal.lot?.sector.trim().toUpperCase() === card.key);
            const value = rows.filter((deal) => deal.status !== 'anulado').reduce((sum, deal) => sum + dealNetValue(deal), 0);
            const sold = sales?.filter((sale) => !sale.ignored && (card.key === 'all' || sale.sector === card.key)) ?? null;
            return <button key={card.key} onClick={() => onSelect(card.key)} className="group w-full min-w-0 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/70 text-left shadow-xl shadow-black/40 transition duration-300 hover:-translate-y-1 hover:border-sky-500/40"><ProjectHero src={card.logo} name={card.name} accent={card.accent} /><div className="p-5"><h2 className="text-lg font-extrabold text-zinc-100 group-hover:text-sky-300">{card.name}</h2><p className="text-xs text-zinc-500">{card.subtitle}</p><div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3"><span className="text-xs text-zinc-400">{sold && <><strong className="text-zinc-100">{sold.length}</strong> vendido(s) · </>}<strong className="text-zinc-100">{rows.length}</strong> negocio(s) CRM</span><span className="text-xs font-bold text-emerald-300">{value ? money(value) : 'Sin valor registrado'}</span></div></div></button>;
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

export function Checklist({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${ok ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>{ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {text}</div>;
}
