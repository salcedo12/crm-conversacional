import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, X } from 'lucide-react';
import { saveDealDocument } from '../services/deals.service';

/**
 * Muestra el contrato como PDF (convertido en nuestro servidor, igual a como se imprime)
 * dibujando cada página con pdf.js, que funciona igual en computador y celular.
 * Sin `onDownloadWord` (asesores) no hay botones de descarga: solo se puede ver.
 */
export function DealDocumentPreview({ title, pdf, onDownloadWord, onClose }: {
  title: string;
  pdf: { fileName: string; blob: Blob };
  onDownloadWord?: () => Promise<void>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.blob.arrayBuffer()) }).promise;
        const container = containerRef.current;
        if (cancelled || !container) return;
        container.innerHTML = '';
        // Ancho de la hoja: el del visor (máx. 900px), con buena nitidez en pantallas retina.
        const width = Math.min(container.clientWidth - 16, 900);
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = 'mx-auto mb-4 block bg-white shadow-lg';
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
          if (n === 1) setRendering(false);
        }
      } catch {
        if (!cancelled) setError('No se pudo mostrar el documento. Descárgalo en Word.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadWord = async () => {
    setDownloading(true);
    try { await onDownloadWord?.(); } finally { setDownloading(false); }
  };

  return createPortal(
    // Por encima del panel del lead (LeadDrawer z-[110]) y de las fichas (z-[150]).
    <div className="fixed inset-0 z-[200] flex flex-col bg-zinc-950/95" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950 px-4 pb-2.5 pt-[max(0.625rem,var(--safe-top))]" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-semibold text-zinc-100">{title}</p>
        <div className="flex shrink-0 items-center gap-2">
          {onDownloadWord && <>
          <button
            type="button"
            onClick={() => saveDealDocument(pdf.fileName, pdf.blob)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Download size={13} /> PDF
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={() => void downloadWord()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-emerald-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Word
          </button>
          </>}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:mr-0 sm:h-8 sm:w-8">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="relative flex-1 overflow-auto overscroll-contain px-2 pb-[max(1rem,var(--safe-bottom))] pt-4" onClick={(e) => e.stopPropagation()}>
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}
        {error && <p className="m-6 rounded-md bg-red-950/60 p-3 text-sm text-red-200">{error}</p>}
        {/* Sin menú de clic derecho sobre las hojas (evita "Guardar imagen como" a quien solo puede ver). */}
        <div ref={containerRef} className="deal-pdf-preview" onContextMenu={onDownloadWord ? undefined : (e) => e.preventDefault()} />
      </div>
    </div>,
    document.body,
  );
}
