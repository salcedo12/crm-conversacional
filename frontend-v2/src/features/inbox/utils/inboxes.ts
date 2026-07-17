import { formatPhone } from '@/shared/utils/formatPhone';
import type { Lead, LeadChannel } from '../types';

/**
 * Nombres amigables de cada número de negocio (inbox).
 * Si un número no está aquí, se muestra el número formateado.
 * Puedes editar/añadir nombres a medida que conectes más números.
 */
const INBOX_NAMES: Record<string, string> = {
  '+573148209662': 'sistemas meraki',
};

/** Etiqueta amigable para un inbox (número de negocio). */
export function inboxLabel(inboxId?: string | null): string {
  if (!inboxId) return 'Sin número';
  return INBOX_NAMES[inboxId] ?? formatPhone(inboxId);
}

/** Lista de inboxes (números) presentes en los leads, ordenados, con su conteo. */
export function collectInboxes(leads: Lead[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (l.inboxId) counts.set(l.inboxId, (counts.get(l.inboxId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ícono + etiqueta del canal de un lead. `null` para WhatsApp (comportamiento
 * por defecto, sin badge) o cuando el canal no está definido (leads antiguos).
 */
export function channelBadge(channel?: LeadChannel): { icon: string; label: string } | null {
  if (channel === 'messenger') return { icon: '💬', label: 'Messenger' };
  if (channel === 'instagram') return { icon: '📷', label: 'Instagram' };
  return null;
}
