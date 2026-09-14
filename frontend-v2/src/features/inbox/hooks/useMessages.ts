import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limitToLast,
  onSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Message } from '../types';

const MESSAGES_PAGE = 50;
const UNSUPPORTED_LABEL = '⚠️ El cliente envió un mensaje no compatible. Pídele que lo reenvíe como texto o archivo.';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function inferMediaType(data: Record<string, unknown>, mediaUrl?: string): string | undefined {
  const mediaKind = asString(data.mediaKind);
  if (mediaKind === 'image' || mediaKind === 'sticker') return 'image/jpeg';
  if (mediaKind === 'video') return 'video/mp4';
  if (mediaKind === 'audio') return 'audio/mpeg';
  if (mediaKind === 'document') return 'application/pdf';

  const pathname = mediaUrl ? decodeURIComponent(mediaUrl.split('?')[0]).toLowerCase() : '';
  if (/\.(jpe?g|png|gif|webp)$/.test(pathname)) return pathname.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  if (/\.(mp4|3gp|mov)$/.test(pathname)) return 'video/mp4';
  if (/\.(mp3|mpeg|ogg|oga|m4a|aac|webm)$/.test(pathname)) return 'audio/mpeg';
  if (/\.pdf$/.test(pathname)) return 'application/pdf';
  return undefined;
}

function normalizeMessage(d: QueryDocumentSnapshot): Message {
  const data = d.data() as Record<string, unknown>;
  const mediaUrl = asString(data.mediaUrl)
    ?? asString(data.mediaURL)
    ?? asString(data.media_url)
    ?? asString(data.downloadUrl)
    ?? asString(data.downloadURL)
    ?? asString(data.url);
  const mediaType = asString(data.mediaType)
    ?? asString(data.mimeType)
    ?? asString(data.mime_type)
    ?? asString(data.contentType)
    ?? inferMediaType(data, mediaUrl);
  const content = data.content === '[unsupported]'
    ? UNSUPPORTED_LABEL
    : data.content;

  return {
    id: d.id,
    ...data,
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaType ? { mediaType } : {}),
    content: typeof content === 'string' ? content : '',
  } as Message;
}

/**
 * Escucha en tiempo real los mensajes de un lead, de a 50 en 50.
 * Ruta: companies/{companyId}/leads/{leadId}/messages
 *
 * Optimizaciones / comportamiento:
 * - limitToLast(limit): arranca con los 50 más recientes; `loadMore()` sube el
 *   límite de a 50 para traer mensajes más antiguos (solo cuando el asesor lo pide).
 * - `hasMore` indica si probablemente quedan mensajes más viejos por cargar.
 * - El listener se cancela automáticamente al cambiar de lead y el límite se reinicia.
 */
export function useMessages(companyId: string | null, leadId: string | null) {
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [limit,       setLimit]       = useState(MESSAGES_PAGE);
  const prevLeadId = useRef<string | null>(null);

  const loadMore = useCallback(() => {
    setLimit((n) => n + MESSAGES_PAGE);
  }, []);

  useEffect(() => {
    if (!companyId || !leadId) {
      setMessages([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      prevLeadId.current = leadId;
      return;
    }

    const isNewLead = prevLeadId.current !== leadId;

    // Al cambiar de lead, reiniciar la ventana a 50 antes de suscribirse.
    // El cambio de `limit` vuelve a disparar este efecto con limit === MESSAGES_PAGE.
    if (isNewLead && limit !== MESSAGES_PAGE) {
      setLimit(MESSAGES_PAGE);
      return;
    }

    if (isNewLead) {
      setMessages([]);
      setHasMore(false);
      prevLeadId.current = leadId;
    }

    // Carga inicial → spinner de toda la conversación.
    // Crecer la ventana → spinner del botón "cargar más".
    if (limit === MESSAGES_PAGE) setLoading(true);
    else setLoadingMore(true);

    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'messages'),
      orderBy('createdAt', 'asc'),
      limitToLast(limit)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map(normalizeMessage));
        // Si llenamos el límite, es probable que haya mensajes más antiguos.
        setHasMore(snap.docs.length >= limit);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        console.error('[useMessages]', err);
        setLoading(false);
        setLoadingMore(false);
      }
    );

    return unsub;
  }, [companyId, leadId, limit]);

  return { messages, loading, loadingMore, hasMore, loadMore };
}
