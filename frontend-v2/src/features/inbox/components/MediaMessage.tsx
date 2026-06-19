import { isImage, isVideo, isAudio, isPdf } from '../services/media.service';

interface MediaMessageProps {
  mediaUrl:  string;
  mediaType: string;
  content?:  string; // caption opcional
  isSticker?: boolean;
}

export function MediaMessage({ mediaUrl, mediaType, content, isSticker = false }: MediaMessageProps) {
  if (isSticker) {
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-fit"
        aria-label="Abrir sticker"
      >
        <img
          src={mediaUrl}
          alt="Sticker"
          className="max-w-[128px] max-h-[128px] object-contain cursor-pointer drop-shadow-sm hover:scale-[1.02] transition-transform"
          loading="lazy"
        />
      </a>
    );
  }

  if (isImage(mediaType)) {
    return (
      <div className="flex flex-col gap-1.5">
        <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={mediaUrl}
            alt="Imagen adjunta"
            className="max-w-[260px] max-h-[320px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
          />
        </a>
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
      </div>
    );
  }

  if (isVideo(mediaType)) {
    return (
      <div className="flex flex-col gap-1.5">
        <video
          src={mediaUrl}
          controls
          className="max-w-[280px] rounded-xl"
          preload="metadata"
        />
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
      </div>
    );
  }

  if (isAudio(mediaType)) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 bg-zinc-900/60 rounded-xl px-3 py-2">
          <span className="text-lg">🎵</span>
          <audio src={mediaUrl} controls className="h-8 flex-1 min-w-[180px]" preload="metadata" />
        </div>
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
      </div>
    );
  }

  if (isPdf(mediaType)) {
    return (
      <div className="flex flex-col gap-1.5">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 bg-zinc-900/60 rounded-xl px-3 py-2.5 hover:bg-zinc-900 transition-colors group"
        >
          <span className="text-2xl">📄</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100 group-hover:text-violet-300 transition-colors">
              Documento PDF
            </p>
            <p className="text-[10px] text-zinc-500">Toca para abrir</p>
          </div>
          <span className="ml-auto text-zinc-500 group-hover:text-zinc-300">↗</span>
        </a>
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
      </div>
    );
  }

  // Archivo genérico
  return (
    <div className="flex flex-col gap-1.5">
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 bg-zinc-900/60 rounded-xl px-3 py-2.5 hover:bg-zinc-900 transition-colors group"
      >
        <span className="text-2xl">📎</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 group-hover:text-violet-300 transition-colors">
            Archivo adjunto
          </p>
          <p className="text-[10px] text-zinc-500 truncate">{mediaType}</p>
        </div>
        <span className="ml-auto text-zinc-500 group-hover:text-zinc-300">↓</span>
      </a>
      {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
    </div>
  );
}
