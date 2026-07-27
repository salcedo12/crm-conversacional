import type { Lead } from '../types';

export function isLeadUnreadForUser(lead: Lead, uid: string | null | undefined): boolean {
  if (!uid || !lead.lastInboundAt) return false;
  const lastReadAt = lead.readBy?.[uid];
  return !lastReadAt || lead.lastInboundAt.toMillis() > lastReadAt.toMillis();
}

export function countUnreadLeads(leads: Lead[], uid: string | null | undefined): number {
  return leads.filter((lead) => isLeadUnreadForUser(lead, uid)).length;
}
