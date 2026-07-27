import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Flame, TrendingUp, CalendarCheck, Trophy, DollarSign, Info, Radio } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Spinner } from '@/shared/components/Spinner';
import { getMarketingMetrics, type MarketingMetrics, type AdRow, type AdStatus } from '../services/marketing.service';

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', manual: 'Carga manual', web: 'Sitio web',
  facebook: 'Facebook', instagram: 'Instagram', meta_ads: 'Anuncio de Meta',
};

const STATUS_META: Record<AdStatus, { label: string; cls: string }> = {
  active: { label: 'Activo',  cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  paused: { label: 'Pausado', cls: 'border-zinc-600 bg-zinc-800 text-zinc-400' },
  other:  { label: 'Otro',    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};

type StatusFilter = 'all' | 'active' | 'paused';

const LOSS_LABEL: Record<string, string> = {
  precio: 'Precio', ubicacion: 'Ubicación', competencia: 'Competencia',
  sin_respuesta: 'No respondió', tiempo: 'No es el momento', no_califica: 'No califica',
  atencion: 'Atención', otro: 'Otro', ninguno: '—',
};

type AdSort = 'quality' | 'volume' | 'conversion' | 'cpc' | 'spend';

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmtMoney = (v: number | null) => (v === null || v === undefined ? '—' : money.format(v));

function scoreColor(score: number): string {
  return score >= 66 ? 'text-emerald-400' : score >= 33 ? 'text-amber-400' : score > 0 ? 'text-sky-400' : 'text-zinc-600';
}

export function MarketingPage() {
  const { companyId } = useAuth();
  const [data, setData] = useState<MarketingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adSort, setAdSort] = useState<AdSort>('quality');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [ticket, setTicket] = useState<string>('');   // ticket promedio para ROAS (opcional)

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getMarketingMetrics(companyId));
    } catch (err) {
      console.error('[Marketing] error:', err);
      setError('No se pudieron cargar las métricas de marketing.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showCosts = !!data?.spendAvailable;

  const sortedAds = useMemo(() => {
    if (!data) return [];
    let rows = [...data.byAd];
    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
    if (campaignFilter !== 'all') rows = rows.filter((r) => r.campaignName === campaignFilter);
    if (adSort === 'quality')    rows.sort((a, b) => b.avgScore - a.avgScore || b.leads - a.leads);
    if (adSort === 'volume')     rows.sort((a, b) => b.leads - a.leads);
    if (adSort === 'conversion') rows.sort((a, b) => b.convRate - a.convRate || b.avgScore - a.avgScore);
    if (adSort === 'cpc')        rows.sort((a, b) => (a.cpc ?? Infinity) - (b.cpc ?? Infinity));
    if (adSort === 'spend')      rows.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
    return rows;
  }, [data, adSort, statusFilter, campaignFilter]);

  const summary = useMemo(() => {
    if (!data) return null;
    const rows = data.byAd;
    const analyzed = rows.reduce((s, r) => s + r.analyzed, 0);
    const scoreSum = rows.reduce((s, r) => s + r.avgScore * r.analyzed, 0);
    const scheduled = rows.reduce((s, r) => s + r.scheduled, 0);
    const closed = rows.reduce((s, r) => s + r.closed, 0);
    const leads = data.totalMetaLeads;
    const ticketNum = Number(ticket.replace(/[^\d]/g, '')) || 0;
    const revenue = closed * ticketNum;
    return {
      leads,
      avgScore: analyzed > 0 ? Math.round(scoreSum / analyzed) : 0,
      scheduleRate: leads > 0 ? Math.round((scheduled / leads) * 1000) / 10 : 0,
      convRate: leads > 0 ? Math.round((closed / leads) * 1000) / 10 : 0,
      closed,
      roas: ticketNum > 0 && data.totalSpend > 0 ? revenue / data.totalSpend : null,
    };
  }, [data, ticket]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Megaphone size={17} className="text-violet-400" /> Marketing
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">Qué anuncios y fuentes traen los mejores leads</p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          ↻ Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : error ? (
        <div className="flex justify-center p-12"><p className="text-sm text-red-400">{error}</p></div>
      ) : data ? (
        <div className="flex flex-col gap-5 p-5">
          {/* Aviso si no hay integración de gasto */}
          {!showCosts && (
            <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
              <Info size={15} className="mt-0.5 shrink-0 text-sky-300" />
              <p className="text-xs leading-relaxed text-zinc-300">
                {data.adsConfigured
                  ? 'Hay credenciales de Meta Ads pero no se pudo traer el gasto (revisa el token/permiso ads_read y la cuenta publicitaria).'
                  : 'Conecta tu cuenta de anuncios de Meta para ver costos reales (CPL, costo por lead calificado, costo por cierre y ROAS). Requiere las variables META_ADS_ACCESS_TOKEN y META_AD_ACCOUNT_ID.'}
                {' '}Mientras tanto, el ranking por calidad y conversión ya funciona.
              </p>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.statusAvailable && (
              <Kpi icon={Radio} label="Anuncios activos" value={data.activeAds} tone="text-emerald-400" />
            )}
            <Kpi icon={Megaphone} label="Leads de anuncios" value={summary?.leads ?? 0} tone="text-violet-400" />
            <Kpi icon={TrendingUp} label="Score promedio" value={summary?.avgScore ?? 0} tone={scoreColor(summary?.avgScore ?? 0)} />
            <Kpi icon={CalendarCheck} label="Agendan" value={`${summary?.scheduleRate ?? 0}%`} tone="text-amber-400" />
            <Kpi icon={Trophy} label="Cierran" value={`${summary?.convRate ?? 0}%`} tone="text-emerald-400" />
            {showCosts && (
              <Kpi icon={DollarSign} label="Gasto total" value={fmtMoney(data.totalSpend)} tone="text-zinc-200" small />
            )}
            {showCosts && (
              <Kpi icon={Trophy} label="ROAS" value={summary?.roas != null ? `${summary.roas.toFixed(1)}×` : '—'} tone="text-emerald-400" />
            )}
          </div>

          {/* Input de ticket promedio para ROAS */}
          {showCosts && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Ticket promedio de venta (para ROAS):</span>
              <input
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                placeholder="Ej. 250000000"
                inputMode="numeric"
                className="h-8 w-44 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-zinc-100 outline-none focus:border-violet-500/60"
              />
              {summary?.closed ? <span className="text-zinc-600">· {summary.closed} cierres × ticket ÷ gasto</span> : null}
            </div>
          )}

          {/* Ranking de anuncios */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-200">Ranking de anuncios</h2>
              <div className="flex gap-1 rounded-lg border border-zinc-800 p-0.5">
                {([['quality', 'Calidad'], ['conversion', 'Conversión'], ['volume', 'Volumen'], ...(showCosts ? [['spend', 'Gasto'] as [AdSort, string], ['cpc', 'Costo/cierre'] as [AdSort, string]] : [])] as [AdSort, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setAdSort(k)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${adSort === k ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtros: estado + campaña */}
            {data.statusAvailable && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex gap-1 rounded-lg border border-zinc-800 p-0.5">
                  {([['all', 'Todos'], ['active', 'Activos'], ['paused', 'Pausados']] as [StatusFilter, string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setStatusFilter(k)}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${statusFilter === k ? 'bg-emerald-600/25 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {data.campaigns.length > 0 && (
                  <select
                    value={campaignFilter}
                    onChange={(e) => setCampaignFilter(e.target.value)}
                    className="h-8 max-w-[260px] rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-violet-500/60"
                  >
                    <option value="all">Todas las campañas ({data.campaigns.length})</option>
                    {data.campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <span className="text-[11px] text-zinc-600">{sortedAds.length} anuncios</span>
              </div>
            )}

            {sortedAds.length === 0 ? (
              <div className="py-8 text-center">
                <Megaphone size={22} className="mx-auto text-zinc-700" />
                {data.byAd.length > 0 ? (
                  <p className="mt-2 text-sm text-zinc-400">Ningún anuncio coincide con el filtro</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-zinc-400">Aún no hay anuncios de Meta</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      Verifica que la cuenta publicitaria tenga anuncios y que el token tenga acceso.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-[10px] uppercase text-zinc-500">
                      <th className="px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">Anuncio</th>
                      {data.statusAvailable && <th className="px-3 py-2 font-semibold">Estado</th>}
                      <th className="px-3 py-2 text-right font-semibold">Leads</th>
                      <th className="px-3 py-2 text-right font-semibold">Score</th>
                      <th className="px-3 py-2 text-right font-semibold">Agendan</th>
                      <th className="px-3 py-2 text-right font-semibold">Cierran</th>
                      {showCosts && <th className="px-3 py-2 text-right font-semibold">Gasto</th>}
                      {showCosts && <th className="px-3 py-2 text-right font-semibold">CPL</th>}
                      {showCosts && <th className="px-3 py-2 text-right font-semibold">C/Calif.</th>}
                      {showCosts && <th className="px-3 py-2 text-right font-semibold">C/Cierre</th>}
                      <th className="px-3 py-2 font-semibold">Pérdida top</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAds.map((ad, i) => <AdRowView key={ad.key} ad={ad} rank={i + 1} showCosts={showCosts} showStatus={data.statusAvailable} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Por fuente */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="mb-4 text-sm font-semibold text-zinc-200">Calidad y conversión por fuente</h2>
            <div className="flex flex-col gap-3">
              {data.bySource.map((s) => {
                const max = Math.max(...data.bySource.map((x) => x.leads), 1);
                return (
                  <div key={s.source} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-xs text-zinc-400">{SOURCE_LABEL[s.source] ?? s.source}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${(s.leads / max) * 100}%` }} />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-zinc-300">{s.leads}</span>
                    <span className={`w-16 text-right text-xs tabular-nums ${scoreColor(s.avgScore)}`}>
                      {s.avgScore > 0 ? `${s.avgScore} pts` : '—'}
                    </span>
                    <span className="w-16 text-right text-xs tabular-nums text-emerald-400">{s.convRate}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end gap-4 text-[10px] text-zinc-600">
              <span>leads</span><span>· score IA</span><span>· % cierre</span>
            </div>
          </div>

          <p className="text-center text-[10px] text-zinc-600">
            Actualizado {new Date(data.generatedAt).toLocaleString('es-CO')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AdRowView({ ad, rank, showCosts, showStatus }: { ad: AdRow; rank: number; showCosts: boolean; showStatus: boolean }) {
  const title = ad.headline || (ad.adId ? `Anuncio ${ad.adId}` : 'Sin identificar');
  const medal = rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-zinc-300' : rank === 3 ? 'text-orange-400' : 'text-zinc-600';
  const st = ad.status ? STATUS_META[ad.status] : null;
  return (
    <tr className="border-b border-zinc-800/60 hover:bg-zinc-900">
      <td className={`px-3 py-2.5 text-xs font-semibold tabular-nums ${medal}`}>{rank}</td>
      <td className="px-3 py-2.5">
        <p className="max-w-[220px] truncate text-xs text-zinc-200" title={title}>{title}</p>
        {ad.campaignName && <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-zinc-500" title={ad.campaignName}>{ad.campaignName}</p>}
      </td>
      {showStatus && (
        <td className="px-3 py-2.5">
          {st ? (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${st.cls}`} title={ad.effectiveStatus ?? ''}>
              {ad.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              {st.label}
            </span>
          ) : <span className="text-[10px] text-zinc-600">—</span>}
        </td>
      )}
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-300">{ad.leads}</td>
      <td className={`px-3 py-2.5 text-right text-xs font-semibold tabular-nums ${scoreColor(ad.avgScore)}`}>
        {ad.avgScore > 0 ? ad.avgScore : '—'}
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-amber-300">{ad.scheduleRate}%</td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-300">{ad.convRate}%</td>
      {showCosts && <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-300">{fmtMoney(ad.spend)}</td>}
      {showCosts && <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-400">{fmtMoney(ad.cpl)}</td>}
      {showCosts && <td className="px-3 py-2.5 text-right text-xs tabular-nums text-sky-300">{fmtMoney(ad.cpql)}</td>}
      {showCosts && <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-300">{fmtMoney(ad.cpc)}</td>}
      <td className="px-3 py-2.5">
        {ad.topLoss ? (
          <span className="rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
            {LOSS_LABEL[ad.topLoss] ?? ad.topLoss}
          </span>
        ) : <span className="text-[10px] text-zinc-600">—</span>}
      </td>
    </tr>
  );
}

function Kpi({ icon: Icon, label, value, tone, small }: { icon: typeof Flame; label: string; value: string | number; tone: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Icon size={13} className={tone} /> {label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${small ? 'text-lg' : 'text-2xl'} ${tone}`}>{value}</p>
    </div>
  );
}
