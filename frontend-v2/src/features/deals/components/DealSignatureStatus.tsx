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
    <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <PenLine size={11} /> Firma digital
      </p>

      {sent.map((doc) => {
        const st = STATUS[doc.signatureStatus] ?? STATUS.generado;
        const sig = doc.signature;
        return (
          <div key={doc.kind} className="mb-2 rounded border border-zinc-800/80 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-zinc-200">{LABELS[doc.kind]} · v{doc.version}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
            </div>
            {sig && (
              <ul className="mt-1 space-y-0.5">
                {[...sig.signers].sort((a, b) => a.iteration - b.iteration).map((s) => (
                  <li key={`${s.source}-${s.refId}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`flex min-w-0 items-center gap-1 ${s.signed ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {s.signed ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 text-zinc-600">· {s.typeSign}</span>
                    </span>
                    {canManage && !s.signed && pending(doc.signatureStatus) && s.docublockSignerId && (
                      <button type="button" disabled={!!busy} onClick={() => run(`re-${doc.kind}-${s.refId}`, () => resendDealSignature(companyId, deal.id, doc.kind, s.docublockSignerId!), `Invitación reenviada a ${s.name}`)}
                        className="inline-flex shrink-0 items-center gap-1 text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                        {busy === `re-${doc.kind}-${s.refId}` ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} Reenviar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sig?.expiresAt && pending(doc.signatureStatus) && (
              <p className="mt-1 text-[10px] text-zinc-500">Vence {new Date(sig.expiresAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
            )}
            {sig?.lastError && <p className="mt-1 text-[10px] text-amber-300">Última consulta: {sig.lastError}</p>}
            <div className="mt-1 flex flex-wrap gap-3">
              {doc.signatureStatus === 'firmado' && doc.signedPdfStoragePath && (
                <button type="button" disabled={!!busy} onClick={() => run(`see-${doc.kind}`, () => onViewSigned(doc))} className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                  {busy === `see-${doc.kind}` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Ver firmado
                </button>
              )}
              {canManage && pending(doc.signatureStatus) && (
                <button type="button" disabled={!!busy} onClick={() => {
                  const reason = window.prompt(`¿Por qué se anuló la firma de la ${doc.kind}? (anúlala también en el panel de DocuBlock)`);
                  if (reason && reason.trim().length >= 3) void run(`cancel-${doc.kind}`, () => markDealSignatureCancelled(companyId, deal.id, doc.kind, reason.trim()));
                }} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-red-300 disabled:opacity-50">
                  <Ban size={11} /> Marcar anulada
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-3">
        {canSend && (
          <button type="button" disabled={!!busy} onClick={() => setSending(true)} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
            <PenLine size={12} /> {sent.length ? 'Enviar a firma de nuevo' : 'Enviar a firma'}
          </button>
        )}
        {sent.some((d) => pending(d.signatureStatus)) && (
          <button type="button" disabled={!!busy} onClick={() => run('refresh', () => refreshDealSignature(companyId, deal.id))} className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
            {busy === 'refresh' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Actualizar estado
          </button>
        )}
      </div>
      {notice && <p className="mt-1.5 text-[11px] text-emerald-300">{notice}</p>}
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
      {sending && <SendToSignatureModal companyId={companyId} deal={deal} onClose={() => setSending(false)} onSent={onChanged} />}
    </div>
  );
}
