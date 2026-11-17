import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyDocuBlockWebhookEvent,
  parseDocuBlockWebhookEvent,
  verifyDocuBlockWebhookSignature,
} from './docublockWebhook.logic';

describe('docublockWebhook.logic', () => {
  const secret = 'test_docublock_secret_123';
  const rawBody = JSON.stringify({
    id: '52298200-cacf-4dfd-a6c9-416c15e57a56',
    type: 'document.completed',
    version: 2,
    occurredAt: '2026-11-17T15:29:09.721Z',
    organizationId: '68276a30ec9007c33d6f9b97',
    data: {
      document: {
        id: '6afc7c6455b70b7404acfd04',
        code: 'M8-MPS-1112',
        name: 'PROMESA',
        relatedInfo: { crmCompanyId: 'grupo_meraki_real', crmDealId: 'deal123' },
      },
      signer: { email: 'comprador@correo.com' },
      signingUrl: 'https://app.docublock.co/firmar?token=abc',
    },
  });

  it('valida HMAC-SHA256 con formato v2 y timestamp.rawBody', () => {
    const ts = '1794929349721';
    const digest = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
    const res = verifyDocuBlockWebhookSignature({
      rawBody,
      timestampHeader: ts,
      signatureHeader: `v2=${digest}`,
      secret,
    });
    expect(res).toEqual({ valid: true, matchedFormat: 'ts_dot_body' });
  });

  it('valida HMAC-SHA256 sobre rawBody sin timestamp cuando llega en v2=', () => {
    const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const res = verifyDocuBlockWebhookSignature({
      rawBody,
      timestampHeader: '1794929349721',
      signatureHeader: `v2=${digest}`,
      secret,
    });
    expect(res).toEqual({ valid: true, matchedFormat: 'raw_body' });
  });

  it('rechaza firmas inválidas o secretos incorrectos', () => {
    const bad = verifyDocuBlockWebhookSignature({
      rawBody,
      timestampHeader: '1794929349721',
      signatureHeader: 'v2=' + '0'.repeat(64),
      secret,
    });
    expect(bad).toEqual({ valid: false });
  });

  it('extrae el evento y relatedInfo de Webhooks v2', () => {
    const parsed = parseDocuBlockWebhookEvent(JSON.parse(rawBody));
    expect(parsed).toMatchObject({
      id: '52298200-cacf-4dfd-a6c9-416c15e57a56',
      type: 'document.completed',
      organizationId: '68276a30ec9007c33d6f9b97',
      documentId: '6afc7c6455b70b7404acfd04',
      relatedInfo: { crmCompanyId: 'grupo_meraki_real', crmDealId: 'deal123' },
      signerEmail: 'comprador@correo.com',
    });
  });

  it('clasifica eventos de firma en refresh / estados negativos / ignore', () => {
    expect(classifyDocuBlockWebhookEvent('signer.signed')).toEqual({ kind: 'refresh' });
    expect(classifyDocuBlockWebhookEvent('document.completed')).toEqual({ kind: 'refresh' });
    expect(classifyDocuBlockWebhookEvent('document.anchored')).toEqual({ kind: 'refresh' });
    expect(classifyDocuBlockWebhookEvent('signer.rejected')).toEqual({ kind: 'set_status', status: 'rechazado' });
    expect(classifyDocuBlockWebhookEvent('document.cancelled')).toEqual({ kind: 'set_status', status: 'anulado' });
    expect(classifyDocuBlockWebhookEvent('document.expired')).toEqual({ kind: 'set_status', status: 'vencido' });
    expect(classifyDocuBlockWebhookEvent('document.sent')).toEqual({ kind: 'ignore' });
  });
});
