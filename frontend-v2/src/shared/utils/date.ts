import type { Timestamp } from 'firebase/firestore';

/** Formatea timestamp para mostrar hora/fecha en el chat */
export function formatMessageTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const date = ts.toDate();
  const now  = new Date();
  const diff = now.getTime() - date.getTime();

  // Hoy → solo hora
  if (diff < 86_400_000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  // Esta semana → día + hora
  if (diff < 7 * 86_400_000) {
    return date.toLocaleDateString('es-CO', { weekday: 'short' }) +
           ' ' +
           date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  // Más antiguo → fecha completa
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

/** Fecha exacta para cada mensaje del chat: dia/mes/año hora:minuto:segundo. */
export function formatChatMessageDateTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/** Agrupa mensajes por fecha para mostrar separadores */
export function getDateLabel(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const date = ts.toDate();
  const now  = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 86_400_000 && date.getDate() === now.getDate()) return 'Hoy';
  if (diff < 2 * 86_400_000) return 'Ayer';
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}
