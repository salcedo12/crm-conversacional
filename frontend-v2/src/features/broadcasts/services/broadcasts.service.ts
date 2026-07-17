import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

export interface BroadcastAudience {
  type:   'all' | 'status' | 'tag' | 'list';
  value?: string;
}

export interface BroadcastRecord {
  id:           string;
  templateName: string;
  audience:     BroadcastAudience;
  total:        number;
  sent:         number;
  delivered?:   number;
  read?:        number;
  undelivered?: number;
  failed:       number;
  status:       'queued' | 'processing' | 'sending' | 'completed' | 'failed';
  createdAt:    number | null;
  completedAt?: number | null;
  errors?:      { leadId: string; phone: string; error: string }[];
}

export interface SendBroadcastResult {
  broadcastId: string;
  total:       number;
  sent:        number;
  failed:      number;
  truncated:   boolean;
  queued?:      boolean;
}

type SerializedTimestamp = {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

type BroadcastResponse = Omit<BroadcastRecord, 'createdAt' | 'completedAt'> & {
  createdAt?: unknown;
  completedAt?: unknown;
};

function timestampToMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? null : millis;
  }

  if (typeof value !== 'object') return null;

  const timestamp = value as SerializedTimestamp;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();

  const seconds = timestamp.seconds ?? timestamp._seconds;
  const nanoseconds = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
  return typeof seconds === 'number'
    ? (seconds * 1000) + Math.floor(nanoseconds / 1_000_000)
    : null;
}

const _list = httpsCallable<{ companyId: string }, { broadcasts: BroadcastResponse[] }>(
  functions, 'listBroadcasts'
);
const _count = httpsCallable<
  { companyId: string; audience: BroadcastAudience },
  { total: number }
>(functions, 'countBroadcastAudience');
const _send = httpsCallable<
  { companyId: string; templateId: string; audience: BroadcastAudience; variables: Record<string, string> },
  SendBroadcastResult
>(functions, 'sendBroadcast');

export async function listBroadcasts(companyId: string): Promise<BroadcastRecord[]> {
  const r = await _list({ companyId });
  return r.data.broadcasts.map((broadcast) => ({
    ...broadcast,
    createdAt: timestampToMillis(broadcast.createdAt),
    completedAt: timestampToMillis(broadcast.completedAt),
  }));
}

export async function sendBroadcast(
  companyId:  string,
  templateId: string,
  audience:   BroadcastAudience,
  variables:  Record<string, string>
): Promise<SendBroadcastResult> {
  const r = await _send({ companyId, templateId, audience, variables });
  return r.data;
}

export async function countBroadcastAudience(
  companyId: string,
  audience:  BroadcastAudience
): Promise<number> {
  const r = await _count({ companyId, audience });
  return r.data.total;
}
