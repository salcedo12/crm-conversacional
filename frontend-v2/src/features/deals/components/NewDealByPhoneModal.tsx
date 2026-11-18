import { useState } from 'react';
import { Loader2, Phone, Search } from 'lucide-react';
import { checkPhoneAvailability, type PhoneAvailabilityResult } from '@/features/inbox/services/contacts.service';
import { useLeadById } from '@/features/inbox/hooks/useLeadById';
import { LeadDealsPanel } from './LeadDealsPanel';
import { DealSheet, dealInputCls } from './DealSheet';

/**
 * "Nuevo negocio" desde la pantalla de Negocios: se busca el lead por celular y ahí mismo
 * se crea y arma su negocio (compradores, lote, plan, documentos y firma), con el mismo
 * panel que tiene el lead en la Bandeja.
 */
export function NewDealByPhoneModal({ companyId, projectHint, onClose, onChanged }: {
  companyId: string;
  projectHint?: string;
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

  return (
    <DealSheet title="Nuevo negocio" subtitle="Busca al cliente por su celular para crear y armar su negocio." icon={<Phone size={18} />} onClose={close} width="md" layer="base" bodyClassName="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input
          autoFocus
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Celular (ej. 300 123 4567)"
          inputMode="tel"
          type="tel"
          enterKeyHint="search"
          className={`${dealInputCls} flex-1 sm:text-sm`}
        />
        <button type="submit" disabled={searching || phone.replace(/\D/g, '').length < 10}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 sm:px-3 sm:text-xs">
          {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Buscar
        </button>
      </form>
      {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200 sm:text-xs">{error}</p>}
      {notice && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 sm:text-xs">{notice}</p>}
      {result?.leadId && loading && <p className="flex items-center gap-2 text-sm text-zinc-400 sm:text-xs"><Loader2 size={14} className="animate-spin" /> Cargando el lead…</p>}
      {lead && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-base font-bold text-zinc-100 sm:text-sm">{lead.name || 'Sin nombre'}</p>
          <p className="mb-3 text-xs text-zinc-500 sm:text-[11px]">{lead.phone}{result?.advisorName ? ` · Asesor: ${result.advisorName}` : ''}</p>
          <LeadDealsPanel companyId={companyId} lead={lead} projectHint={projectHint} />
        </div>
      )}
    </DealSheet>
  );
}