import { useEffect, useState } from 'react';
import { ExternalLink, Megaphone, Play, Video as VideoIcon, Image as ImageIcon, Loader2 } from 'lucide-react';
import type { LeadSourceMeta } from '../types';
import { fetchMetaAdCreative, type MetaAdCreative } from '../services/metaCreative.service';

/**
 * Determina si una URL corresponde a un archivo o stream de video reproducible
 * directamente en un elemento <video> de HTML5 (p. ej. MP4 de CDN).
 * Los enlaces web de navegación de Facebook (story.php, watch, posts, fb.me) son páginas HTML, no videos.
 */
function isPlayableVideoUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim().toLowerCase();
  if (
    clean.includes('facebook.com/story.php') ||
    clean.includes('facebook.com/watch') ||
    clean.includes('facebook.com/posts') ||
    clean.includes('fb.me/') ||
    clean.includes('instagram.com/p/') ||
    clean.includes('instagram.com/reel/')
  ) {
    return false;
  }
  return clean.includes('.mp4') || clean.includes('.webm') || clean.includes('/m366/') || clean.includes('fbcdn.net');
}

interface AdReferralCardProps {
  referral:   LeadSourceMeta;
  companyId?: string;
  leadId?:    string;
  /** Si es true, se muestra en versión compacta (p. ej. en el encabezado o drawer) */
  compact?:   boolean;
}

export function AdReferralCard({ referral, companyId, leadId, compact = false }: AdReferralCardProps) {
  const [creative, setCreative] = useState<MetaAdCreative | null>(null);
  const [fetching, setFetching] = useState(false);

  const hasPlayableVideo = isPlayableVideoUrl(referral.videoUrl);

  useEffect(() => {
    // Si ya tenemos el archivo MP4 reproducible directo y miniatura, no hace falta consultar Meta
    if ((hasPlayableVideo && referral.imageUrl) || !referral.adId || !companyId) return;

    let cancelled = false;
    setFetching(true);
    fetchMetaAdCreative(companyId, referral.adId, leadId)
      .then((data) => {
        if (!cancelled && data) {
          setCreative(data);
        }
      })
      .catch(() => {
        // Fallback silencioso a los enlaces de Meta
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, referral.adId, hasPlayableVideo, referral.imageUrl, leadId]);

  // Asegurar que videoUrl sea exclusivamente un stream de video reproducible
  const directVideoUrl = hasPlayableVideo ? referral.videoUrl : undefined;
  const videoUrl  = directVideoUrl || (isPlayableVideoUrl(creative?.videoUrl) ? creative?.videoUrl : undefined);
  const imageUrl  = referral.imageUrl || creative?.imageUrl;
  const isVideo   = referral.mediaType === 'video' || creative?.mediaType === 'video' || !!videoUrl;
  const headline  = referral.headline || creative?.headline || 'Anuncio publicitario';
  const body      = referral.body || creative?.body;

  // Si referral.videoUrl era un enlace web (story.php), preservarlo como sourceUrl para el botón de Facebook
  const webLinkFromVideo = referral.videoUrl && !isPlayableVideoUrl(referral.videoUrl) ? referral.videoUrl : undefined;
  const sourceUrl = referral.sourceUrl || webLinkFromVideo || creative?.sourceUrl;

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-200">
        <Megaphone size={14} className="shrink-0 text-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-blue-100">
            Pauta: <span className="text-zinc-100">{headline}</span>
          </p>
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-600/30 px-2 py-0.5 text-[11px] font-medium text-blue-200 hover:bg-blue-600/50 hover:text-white transition-colors"
          >
            {isVideo ? <Play size={10} className="fill-current" /> : <ExternalLink size={10} />}
            <span>{isVideo ? 'Ver video' : 'Ver pauta'}</span>
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 max-w-sm rounded-xl border border-violet-500/30 bg-zinc-900/95 p-3 shadow-lg shadow-black/40">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300">
          <Megaphone size={13} className="text-violet-400" />
          <span>Anuncio de Meta</span>
        </div>
        <div className="flex items-center gap-1.5">
          {fetching && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-400">
              <Loader2 size={10} className="animate-spin text-violet-400" />
              <span>Cargando video…</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            {isVideo ? (
              <>
                <VideoIcon size={11} className="text-amber-400" />
                <span>Video</span>
              </>
            ) : (
              <>
                <ImageIcon size={11} className="text-sky-400" />
                <span>Imagen</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Reproductor de Video directo dentro del CRM */}
      {videoUrl ? (
        <div className="mt-2.5 overflow-hidden rounded-lg bg-black border border-zinc-800">
          <video
            key={videoUrl}
            controls
            playsInline
            preload="auto"
            poster={imageUrl}
            className="max-h-64 w-full object-contain"
          >
            <source src={videoUrl} type="video/mp4" />
            Tu navegador no soporta reproducción de video HTML5.
          </video>
        </div>
      ) : imageUrl ? (
        /* Miniatura con botón de reproducción si no hay MP4 directo */
        <div className="relative mt-2.5 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800">
          <img
            src={imageUrl}
            alt={headline}
            className="max-h-48 w-full object-cover"
          />
          {isVideo && sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/30 transition-colors group"
              title="Reproducir video en Facebook"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600/95 text-white shadow-xl transition-transform group-hover:scale-110">
                <Play size={20} className="ml-0.5 fill-white" />
              </div>
            </a>
          )}
        </div>
      ) : null}

      {/* Titular y copy del anuncio */}
      <div className="mt-2.5 space-y-1">
        <p className="text-xs font-semibold text-zinc-100">{headline}</p>
        {body && (
          <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-3">
            {body}
          </p>
        )}
      </div>

      {/* Botón de acción para abrir en Facebook si se desea ver comentarios/métricas */}
      {sourceUrl && (
        <div className="mt-3 pt-2 border-t border-zinc-800/80">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-600 hover:text-white"
          >
            {isVideo ? <Play size={12} className="fill-current text-violet-300" /> : <ExternalLink size={12} />}
            <span>{videoUrl ? 'Ver anuncio en Facebook ↗' : 'Ver video del anuncio en Facebook ↗'}</span>
          </a>
        </div>
      )}

      {/* ID de anuncio */}
      {referral.adId && (
        <p className="mt-1.5 text-right text-[9px] text-zinc-500">
          Ad ID: {referral.adId}
        </p>
      )}
    </div>
  );
}
