import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Phone, Search, X } from 'lucide-react';
import { checkPhoneAvailability, type PhoneAvailabilityResult } from '@/features/inbox/services/contacts.service';
import { useLeadById } from '@/features/inbox/hooks/useLeadById';
import { LeadDealsPanel } from './LeadDealsPanel';

/**
 * "Nuevo negocio" desde la pantalla de Negocios: se busca el lead por celular y ahí mismo
 * se crea y arma su negocio (compradores, lote, plan, documentos y firma), con el mismo
 * panel que tiene el lead en la Bandeja.
 */
export function NewDealByPhoneModal({ companyId, onClose, onChanged }: {
  companyId: string;
  onClose: () => void;
  /** Se llama al cerrar para recargar la lista de negocios. */
  onChanged: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<PhoneAvailabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { lead, loading } = useLeadById(companyId, result?.leadId ?? null);

  const search = async () => {
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      setResult(await checkPhoneAvailability(companyId, phone));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar el celular.');
    } finally {
      setSearching(false);
    }
  };

  const close = () => { onChanged(); onClose(); };

  // Sin lead visible: número nuevo, inválido o de otro asesor (el asesor no ve leads ajenos).
  const notice = (() => {
    if (!result) return null;
    if (result.status === 'invalid') return result.message ?? 'Número inválido.';
    if (result.status === 'available') return 'No hay un lead con ese celular. Créalo primero en la Bandeja (Nuevo contacto) y luego crea su negocio.';
    if (!result.leadId) return 'No se encontró el lead.';
    if (!loading && !lead) return result.status === 'locked_by_other'
      ? 'Ese celular es de un lead de otro asesor. Solicita el traslado desde la Bandeja.'
      : 'No tienes acceso a ese lead.';
    return null;
  })();

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-zinc-100"><Phone size={15} className="text-emerald-400" /> Nuevo negocio</p>
          <button type="button" onClick={close} aria-label="Cerrar" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X size={18} /></button>
        </header>
        <div className="space-y-3 overflow-y-auto p-4">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Celular del cliente (ej. 300 123 4567)"
              inputMode="tel"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
            <button type="submit" disabled={searching || phone.replace(/\D/g, '').length < 10}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
            </button>
          </form>
          {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-200">{error}</p>}
          {notice && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{notice}</p>}
          {result?.leadId && loading && <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 size={13} className="animate-spin" /> Cargando el lead…</p>}
          {lead && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-sm font-bold text-zinc-100">{lead.name || 'Sin nombre'}</p>
              <p className="mb-3 text-[11px] text-zinc-500">{lead.phone}{result?.advisorName ? ` · Asesor: ${result.advisorName}` : ''}</p>
              <LeadDealsPanel companyId={companyId} lead={lead} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
