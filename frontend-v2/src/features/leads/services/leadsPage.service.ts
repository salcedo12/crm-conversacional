import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { Lead } from '@/features/inbox/types';
import type { LeadsFilters, SortDir, SortField } from '../hooks/useLeadsPage';

export interface LeadsPageCursor {
  id: string;
  value?: unknown;
}

export interface ListLeadsPageInput {
  companyId:  string;
  pageSize:   number;
  cursor?:    LeadsPageCursor | null;
  sortField:  SortField;
  sortDir:    SortDir;
  filters:    LeadsFilters;
}

export interface ListLeadsPageResult {
  leads:      Lead[];
  nextCursor: LeadsPageCursor | null;
  hasMore:    boolean;
}

type SerializedTimestamp = {
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

const _listLeadsPage = httpsCallable<
  Omit<ListLeadsPageInput, 'filters'> & { filters: Record<string, unknown> },
  Omit<ListLeadsPageResult, 'leads'> & { leads: Record<string, unknown>[] }
>(functions, 'listLeadsPage');

function reviveTimestamp(value: unknown): Timestamp {
  if (value instanceof Timestamp) return value;
  if (typeof value === 'number') return Timestamp.fromMillis(value);
  if (value && typeof value === 'object') {
    const ts = value as SerializedTimestamp;
    const seconds = ts.seconds ?? ts._seconds;
    const nanoseconds = ts.nanoseconds ?? ts._nanoseconds ?? 0;
    if (typeof seconds === 'number') return new Timestamp(seconds, nanoseconds);
  }
  return Timestamp.fromMillis(0);
}

function reviveLead(raw: Record<string, unknown>): Lead {
  return {
    ...(raw as unknown as Lead),
    createdAt: reviveTimestamp(raw.createdAt),
    updatedAt: reviveTimestamp(raw.updatedAt),
    lastMessageAt: raw.lastMessageAt ? reviveTimestamp(raw.lastMessageAt) : undefined,
    lastInboundAt: raw.lastInboundAt ? reviveTimestamp(raw.lastInboundAt) : undefined,
  };
}

export async function listLeadsPage(input: ListLeadsPageInput): Promise<ListLeadsPageResult> {
  const r = await _listLeadsPage({
    ...input,
    filters: input.filters as unknown as Record<string, unknown>,
  });
  return {
    leads: r.data.leads.map(reviveLead),
    nextCursor: r.data.nextCursor,
    hasMore: r.data.hasMore,
  };
}
