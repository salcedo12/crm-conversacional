import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, Calculator, Loader2, Plus, Users } from 'lucide-react';
import type { Lead } from '@/features/inbox/types';
import { DealBuyersModal } from './DealBuyersModal';
import { DealLotSection } from './DealLotSection';
import { DealPlanModal } from './DealPlanModal';
import { DealDocumentsSection } from './DealDocumentsSection';
import { formatPesos, summarizePlan } from '../utils/paymentPlan';
import {
  cancelDeal,
  createDeal,
  DEAL_STATUS_LABELS,
  listLeadDeals,
  type DealStatus,
  type DealSummary,
} from '../services/deals.service';

const STATUS_STYLES: Record<DealStatus, string> = {
  borrador:          'border-zinc-600 bg-zinc-800 text-zinc-300',
  plan_listo:        'border-sky-500/40 bg-sky-500/10 text-sky-300',
  preventa_en_firma: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  preventa_firmada:  'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  promesa_en_firma:  'border-amber-500/40 bg-amber-500/10 text-amber-300',
  promesa_firmada:   'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  anulado:           'border-red-500/30 bg-red-500/10 text-red-300',
};

/** Negocios del lead (sección del LeadDrawer): crear negocio y registrar sus compradores. */
export function LeadDealsPanel({ companyId, lead }: { companyId: string; lead: Lead }) {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DealSummary | null>(null);
  const [planning, setPlanning] = useState<DealSummary | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listLeadDeals(companyId, lead.id);
      setDeals(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los negocios.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [companyId, lead.id]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const dealId = await createDeal(companyId, lead.id);
      const list = await load();
      const created = list.find((d) => d.id === dealId);
      if (created) setEditing(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el negocio.');
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (deal: DealSummary) => {
    if (cancelReason.trim().length < 3) return;
    setCancelBusy(true);
    setError(null);
    try {
      await cancelDeal(companyId, deal.id, cancelReason.trim());
      setCancelingId(null);
      setCancelReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anular el negocio.');
    } finally {
      setCancelBusy(false);
    }
  };

  const hasOpenDeal = deals.some((d) => d.status !== 'anulado');

  return (
    <div className="space-y-2.5">
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500"><Loader2 size={12} className="animate-spin" /> Cargando negocios…</p>
      ) : deals.length === 0 ? (
        <p className="text-xs text-zinc-500">Sin negocios. Cuando el cliente decida comprar, crea el negocio para registrar sus datos.</p>
      ) : (
        deals.map((deal) => {
          const names = deal.buyerNames?.length
            ? deal.buyerNames
            : deal.buyerProfiles.map((b) => `${b.firstNames} ${b.lastNames}`.trim());
          const editable = deal.status === 'borrador' || deal.status === 'plan_listo';
          return (
            <div key={deal.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[deal.status]}`}>
                  {DEAL_STATUS_LABELS[deal.status]}
                </span>
                {deal.createdAt && (
                  <span className="text-[10px] text-zinc-600">{new Date(deal.createdAt).toLocaleDateString('es-CO')}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-zinc-300">
                {names.length ? names.join(' · ') : <span className="text-amber-300/90">Faltan los compradores</span>}
              </p>
              {deal.status === 'anulado' && deal.cancelReason && (
                <p className="mt-1 text-[11px] text-zinc-500">Motivo: {deal.cancelReason}</p>
              )}
              {deal.status !== 'anulado' && (
                <DealLotSection
                  companyId={companyId}
                  deal={deal}
                  projectHint={lead.projectInterest?.[0]}
                  onChanged={() => void load()}
                />
              )}
              {deal.status !== 'anulado' && deal.lot && (
                <DealPlanLine deal={deal} editable={editable} onEdit={() => setPlanning(deal)} />
              )}
              {deal.status !== 'anulado' && (
                <DealDocumentsSection companyId={companyId} deal={deal} onChanged={() => void load()} />
              )}
              {cancelingId === deal.id && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Motivo para anular este negocio"
                    rows={2}
                    autoFocus
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800/90 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-red-400"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleCancel(deal)}
                      disabled={cancelBusy || cancelReason.trim().length < 3}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {cancelBusy && <Loader2 size={11} className="animate-spin" />} Confirmar anulación
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCancelingId(null); setCancelReason(''); }}
                      className="px-2 text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      Volver
                    </button>
                  </div>
                </div>
              )}
              {deal.status !== 'anulado' && cancelingId !== deal.id && (
                <div className="mt-2 flex gap-3">
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setEditing(deal)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
                    >
                      <Users size={12} /> {deal.buyers.length ? 'Editar compradores' : 'Registrar compradores'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setCancelingId(deal.id); setCancelReason(''); }}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-red-300"
                  >
                    <Ban size={12} /> Anular
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {!loading && !hasOpenDeal && (
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Crear negocio
        </button>
      )}

      {error && <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      {planning && (
        <DealPlanModal
          companyId={companyId}
          deal={planning}
          onClose={() => setPlanning(null)}
          onSaved={() => { setPlanning(null); void load(); }}
        />
      )}

      {editing && (
        <DealBuyersModal
          companyId={companyId}
          deal={editing}
          lead={lead}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

/** Resumen del plan dentro de la tarjeta del negocio. */
function DealPlanLine({ deal, editable, onEdit }: { deal: DealSummary; editable: boolean; onEdit: () => void }) {
  const plan = deal.plan;
  const stale = !!plan && plan.lotId !== deal.lot?.inventoryLotId;
  const total = plan ? summarizePlan(plan).installmentsTotal : 0;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      {plan && !stale ? (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-300">
          <Calculator size={12} className="text-emerald-400" />
          Plan: {formatPesos(total)}{plan.termMonths ? ` · ${plan.termMonths} meses` : ' · de contado'}
        </p>
      ) : stale ? (
        <p className="flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={11} /> El plan era para otro lote; revísalo.</p>
      ) : (
        <span className="text-[11px] text-zinc-500">Falta el plan de negocio.</span>
      )}
      {editable && (
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200">
          <Calculator size={12} /> {plan ? 'Editar plan' : 'Armar plan'}
        </button>
      )}
    </div>
  );
}
