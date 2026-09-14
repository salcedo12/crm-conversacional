import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Camera, ExternalLink, Download, Phone, Calendar, User, CheckCircle2, Copy } from 'lucide-react';
import { formatPhone } from '@/shared/utils/formatPhone';
import type { PhotoEvidenceItem } from '../types';

export function PublicEvidenceViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const [evidence, setEvidence] = useState<PhotoEvidenceItem | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 1. Si viene URL directa en query params
    const queryUrl = searchParams.get('url');
    const queryNotes = searchParams.get('notes');
    const queryName = searchParams.get('name');
    const queryPhone = searchParams.get('phone');
    const queryAuthor = searchParams.get('author');

    if (queryUrl) {
      setEvidence({
        id: id || 'ev_direct',
        photoUrl: decodeURIComponent(queryUrl),
        storagePath: '',
        notes: queryNotes ? decodeURIComponent(queryNotes) : '',
        leadName: queryName ? decodeURIComponent(queryName) : 'Cliente',
        leadPhone: queryPhone ? decodeURIComponent(queryPhone) : '',
        authorName: queryAuthor ? decodeURIComponent(queryAuthor) : 'Asesor Comercial',
        authorId: '',
        actionLabel: 'Registro Fotográfico',
        context: 'Comercial',
        createdAt: Date.now(),
        smartHomeSynced: true,
      });
      return;
    }

    // 2. Buscar en registros locales de cualquier empresa
    if (id) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('meraki:photo_evidence:v1:')) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const list = JSON.parse(raw) as PhotoEvidenceItem[];
              const found = list.find((e) => e.id === id || e.leadPhone?.replace(/\D/g, '') === id.replace(/\D/g, ''));
              if (found) {
                setEvidence(found);
                return;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[PublicEvidenceViewerPage] search error:', err);
      }
    }
  }, [id, searchParams]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-4 md:p-8">
      {/* Header */}
      <header className="w-full max-w-2xl flex items-center justify-between pb-6 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 border border-violet-500/20">
            <Camera size={18} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Meraki CRM</h1>
            <p className="text-[10px] text-zinc-400">Evidencia Fotográfica de Visita</p>
          </div>
        </div>

        <button
          onClick={handleCopyLink}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          {copied ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Copy size={13} />}
          <span>{copied ? 'Enlace copiado' : 'Copiar enlace'}</span>
        </button>
      </header>

      {/* Contenido */}
      <main className="w-full max-w-2xl mt-6 space-y-5">
        {evidence?.photoUrl ? (
          <>
            {/* Imagen Principal */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-2 md:p-3 overflow-hidden shadow-xl">
              <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center min-h-[300px] max-h-[70vh]">
                <img
                  src={evidence.photoUrl}
                  alt="Evidencia fotográfica"
                  className="max-h-[68vh] w-auto max-w-full object-contain"
                />
              </div>

              <div className="mt-3 flex items-center justify-between px-2 pb-1">
                <span className="text-[11px] text-zinc-500">
                  {evidence.createdAt ? new Date(evidence.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Fecha registrada'}
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={evidence.photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-medium"
                  >
                    <ExternalLink size={13} /> Abrir original
                  </a>
                  <a
                    href={evidence.photoUrl}
                    download="evidencia_meraki.jpg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 font-medium ml-2"
                  >
                    <Download size={13} /> Descargar
                  </a>
                </div>
              </div>
            </div>

            {/* Ficha de Detalles */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3.5">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">{evidence.leadName || 'Contacto'}</h2>
                  {evidence.leadPhone && (
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                      <Phone size={12} className="text-zinc-500" /> {formatPhone(evidence.leadPhone)}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-violet-600/20 border border-violet-500/20 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                    {evidence.actionLabel || 'Registro'}
                  </span>
                  {evidence.smartHomeSynced && (
                    <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                      Enviado a SmartHome ✓
                    </span>
                  )}
                </div>
              </div>

              {/* Observación */}
              {evidence.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                    Observación / Detalle de la visita
                  </p>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {evidence.notes}
                  </div>
                </div>
              )}

              {/* Footer de Metadatos */}
              <div className="flex items-center justify-between pt-1 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <User size={12} /> Registrado por: <strong className="text-zinc-400">{evidence.authorName}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={12} /> {evidence.createdAt ? new Date(evidence.createdAt).toLocaleDateString('es-CO') : ''}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center text-zinc-400 space-y-2">
            <Camera size={32} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-sm font-medium text-zinc-300">Evidencia no encontrada o enlace vencido</p>
            <p className="text-xs text-zinc-500">Verifica que el identificador o número sea correcto.</p>
          </div>
        )}
      </main>
    </div>
  );
}
