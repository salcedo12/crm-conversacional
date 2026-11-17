import { useState } from 'react';
import { Ban, CheckCircle2, Clock, Loader2, PenLine, RefreshCw, Send } from 'lucide-react';
import {
  markDealSignatureCancelled,
  refreshDealSignature,
  resendDealSignature,
  type DealDocumentInfo,
  type DealDocumentKind,
  type DealSummary,
  type SignatureStatus,
} from '../services/deals.service';
import { SendToSignatureModal } from './SendToSignatureModal';

const LABELS: Record<DealDocumentKind, string> = { preventa: 'Preventa', promesa: 'Promesa' };

const STATUS: Record<SignatureStatus, { label: string; cls: string }> = {
  generado:        { label: 'Sin enviar', cls: 'border-zinc-700 text-zinc-400' },
  en_firma:        { label: 'En firma', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  firmado_parcial: { label: 'Firmando', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  firmado:         { label: 'Firmado', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  rechazado:       { label: 'Rechazado', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  vencido:         { label: 'Vencido', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
  anulado:         { label: 'Anulado', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
};

const pending = (s: SignatureStatus) => s === 'en_firma' || s === 'firmado_parcial';

/**
 * Firma con DocuBlock dentro del negocio: avance de cada firmante (se actualiza solo cada
 * 10 min), reenviar invitación, ver el PDF firmado y enviar a firma (administradores).
 */
export function DealSignatureStatus({ companyId, deal, canManage, onChanged, onViewSigned }: {
  companyId: string;
  deal: DealSummary;
  canManage: boolean;
  onChanged: () => void;
  onViewSigned: (doc: DealDocumentInfo) => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const latest = (kind: DealDocumentKind) => [...(deal.documents ?? [])].reverse().find((d) => d.kind === kind);
  const sent = (['preventa', 'promesa'] as DealDocumentKind[]).map(latest).filter((d): d is DealDocumentInfo => !!d?.docublockDocumentId);
  const canSend = canManage && deal.status !== 'anulado' && deal.status !== 'borrador' && !!latest('preventa')
    && (['preventa', 'promesa'] as DealDocumentKind[]).some((k) => { const s = latest(k)?.signatureStatus; return !s || (!pending(s) && s !== 'firmado'); });

  if (!sent.length && !canSend) return null;

  const run = async (key: string, action: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (ok) setNotice(ok);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 sm:p-5 shadow-lg space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-400 shrink-0">
            <PenLine size={22} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-zinc-100 sm:text-base">Firma Digital (DocuBlock)</h4>
            <p className="mt-0.5 text-xs text-zinc-400">
              Envía los contratos a firma electrónica para compradores y representantes legales.
            </p>
          </div>
        </div>

        {canSend && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setSending(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-50 sm:shrink-0"
          >
            <PenLine size={14} />
            {sent.length ? 'Enviar a firma de nuevo' : 'Enviar contrato a firma digital'}
          </button>
        )}
      </div>

      {sent.map((doc) => {
        const st = STATUS[doc.signatureStatus] ?? STATUS.generado;
        const sig = doc.signature;
        return (
          <div key={doc.kind} className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
              <p className="text-xs font-bold text-zinc-100">{LABELS[doc.kind]} · v{doc.version}</p>
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
            </div>
            {sig && (
              <ul className="space-y-1.5">
                {[...sig.signers].sort((a, b) => a.iteration - b.iteration).map((s) => (
                  <li key={`${s.source}-${s.refId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-900/50 px-2.5 py-1.5 text-xs">
                    <span className={`flex min-w-0 items-center gap-1.5 ${s.signed ? 'text-emerald-300 font-medium' : 'text-zinc-300'}`}>
                      {s.signed ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" /> : <Clock size={13} className="text-amber-400 shrink-0" />}
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 text-zinc-500">({s.typeSign})</span>
                    </span>
                    {canManage && !s.signed && pending(doc.signatureStatus) && s.docublockSignerId && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => run(`re-${doc.kind}-${s.refId}`, () => resendDealSignature(companyId, deal.id, doc.kind, s.docublockSignerId!), `Invitación reenviada a ${s.name}`)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                      >
                        {busy === `re-${doc.kind}-${s.refId}` ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Reenviar invitación
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sig?.expiresAt && pending(doc.signatureStatus) && (
              <p className="text-[11px] text-zinc-500">Vence: {new Date(sig.expiresAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
            )}
            {sig?.lastError && <p className="text-[11px] text-amber-300">Última consulta: {sig.lastError}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {doc.signatureStatus === 'firmado' && doc.signedPdfStoragePath && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => run(`see-${doc.kind}`, () => onViewSigned(doc))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30"
                >
                  {busy === `see-${doc.kind}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Ver documento firmado
                </button>
              )}
              {canManage && pending(doc.signatureStatus) && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    const reason = window.prompt(`¿Por qué se anuló la firma de la ${doc.kind}? (anúlala también en el panel de DocuBlock)`);
                    if (reason && reason.trim().length >= 3) void run(`cancel-${doc.kind}`, () => markDealSignatureCancelled(companyId, deal.id, doc.kind, reason.trim()));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                >
                  <Ban size={12} /> Marcar anulada
                </button>
              )}
            </div>
          </div>
        );
      })}

      {sent.some((d) => pending(d.signatureStatus)) && (
        <div className="pt-1">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('refresh', () => refreshDealSignature(companyId, deal.id))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            {busy === 'refresh' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Actualizar estado de firmas
          </button>
        </div>
      )}

      {notice && <p className="text-xs text-emerald-300 font-medium">{notice}</p>}
      {error && <p className="text-xs text-red-300 font-medium">{error}</p>}
      {sending && <SendToSignatureModal companyId={companyId} deal={deal} onClose={() => setSending(false)} onSent={onChanged} />}
    </div>
  );
}
