import { useState, type ReactNode } from 'react';
import { formatChatMessageDateTime } from '@/shared/utils/date';
import { formatPhone }       from '@/shared/utils/formatPhone';
import { MediaMessage }      from './MediaMessage';
import { isWebp }            from '../services/media.service';
import { inboxLabel }        from '../utils/inboxes';
import type { Message }      from '../types';

// Mensajes anormalmente largos (ej. transcripciones pegadas por error) se
// truncan visualmente para que una sola burbuja no rompa el scroll del chat.
const LONG_MESSAGE_THRESHOLD = 600;

// Emojis rápidos para reaccionar a un mensaje del lead (como en WhatsApp).
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Convierte las URLs del texto en enlaces clickeables (ubicaciones, Meet, etc.). */
function linkify(text?: string): ReactNode {
  if (!text) return text;
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

interface MessageBubbleProps {
  message: Message;
  /** Nombre del asesor que envió el mensaje desde el CRM (resuelto desde advisorId). */
  advisorName?: string;
  companyLineLabel?: string;
  companyLinePhone?: string | null;
  advisorWhatsappPhone?: string | null;
  /** Reacciona con un emoji a este mensaje del lead (emoji vacío = quitar). */
  onReact?: (message: Message, emoji: string) => void | Promise<void>;
}

function metaString(message: Message, key: string): string | undefined {
  const value = message.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function routeLabel(
  message: Message,
  companyLineLabel = 'Ventas',
  companyLinePhone?: string | null,
  advisorWhatsappPhone?: string | null
): string {
  const deliveryChannel = metaString(message, 'deliveryChannel');
  const origin = metaString(message, 'origin');
  const businessPhone = metaString(message, 'businessPhone') ?? companyLinePhone ?? undefined;
  const advisorPhone = metaString(message, 'advisorPhone') ?? advisorWhatsappPhone ?? undefined;
  const isAdvisorWhatsapp = deliveryChannel === 'advisor_whatsapp' || origin?.startsWith('advisor_whatsapp');

  if (isAdvisorWhatsapp) {
    const phone = advisorPhone ? ` ${formatPhone(advisorPhone)}` : '';
    return message.direction === 'outbound'
      ? `Enviado desde: Mi WhatsApp${phone}`
      : `Recibido en: Mi WhatsApp${phone}`;
  }

  // Línea de la empresa. Preferimos el número del propio mensaje (businessPhone);
  // si no hay línea conocida (lead sin inboxId), mostramos "Línea empresa" en vez
  // del confuso "Sin número" — así queda claro que NO salió de la línea personal.
  const phoneFmt = businessPhone ? formatPhone(businessPhone) : '';
  const named = businessPhone ? inboxLabel(businessPhone) : companyLineLabel;
  const isNamed = !!named && named !== 'Sin número' && named !== phoneFmt;
  const label = isNamed ? named : 'Línea empresa';
  const suffix = phoneFmt ? ` ${phoneFmt}` : '';
  return message.direction === 'outbound'
    ? `Enviado desde: ${label}${suffix}`
    : `Recibido en: ${label}${suffix}`;
}

// Estado de entrega mostrado en mensajes SALIENTES (estilo WhatsApp, pero con
// texto explícito porque las palomitas solas se prestan a confusión).
const statusConfig: Record<string, { label: string; icon: string; className: string }> = {
  pending:   { label: 'Enviando…',     icon: '🕓', className: 'text-zinc-500' },
  sent:      { label: 'Enviado',       icon: '✓',  className: 'text-zinc-500' },
  delivered: { label: 'Entregado',     icon: '✓✓', className: 'text-zinc-400' },
  read:      { label: 'Leído',         icon: '✓✓', className: 'text-sky-400' },
  failed:    { label: 'No entregado',  icon: '⚠',  className: 'text-red-400 font-medium' },
};

/**
 * Traduce el código de error de Meta/WhatsApp a un motivo claro para el asesor.
 * Si no reconocemos el código, se muestra el mensaje crudo del proveedor.
 */
function friendlyFailureReason(code?: string, rawReason?: string): string | undefined {
  switch (code) {
    case '131049':
      return 'Meta bloqueó el envío por su límite de mensajes de marketing a este contacto. Reintentar no ayuda: usa una plantilla de UTILITY o espera a que el lead responda.';
    case '131047':
      return 'Pasaron más de 24 h sin respuesta del lead. Solo se pueden enviar plantillas pre-aprobadas.';
    case '131026':
      return 'El mensaje no se pudo entregar (el número puede no tener WhatsApp o no acepta mensajes de empresas).';
    case '132000':
    case '132001':
      return 'La plantilla no coincide con la aprobada por Meta (número o formato de variables). Revisa la plantilla.';
    case '470':
    case '131050':
      return 'El contacto no permite recibir mensajes de marketing de esta empresa.';
    default:
      return rawReason || undefined;
  }
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

export function MessageBubble({
  message,
  advisorName,
  companyLineLabel,
  companyLinePhone,
  advisorWhatsappPhone,
  onReact,
}: MessageBubbleProps) {
  const cfg  = senderConfig[message.senderType];
  const time = formatChatMessageDateTime(message.createdAt);
  const [expanded, setExpanded]     = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reacting, setReacting]     = useState(false);

  // Solo se puede reaccionar a mensajes ENTRANTES del lead que tengan wamid de WhatsApp.
  const canReact = !!onReact
    && message.senderType === 'lead'
    && message.direction === 'inbound'
    && !!message.twilioMessageSid;

  const handleReact = async (emoji: string) => {
    if (!onReact || reacting) return;
    setPickerOpen(false);
    setReacting(true);
    try {
      // Toggle: si ya tiene ese mismo emoji, se quita (envía emoji vacío).
      await onReact(message, message.reaction === emoji ? '' : emoji);
    } finally {
      setReacting(false);
    }
  };

  // Etiqueta del remitente. Para mensajes de asesor distinguimos:
  //  - enviado desde el CRM (trae advisorId) → nombre del asesor.
  //  - enviado desde la app de WhatsApp (sin advisorId) → "Enviado desde WhatsApp".
  let senderLabel: string = cfg.label;
  if (message.senderType === 'advisor') {
    senderLabel = message.advisorId
      ? `✋ ${advisorName ?? 'Asesor'}`
      : '📱 Enviado desde WhatsApp';
  }

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
  const isLong = (message.content?.length ?? 0) > LONG_MESSAGE_THRESHOLD;
  const displayContent = isLong && !expanded
    ? `${message.content!.slice(0, LONG_MESSAGE_THRESHOLD).trimEnd()}…`
    : message.content;
  const bubbleClass = isSticker
    ? 'p-0 bg-transparent border-0 shadow-none'
    : `rounded-2xl px-3 py-2.5 text-sm ${cfg.bubble} ${hasMedia ? 'overflow-hidden' : 'leading-relaxed whitespace-pre-wrap break-words'}`;
  const route = routeLabel(message, companyLineLabel, companyLinePhone, advisorWhatsappPhone);

  return (
    <div className={`flex flex-col gap-0.5 ${isSticker ? 'max-w-[160px]' : 'max-w-[75%]'} ${isOutbound ? 'self-end items-end' : 'self-start items-start'}`}>
      {/* Etiqueta del remitente */}
      <span className={`text-[10px] text-zinc-500 px-1 ${isOutbound ? 'text-right' : 'text-left'}`}>
        {senderLabel}
      </span>

      {/* Burbuja + reacción */}
      <div className={`group flex items-end gap-1 ${isOutbound ? 'flex-row-reverse' : 'flex-row'}`}>
       <div className="relative">
        <div className={bubbleClass}>
        {hasMedia ? (
          <MediaMessage
            mediaUrl={message.mediaUrl!}
            mediaType={message.mediaType!}
            fileName={message.fileName}
            content={message.content || undefined}
            isSticker={isSticker}
          />
        ) : isSticker ? (
          <span className="block rounded-xl border border-zinc-700/60 bg-zinc-800/40 px-3 py-2 text-[11px] text-zinc-500">
            Sticker no disponible
          </span>
        ) : hasContent ? (
          <>
            {linkify(displayContent)}
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="mt-1 block text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                {expanded ? 'Ver menos' : 'Ver mensaje completo'}
              </button>
            )}
          </>
        ) : message.mediaPending ? (
          // Media subiéndose en segundo plano.
          <span className="block text-xs italic text-zinc-400">
            {message.mediaType?.startsWith('image')    ? '📷 Imagen'
              : message.mediaType?.startsWith('video')    ? '🎥 Video'
              : message.mediaType?.startsWith('audio')    ? '🎵 Audio'
              : message.mediaType?.includes('pdf')        ? '📄 Documento'
              : '📎 Archivo'} · cargando…
          </span>
        ) : message.mediaType ? (
          // Media sin URL (no se pudo cargar/re-alojar) — placeholder en vez de burbuja vacía.
          <span className="block text-xs italic text-zinc-400">
            {message.mediaType.startsWith('image')    ? '📷 Imagen no disponible'
              : message.mediaType.startsWith('video')    ? '🎥 Video no disponible'
              : message.mediaType.startsWith('audio')    ? '🎵 Audio no disponible'
              : message.mediaType.includes('pdf')        ? '📄 Documento no disponible'
              : '📎 Archivo no disponible'}
          </span>
        ) : (
          <span className="sr-only">Mensaje sin contenido</span>
        )}
        </div>
         {/* Reacción del asesor, pegada a la esquina de la burbuja */}
         {message.reaction && (
           <span className="absolute -bottom-2 -right-1 rounded-full border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs leading-none shadow">
             {message.reaction}
           </span>
         )}
       </div>

        {/* Disparador de reacción — aparece al pasar el mouse sobre el mensaje del lead */}
        {canReact && (
          <div className="relative shrink-0 self-center">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={reacting}
              aria-label="Reaccionar"
              className="px-0.5 text-base leading-none text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 disabled:opacity-40 group-hover:opacity-100"
            >
              🙂
            </button>
            {pickerOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-1 shadow-lg">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => handleReact(e)}
                    className={`text-lg transition-transform hover:scale-125 ${message.reaction === e ? 'scale-110' : ''}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hora + estado de entrega (el estado solo en salientes) */}
      {(time || isOutbound) && (
        <span className={`flex items-center gap-1 text-[10px] text-zinc-600 px-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
          {time && <span>{time}</span>}
          {isOutbound && (() => {
            const st = statusConfig[message.status] ?? statusConfig.sent;
            const reason = message.status === 'failed'
              ? friendlyFailureReason(message.failureCode, message.failureReason)
              : undefined;
            return (
              <>
                {time && <span className="text-zinc-700">·</span>}
                <span
                  className={`inline-flex items-center gap-0.5 ${st.className}`}
                  title={reason}
                >
                  <span>{st.icon}</span>
                  <span>{st.label}</span>
                </span>
              </>
            );
          })()}
        </span>
      )}
      {/* Motivo del fallo de entrega (solo salientes fallidos). */}
      {isOutbound && message.status === 'failed'
        && friendlyFailureReason(message.failureCode, message.failureReason) && (
        <span className="max-w-full rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] leading-snug text-red-300 text-right">
          {friendlyFailureReason(message.failureCode, message.failureReason)}
        </span>
      )}
      <span className={`max-w-full rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[10px] text-zinc-500 ${isOutbound ? 'text-right' : 'text-left'}`}>
        {route}
      </span>
    </div>
  );
}
