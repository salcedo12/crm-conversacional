import type { Timestamp } from 'firebase/firestore';

/** Formatea timestamp para mostrar hora/fecha en el chat de forma ultra segura */
export function formatMessageTime(ts: unknown): string {
  if (!ts) return '';
  let date: Date | null = null;
  if (ts instanceof Date) {
    date = ts;
  } else if (ts && typeof (ts as any).toDate === 'function') {
    date = (ts as any).toDate();
  } else if (ts && typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    const s = (ts as any)._seconds ?? (ts as any).seconds;
    date = new Date(s * 1000);
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || isNaN(date.getTime())) return '';

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

/** Fecha y hora completa para bitácoras y fichas: Día Mes Año, Hora:Minuto am/pm */
export function formatFullDateTime(ts: unknown): string {
  if (!ts) return '';
  let date: Date | null = null;
  if (ts instanceof Date) {
    date = ts;
  } else if (ts && typeof (ts as any).toDate === 'function') {
    date = (ts as any).toDate();
  } else if (ts && typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    const s = (ts as any)._seconds ?? (ts as any).seconds;
    date = new Date(s * 1000);
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    let clean: any = typeof ts === 'string' ? ts.trim() : ts;
    if (typeof clean === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(clean)) {
      clean = clean.replace(' ', 'T');
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || isNaN(date.getTime())) return String(ts || '');

  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
  hours = hours % 12 || 12;
  const hourStr = String(hours).padStart(2, '0');

  return `${day} ${month} ${year}, ${hourStr}:${minutes} ${ampm}`;
}

/** Formato amigable relativo o exacto: "Hoy, 3:15 p. m.", "Ayer, 4:20 p. m.", "Mañana, 9:00 a. m." */
export function formatFriendlyDate(ts: unknown): string {
  if (!ts) return '';
  let date: Date | null = null;
  if (ts instanceof Date) {
    date = ts;
  } else if (ts && typeof (ts as any).toDate === 'function') {
    date = (ts as any).toDate();
  } else if (ts && typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    const s = (ts as any)._seconds ?? (ts as any).seconds;
    date = new Date(s * 1000);
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    let clean: any = typeof ts === 'string' ? ts.trim() : ts;
    if (typeof clean === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(clean)) {
      clean = clean.replace(' ', 'T');
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || isNaN(date.getTime())) return String(ts || '');

  const now = new Date();
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
  hours = hours % 12 || 12;
  const hourStr = String(hours).padStart(2, '0');
  const timeStr = `${hourStr}:${minutes} ${ampm}`;

  if (isSameDay(date, now)) {
    return `Hoy, ${timeStr}`;
  }
  if (isSameDay(date, yesterday)) {
    return `Ayer, ${timeStr}`;
  }
  if (isSameDay(date, tomorrow)) {
    return `Mañana, ${timeStr}`;
  }

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}, ${timeStr}`;
}
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
