import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('../modules/monitoring/errorAlertQueue', () => ({ enqueueErrorAlert: vi.fn() }));

import { sanitize } from './logger';

describe('logger.sanitize (R13)', () => {
  it('tapa claves sensibles sin importar mayúsculas ni anidación', () => {
    const out = sanitize({
      apiKey: 'K1',
      'X-API-Key': 'K2',
      nested: { deep: { access_token: 'T', password: 'P', ok: 'visible' } },
      list: [{ clientSecret: 'S' }],
      leadId: 'lead_1',
    }) as any;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out['X-API-Key']).toBe('[REDACTED]');
    expect(out.nested.deep.access_token).toBe('[REDACTED]');
    expect(out.nested.deep.password).toBe('[REDACTED]');
    expect(out.nested.deep.ok).toBe('visible');
    expect(out.list[0].clientSecret).toBe('[REDACTED]');
    expect(out.leadId).toBe('lead_1');
  });

  it('tapa secretos dentro de URLs', () => {
    const out = sanitize({
      url: 'https://x.cloudfunctions.net/quick?companyId=a&id=b&token=abc123',
      media: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=uuid-1',
    }) as any;
    expect(out.url).toBe('https://x.cloudfunctions.net/quick?companyId=a&id=b&token=[REDACTED]');
    expect(out.media).toContain('alt=media&token=[REDACTED]');
  });

  it('conserva conteos de consumo de IA y soporta Error y ciclos', () => {
    const cyc: any = { a: 1 }; cyc.self = cyc;
    const out = sanitize({ completionTokens: 512, totalTokens: 900, err: new Error('falló ?secret=zz'), cyc }) as any;
    expect(out.completionTokens).toBe(512);
    expect(out.totalTokens).toBe(900);
    expect(out.err).toEqual({ name: 'Error', message: 'falló ?secret=[REDACTED]' });
    expect(out.cyc.self).toBe('[Circular]');
  });
});
