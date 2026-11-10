import { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, User, Phone, X, Send, AlertTriangle } from 'lucide-react';
import { requestLeadTransfer } from '@/features/inbox/services/contacts.service';
import type { Advisor } from '../services/advisors.service';

interface RequestLeadTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  leadId: string;
  leadName?: string;
  leadPhone: string;
  currentAdvisorId?: string | null;
  currentAdvisorName?: string;
  advisors?: Advisor[];
  currentUserId?: string;
  onSuccess?: () => void;
}

export function RequestLeadTransferModal({
  isOpen,
  onClose,
  companyId,
  leadId,
  leadName,
  leadPhone,
  currentAdvisorId,
  currentAdvisorName,
  advisors = [],
  currentUserId,
  onSuccess,
}: RequestLeadTransferModalProps) {
  const [reason, setReason] = useState('');
  const [targetAdvisorId, setTargetAdvisorId] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOwnLead = Boolean(currentUserId && currentAdvisorId && currentUserId === currentAdvisorId);
  const availableAdvisors = advisors.filter((a) => a.id !== currentUserId && a.active);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || sending) return;

    setSending(true);
    setError(null);
    try {
      await requestLeadTransfer({
        companyId,
        leadId,
        phone: leadPhone,
        reason: reason.trim(),
        targetAdvisorId: targetAdvisorId || undefined,
      });
      setSent(true);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('[RequestLeadTransferModal] Error enviando solicitud:', err);
      setError(err?.message || 'No se pudo enviar la solicitud de reasignación.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setReason('');
    setTargetAdvisorId('');
    setSent(false);
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden text-zinc-100 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <ArrowRightLeft size={19} />
            </span>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                {isOwnLead ? 'Solicitar Reasignación de Prospecto' : 'Solicitar Traslado a mi Cartera'}
              </h3>
              <p className="text-xs text-zinc-400">
                Se enviará a Dirección Comercial para su revisión y aprobación.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        {/* Content */}
        {sent ? (
          <div className="p-6 text-center space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto">
              <CheckCircle2 size={30} />
            </div>
            <div>
              <h4 className="text-base font-bold text-zinc-100">¡Solicitud enviada con éxito!</h4>
              <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
                El Administrador ha recibido la notificación y podrá revisar el historial y aprobar la reasignación en el panel de Dirección Comercial.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-950/60 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Datos del Prospecto */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <User size={15} className="text-amber-400" />
                <span className="text-xs font-bold text-zinc-100">{leadName || 'Prospecto'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
                <Phone size={12} className="text-zinc-500" />
                <span>{leadPhone}</span>
              </div>
              <div className="w-full pt-1 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
                <span>Asesor asignado actual:</span>
                <strong className="text-zinc-200">{currentAdvisorName || 'Sin asignar'}</strong>
              </div>
            </div>

            {/* Asesor sugerido (opcional) */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Reasignar a otro compañero (opcional)
              </label>
              <select
                value={targetAdvisorId}
                onChange={(e) => setTargetAdvisorId(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="">A criterio del Administrador / Dirección Comercial</option>
                {availableAdvisors.map((adv) => (
                  <option key={adv.id} value={adv.id}>
                    {adv.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Motivo */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Motivo de la solicitud <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                rows={3}
                placeholder={
                  isOwnLead
                    ? 'Explica por qué solicitas reasignar este prospecto (ej. cliente solicita cambio, fuera de zona, acuerdo comercial con compañero)...'
                    : 'Explica por qué solicitas el traslado de este prospecto a tu cuenta...'
                }
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none resize-none"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={handleClose}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={sending || !reason.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send size={13} />
                <span>{sending ? 'Enviando...' : 'Enviar Solicitud'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
