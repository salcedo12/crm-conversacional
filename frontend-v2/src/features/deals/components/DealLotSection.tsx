import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { DealLotPickerModal } from './DealLotPickerModal';
import { dealActionCls } from './DealSheet';
import {
  canEditDealConditions,
  formatArea,
  getDealLotStatus,
  releaseDealLot,
  reserveDealLot,
  type DealLotState,
  type DealSummary,
} from '../services/deals.service';

interface DealLotSectionProps {
  companyId:    string;
  deal:         DealSummary;
  projectHint?: string;
  isAdmin?:     boolean;
  readOnly?:    boolean;
  onChanged:    () => void;
}

function formatUntil(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Lote del negocio dentro de la tarjeta: apartarlo desde el inventario en vivo,
 * cambiarlo o liberarlo, y avisar si la reserva de 24 h venció o alguien más lo tomó.
 */
export function DealLotSection({ companyId, deal, projectHint, isAdmin = false, readOnly = false, onChanged }: DealLotSectionProps) {
  const [picking, setPicking] = useState(false);
  const [state, setState] = useState<{ state: DealLotState; expiresAt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDraft = deal.status === 'borrador' || deal.status === 'plan_listo';
  const editable = !readOnly && canEditDealConditions(deal.status, isAdmin);
  const lot = deal.lot;

  useEffect(() => {
    if (!lot || !isDraft) { setState(null); return; }
    let alive = true;
    getDealLotStatus(companyId, deal.id)
      .then((s) => { if (alive) setState(s); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
    // reservedUntil cambia al volver a apartar el mismo lote: hay que reconsultar su estado.
  }, [companyId, deal.id, lot?.inventoryLotId, lot?.reservedUntil, isDraft]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el lote.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      {lot ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 sm:rounded-md sm:px-2.5 sm:py-2">
          <p className="flex items-center gap-1.5 text-sm text-zinc-200 sm:text-xs">
            <MapPin size={12} className="shrink-0 text-emerald-400" />
            <span className="min-w-0 sm:truncate">
              {lot.sector} · Lote {lot.lotNumber}{lot.lotCode ? ` · Cód. ${lot.lotCode}` : ''} · {formatArea(lot.areaM2)}{lot.corner ? ' · Esquinero' : ''}
            </span>
          </p>
          {isDraft && state?.state === 'reservado' && (
            <p className="mt-1 text-[11px] text-zinc-500">Apartado hasta {formatUntil(state.expiresAt || lot.reservedUntil)}</p>
          )}
          {isDraft && state?.state === 'vencido' && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle size={11} /> La reserva venció y el lote volvió a estar disponible.
            </p>
          )}
          {isDraft && (state?.state === 'tomado' || state?.state === 'no_existe') && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-red-300">
              <AlertTriangle size={11} /> Este lote ya no está apartado para este negocio. Escoge otro.
            </p>
          )}
          {editable && (
            <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-1.5 sm:gap-3">
              {isDraft && state?.state === 'vencido' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => reserveDealLot(companyId, deal.id, lot.inventoryLotId))}
                  className={`${dealActionCls} text-emerald-300 hover:text-emerald-200`}
                >
                  Volver a apartar
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicking(true)}
                className={`${dealActionCls} text-emerald-300 hover:text-emerald-200`}
              >
                Cambiar lote
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!isDraft && !window.confirm('Este negocio ya tiene contratos generados o en firma. ¿Liberar este lote y marcar sus contratos como vencidos?')) {
                    return;
                  }
                  void run(() => releaseDealLot(companyId, deal.id));
                }}
                className={`${dealActionCls} font-normal text-zinc-500 hover:text-zinc-300`}
              >
                Liberar
              </button>
              {busy && <Loader2 size={12} className="animate-spin text-zinc-500" />}
            </div>
          )}
        </div>
      ) : editable ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 sm:inline-flex sm:min-h-0 sm:w-auto sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 sm:text-[11px] sm:font-medium sm:hover:bg-transparent sm:hover:text-emerald-200"
        >
          <MapPin size={12} /> Escoger lote
        </button>
      ) : null}

      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}

      {picking && (
        <DealLotPickerModal
          companyId={companyId}
          deal={deal}
          projectHint={projectHint}
          onClose={() => setPicking(false)}
          onReserved={() => { setPicking(false); onChanged(); }}
        />
      )}
    </div>
  );
}
