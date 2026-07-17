import type { InboxProvider } from '../leads/leads.types';

/**
 * Normaliza un número de negocio a E.164 simple: `+<dígitos>`.
 * Acepta formatos como "+57 317 6820728", "573176820728", "+573176820728".
 */
export function normalizeBusinessNumber(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = String(raw).replace(/\D/g, '');
  return digits ? `+${digits}` : undefined;
}

/** El CRM envía WhatsApp únicamente por YCloud. */
export function resolveInboxProvider(_lead?: { inboxProvider?: InboxProvider }): InboxProvider {
  return 'ycloud';
}
