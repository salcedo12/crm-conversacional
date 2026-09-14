import { formatPhone } from '@/shared/utils/formatPhone';
import type { Lead, LeadChannel, LeadSource } from '../types';

/**
 * Nombres amigables de cada número de negocio (inbox).
 * Si un número no está aquí, se muestra el número formateado.
 * Puedes editar/añadir nombres a medida que conectes más números.
 */
const INBOX_NAMES: Record<string, string> = {
  '+573148209662': 'sistemas meraki',
  '+573176820728': 'Ventas 317',
  '+573232094057': 'WhatsApp Angelica',
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

/** Ícono + etiqueta amigable de la fuente/origen de un lead. */
const SOURCE_BADGES: Record<LeadSource, { icon: string; label: string }> = {
  whatsapp:  { icon: '🟢', label: 'WhatsApp' },
  manual:    { icon: '✍️', label: 'Manual'   },
  web:       { icon: '🌐', label: 'Página web' },
  facebook:  { icon: '📘', label: 'Facebook'  },
  instagram: { icon: '📷', label: 'Instagram' },
  meta_ads:  { icon: '📣', label: 'Anuncio'   },
  advisor_whatsapp: { icon: '👤', label: 'WhatsApp asesor' },
};

/** Etiqueta corta de una fuente para los filtros (sin depender de un lead). */
export function sourceLabel(source: string): string {
  return SOURCE_BADGES[source as LeadSource]?.label ?? source;
}

/**
 * Ícono + etiqueta del origen de un lead (de dónde viene). `null` para leads
 * antiguos sin `source`. Para anuncios de Meta, `detail` trae el titular del
 * anuncio si está disponible (se muestra en el tooltip).
 */
export function sourceBadge(
  lead: Pick<Lead, 'source' | 'sourceMeta' | 'metadata'>,
): { icon: string; label: string; detail?: string } | null {
  if (!lead.source) return null;
  // Lead Ads (formulario) y click-to-WhatsApp son ambos 'meta_ads'; el lead de
  // FORMULARIO trae metaFormId → se muestra como "Formulario", no "Anuncio".
  if (lead.source === 'meta_ads' && lead.metadata?.metaFormId) {
    return {
      icon:   '📋',
      label:  'Formulario',
      detail: lead.metadata.metaFormName || lead.metadata.metaAdName || lead.sourceMeta?.headline,
    };
  }
  const badge = SOURCE_BADGES[lead.source];
  if (!badge) return null;
  const detail = lead.source === 'meta_ads'
    ? (lead.metadata?.metaAdName || lead.sourceMeta?.headline)
    : undefined;
  return { ...badge, detail };
}
