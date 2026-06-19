import type { Timestamp } from 'firebase/firestore';

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas en ms

/**
 * Devuelve true si la ventana de conversación de WhatsApp sigue abierta.
 * La ventana abre cuando el LEAD envía un mensaje y dura 24h.
 * @param lastInboundAt Timestamp del último mensaje entrante del lead
 */
export function isWindowOpen(lastInboundAt?: Timestamp | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.toMillis() < WINDOW_MS;
}

/**
 * Devuelve el tiempo restante de la ventana como texto legible.
 * Ej: "18h 32m restantes"
 */
export function windowTimeLeft(lastInboundAt?: Timestamp | null): string {
  if (!lastInboundAt) return '';
  const remaining = WINDOW_MS - (Date.now() - lastInboundAt.toMillis());
  if (remaining <= 0) return 'Ventana cerrada';

  const hours   = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (hours > 0) return `${hours}h ${minutes}m restantes`;
  return `${minutes}m restantes`;
}

/**
 * Devuelve cuánto tiempo pasó desde que se cerró la ventana.
 * Ej: "Cerrada hace 3h"
 */
export function windowClosedAgo(lastInboundAt?: Timestamp | null): string {
  if (!lastInboundAt) return 'Sin mensajes previos';
  const elapsed = Date.now() - lastInboundAt.toMillis() - WINDOW_MS;
  if (elapsed <= 0) return '';

  const hours = Math.floor(elapsed / 3_600_000);
  const days  = Math.floor(hours / 24);

  if (days > 0)  return `Cerrada hace ${days} día${days > 1 ? 's' : ''}`;
  if (hours > 0) return `Cerrada hace ${hours}h`;
  return 'Recién cerrada';
}
