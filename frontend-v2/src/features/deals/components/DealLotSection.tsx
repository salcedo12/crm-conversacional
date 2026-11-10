import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { DealLotPickerModal } from './DealLotPickerModal';
import {
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
export function DealLotSection({ companyId, deal, projectHint, onChanged }: DealLotSectionProps) {
  const [picking, setPicking] = useState(false);
  const [state, setState] = useState<{ state: DealLotState; expiresAt?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = deal.status === 'borrador' || deal.status === 'plan_listo';
  const lot = deal.lot;

  useEffect(() => {
    if (!lot || !editable) { setState(null); return; }
    let alive = true;
    getDealLotStatus(companyId, deal.id)
      .then((s) => { if (alive) setState(s); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
    // reservedUntil cambia al volver a apartar el mismo lote: hay que reconsultar su estado.
  }, [companyId, deal.id, lot?.inventoryLotId, lot?.reservedUntil, editable]);

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
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-xs text-zinc-200">
            <MapPin size={12} className="shrink-0 text-emerald-400" />
            <span className="truncate">
              {lot.sector} · Lote {lot.lotNumber} · {formatArea(lot.areaM2)}{lot.corner ? ' · Esquinero' : ''}
            </span>
          </p>
          {editable && state?.state === 'reservado' && (
            <p className="mt-1 text-[11px] text-zinc-500">Apartado hasta {formatUntil(state.expiresAt || lot.reservedUntil)}</p>
          )}
          {editable && state?.state === 'vencido' && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle size={11} /> La reserva venció y el lote volvió a estar disponible.
            </p>
          )}
          {editable && (state?.state === 'tomado' || state?.state === 'no_existe') && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-red-300">
              <AlertTriangle size={11} /> Este lote ya no está apartado para este negocio. Escoge otro.
            </p>
          )}
          {editable && (
            <div className="mt-1.5 flex flex-wrap gap-3">
              {state?.state === 'vencido' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => reserveDealLot(companyId, deal.id, lot.inventoryLotId))}
                  className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                >
                  Volver a apartar
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicking(true)}
                className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
              >
                Cambiar lote
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => releaseDealLot(companyId, deal.id))}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
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
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
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
