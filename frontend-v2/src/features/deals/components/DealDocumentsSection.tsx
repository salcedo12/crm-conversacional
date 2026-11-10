import { useState } from 'react';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import {
  downloadDealDocument,
  fetchDealDocumentPdf,
  generateDealDocument,
  type DealDocumentKind,
  type DealSummary,
} from '../services/deals.service';
import { DealDocumentPreview } from './DealDocumentPreview';
import { DealSignatureStatus } from './DealSignatureStatus';
import { dealActionCls } from './DealSheet';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';

const LABELS: Record<DealDocumentKind, string> = {
  preventa: 'Contrato de preventa',
  promesa: 'Promesa de compraventa',
};

/**
 * Documentos del negocio: generar la preventa (con "Plan listo") y la promesa (sale de
 * los mismos datos de la última preventa), verlos aquí mismo o descargarlos en Word.
 */
export function DealDocumentsSection({ companyId, deal, onChanged }: { companyId: string; deal: DealSummary; onChanged: () => void }) {
  const { role, platformAdmin } = useAuth();
  // Los asesores solo pueden ver los contratos; descargarlos (PDF o Word) es de administradores.
  const canDownload = platformAdmin || isAdminRole(role);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; kind: DealDocumentKind; version: number; pdf: { fileName: string; blob: Blob } } | null>(null);
  const documents = deal.documents ?? [];
  const hasPreventa = documents.some((d) => d.kind === 'preventa');
  const canGeneratePreventa = deal.status === 'plan_listo';

  if (!canGeneratePreventa && !documents.length) return null;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(null);
    }
  };

  const view = async (kind: DealDocumentKind, version: number) => {
    const pdf = await fetchDealDocumentPdf(companyId, deal.id, kind, version);
    setPreview({ title: `${LABELS[kind]} · v${version}`, kind, version, pdf });
  };

  const viewSigned = async (doc: { kind: DealDocumentKind; version: number }) => {
    const pdf = await fetchDealDocumentPdf(companyId, deal.id, doc.kind, doc.version, true);
    setPreview({ title: `${LABELS[doc.kind]} · v${doc.version} · FIRMADO`, kind: doc.kind, version: doc.version, pdf });
  };

  const generate = (kind: DealDocumentKind) => run(`gen-${kind}`, async () => {
    const res = await generateDealDocument(companyId, deal.id, kind);
    onChanged();
    await view(kind, res.version);
  });

  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 sm:rounded-md sm:px-2.5 sm:py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <FileText size={11} /> Documentos
      </p>
      {documents.length > 0 && (
        <ul className="mb-2 space-y-1">
          {[...documents].reverse().map((d) => (
            <li key={`${d.kind}-${d.version}`} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-zinc-300 sm:flex-nowrap sm:text-[11px]">
              <span className="min-w-0 truncate">
                {LABELS[d.kind]} · v{d.version}
                {d.generatedAt && <span className="text-zinc-600"> · {new Date(d.generatedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => run(`view-${d.kind}-${d.version}`, () => view(d.kind, d.version))}
                  className={`${dealActionCls} text-emerald-300 hover:text-emerald-200`}
                >
                  {busy === `view-${d.kind}-${d.version}` ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Ver
                </button>
                {canDownload && <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => run(`dl-${d.kind}-${d.version}`, () => downloadDealDocument(companyId, deal.id, d.kind, d.version))}
                  className={`${dealActionCls} font-normal text-zinc-400 hover:text-zinc-200`}
                >
                  {busy === `dl-${d.kind}-${d.version}` ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Word
                </button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {canGeneratePreventa && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => generate('preventa')}
            className={`${dealActionCls} text-emerald-300 hover:text-emerald-200`}
          >
            {busy === 'gen-preventa' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            {hasPreventa ? 'Generar preventa de nuevo' : 'Generar preventa'}
          </button>
        )}
        {hasPreventa && deal.status === 'plan_listo' && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => generate('promesa')}
            className={`${dealActionCls} text-emerald-300 hover:text-emerald-200`}
          >
            {busy === 'gen-promesa' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Generar promesa
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
      <DealSignatureStatus companyId={companyId} deal={deal} canManage={canDownload} onChanged={onChanged} onViewSigned={viewSigned} />
      {preview && <DealDocumentPreview title={preview.title} pdf={preview.pdf} onDownloadWord={canDownload ? () => downloadDealDocument(companyId, deal.id, preview.kind, preview.version) : undefined} onClose={() => setPreview(null)} />}
    </div>
  );
}
