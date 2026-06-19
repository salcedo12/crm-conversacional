import { formatMessageTime } from '@/shared/utils/date';
import { MediaMessage }      from './MediaMessage';
import { isWebp }            from '../services/media.service';
import type { Message }      from '../types';

interface MessageBubbleProps {
  message: Message;
}

const senderConfig = {
  lead: {
    label:  'Lead',
    bubble: 'bg-zinc-700 text-zinc-100',
  },
  ai: {
    label:  '🤖 Victoria IA',
    bubble: 'bg-violet-600/20 border border-violet-500/20 text-violet-100',
  },
  advisor: {
    label:  '✋ Asesor',
    bubble: 'bg-blue-600/20 border border-blue-500/20 text-blue-100',
  },
  system: {
    label:  'Sistema',
    bubble: 'bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-xs italic',
  },
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const cfg  = senderConfig[message.senderType];
  const time = formatMessageTime(message.createdAt);

  // Mensajes de sistema — centrados sin burbuja
  if (message.senderType === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-zinc-500 bg-zinc-800/80 border border-zinc-700 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  const isOutbound = message.direction === 'outbound';
  const hasMedia   = !!message.mediaUrl && !!message.mediaType;
  const hasContent = !!message.content?.trim();
  const isSticker  = (
    message.mediaKind === 'sticker' ||
    (isWebp(message.mediaType) && !message.content?.trim())
  );
  const bubbleClass = isSticker
    ? 'p-0 bg-transparent border-0 shadow-none'
    : `rounded-2xl px-3 py-2.5 text-sm ${cfg.bubble} ${hasMedia ? 'overflow-hidden' : 'leading-relaxed whitespace-pre-wrap'}`;

  return (
    <div className={`flex flex-col gap-0.5 ${isSticker ? 'max-w-[160px]' : 'max-w-[75%]'} ${isOutbound ? 'self-end items-end' : 'self-start items-start'}`}>
      {/* Etiqueta del remitente */}
      <span className={`text-[10px] text-zinc-500 px-1 ${isOutbound ? 'text-right' : 'text-left'}`}>
        {cfg.label}
      </span>

      {/* Burbuja */}
      <div className={bubbleClass}>
        {hasMedia ? (
          <MediaMessage
            mediaUrl={message.mediaUrl!}
            mediaType={message.mediaType!}
            content={message.content || undefined}
            isSticker={isSticker}
          />
        ) : isSticker ? (
          <span className="block rounded-xl border border-zinc-700/60 bg-zinc-800/40 px-3 py-2 text-[11px] text-zinc-500">
            Sticker no disponible
          </span>
        ) : hasContent ? (
          message.content
        ) : (
          <span className="sr-only">Mensaje sin contenido</span>
        )}
      </div>

      {/* Hora */}
      {time && (
        <span className={`text-[10px] text-zinc-600 px-1 ${isOutbound ? 'text-right' : 'text-left'}`}>
          {time}
        </span>
      )}
    </div>
  );
}
