import crypto from 'crypto';
import type { SignatureStatus } from '../../modules/deals/deals.types';

export type DocuBlockSignatureMatch = 'ts_dot_body' | 'ts_colon_body' | 'raw_body';

export interface DocuBlockWebhookEvent {
  id:             string;
  type:           string;
  version:        number;
  occurredAt:     string;
  organizationId: string;
  documentId:     string;
  documentCode:   string;
  documentName:   string;
  relatedInfo:    Record<string, string>;
  signerEmail:    string;
  signingUrl:     string;
}

/**
 * Verifica la cabecera HMAC-SHA256 de DocuBlock Webhooks v2:
 *   X-Docublock-Timestamp: 1794929349721
 *   X-Docublock-Signature: v2=<hex64>
 */
export function verifyDocuBlockWebhookSignature(opts: {
  rawBody:          Buffer | string;
  timestampHeader?: string | null;
  signatureHeader?: string | null;
  secret:           string;
}): { valid: boolean; matchedFormat?: DocuBlockSignatureMatch } {
  const sigRaw = String(opts.signatureHeader ?? '').trim();
  const secret = String(opts.secret ?? '').trim();
  if (!sigRaw || !secret) return { valid: false };

  // Extrae el hex después de "v2=" / "sha256=" o tal cual si viene sin prefijo.
  const match = /^(?:v2|sha256)=([0-9a-f]{64})$/i.exec(sigRaw) || /^([0-9a-f]{64})$/i.exec(sigRaw);
  if (!match) return { valid: false };
  const providedBuf = Buffer.from(match[1].toLowerCase(), 'utf8');

  const bodyStr = Buffer.isBuffer(opts.rawBody) ? opts.rawBody.toString('utf8') : String(opts.rawBody ?? '');
  const ts = String(opts.timestampHeader ?? '').trim();

  const candidates: Array<{ format: DocuBlockSignatureMatch; payload: string }> = [];
  if (ts) {
    candidates.push({ format: 'ts_dot_body', payload: `${ts}.${bodyStr}` });
    candidates.push({ format: 'ts_colon_body', payload: `${ts}:${bodyStr}` });
  }
  candidates.push({ format: 'raw_body', payload: bodyStr });

  for (const candidate of candidates) {
    const expected = crypto.createHmac('sha256', secret).update(candidate.payload, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: true, matchedFormat: candidate.format };
    }
  }
  return { valid: false };
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function stringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = String(val);
    }
  }
  return out;
}

export function parseDocuBlockWebhookEvent(body: unknown): DocuBlockWebhookEvent | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : {}) as Record<string, unknown>;
  const doc = (data.document && typeof data.document === 'object' ? data.document : {}) as Record<string, unknown>;
  const signer = (data.signer && typeof data.signer === 'object' ? data.signer : {}) as Record<string, unknown>;

  const type = asStr(root.type);
  const documentId = asStr(doc.id) || asStr(doc._id);
  if (!type || !documentId) return null;

  return {
    id: asStr(root.id),
    type,
    version: Number(root.version ?? 2) || 2,
    occurredAt: asStr(root.occurredAt),
    organizationId: asStr(root.organizationId),
    documentId,
    documentCode: asStr(doc.code),
    documentName: asStr(doc.name),
    relatedInfo: stringRecord(doc.relatedInfo),
    signerEmail: asStr(signer.email),
    signingUrl: asStr(data.signingUrl),
  };
}

export type WebhookEventAction =
  | { kind: 'refresh' }
  | { kind: 'set_status'; status: Extract<SignatureStatus, 'rechazado' | 'anulado' | 'vencido'> }
  | { kind: 'ignore' };

export function classifyDocuBlockWebhookEvent(type: string): WebhookEventAction {
  switch (type) {
    case 'signer.signed':
    case 'document.completed':
    case 'document.anchored':
      return { kind: 'refresh' };
    case 'signer.rejected':
      return { kind: 'set_status', status: 'rechazado' };
    case 'document.cancelled':
      return { kind: 'set_status', status: 'anulado' };
    case 'document.expired':
      return { kind: 'set_status', status: 'vencido' };
    default:
      return { kind: 'ignore' };
  }
}
