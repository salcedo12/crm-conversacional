import type { Timestamp } from '../types';

export function initials(name?: string) {
  return (name || 'Lead').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function timestampMs(value?: Timestamp | null) {
  return value?.toMillis?.() ?? 0;
}

export function shortTime(value?: Timestamp | null) {
  const ms = timestampMs(value);
  if (!ms) return '';
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(date);
}

export function isUnread(lastInbound?: Timestamp, readAt?: Timestamp) {
  return timestampMs(lastInbound) > timestampMs(readAt);
}
