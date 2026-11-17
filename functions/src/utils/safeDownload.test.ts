import { describe, it, expect, afterEach } from 'vitest';
import { assertSafePublicUrl, ycloudAuthHeaders, isYcloudHost } from './safeDownload';

describe('safeDownload (R11)', () => {
  afterEach(() => { delete process.env.FUNCTIONS_EMULATOR; });

  it.each([
    'http://example.com/a.ogg',                       // sin TLS
    'https://127.0.0.1/a',                            // loopback
    'https://10.0.0.5/a',                             // red privada
    'https://172.20.1.1/a',
    'https://192.168.1.10/a',
    'https://169.254.169.254/computeMetadata/v1/',    // metadata de Google
    'https://[::1]/a',
    'https://[::ffff:127.0.0.1]/a',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://localhost/a',
    'https://user:pass@example.com/a',
    'file:///etc/passwd',
  ])('bloquea %s', async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow(/bloqueada/);
  });

  it('permite una IP pública', async () => {
    await expect(assertSafePublicUrl('https://8.8.8.8/a')).resolves.toBeInstanceOf(URL);
  });

  it('en el emulador permite el Storage local', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    await expect(assertSafePublicUrl('http://127.0.0.1:9199/v0/b/x/o/a.ogg')).resolves.toBeInstanceOf(URL);
  });

  it('la llave de YCloud solo va a dominios de YCloud', () => {
    const h = ycloudAuthHeaders('KEY');
    expect(h(new URL('https://api.ycloud.com/v2/media/1'))).toEqual({ 'X-API-Key': 'KEY' });
    expect(h(new URL('https://cdn.ycloud.com/x'))).toEqual({ 'X-API-Key': 'KEY' });
    expect(h(new URL('https://evil.com/x'))).toEqual({});
    expect(h(new URL('https://ycloud.com.evil.com/x'))).toEqual({});
    expect(h(new URL('https://notycloud.com/x'))).toEqual({});
    expect(isYcloudHost('API.YCLOUD.COM')).toBe(true);
  });
});
