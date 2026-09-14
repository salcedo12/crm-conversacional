import type { Timestamp } from '../types';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWindowOpen(lastInboundAt?: Timestamp | null): boolean {
  return !!lastInboundAt && Date.now() - lastInboundAt.toMillis() < WINDOW_MS;
}

export function windowTimeLeft(lastInboundAt?: Timestamp | null): string {
  if (!lastInboundAt) return '';
  const remaining = WINDOW_MS - (Date.now() - lastInboundAt.toMillis());
  if (remaining <= 0) return 'Ventana cerrada';
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m restantes` : `${minutes}m restantes`;
}

export function windowClosedAgo(lastInboundAt?: Timestamp | null): string {
  if (!lastInboundAt) return 'Sin mensajes previos';
  const elapsed = Date.now() - lastInboundAt.toMillis() - WINDOW_MS;
  if (elapsed <= 0) return '';
  const hours = Math.floor(elapsed / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Cerrada hace ${days} dia${days > 1 ? 's' : ''}`;
  if (hours > 0) return `Cerrada hace ${hours}h`;
  return 'Recien cerrada';
}
