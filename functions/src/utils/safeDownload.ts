import { lookup } from 'dns/promises';
import * as net from 'net';

/**
 * Seguridad (R11): descargas iniciadas por el servidor hacia URLs que llegan de
 * clientes o de proveedores. Evita que el backend se use para consultar la red
 * interna (SSRF), que la llave de YCloud viaje a dominios ajenos y que una
 * descarga gigante o colgada agote la función.
 */

const DEFAULT_MAX_BYTES  = 100 * 1024 * 1024; // 100 MB = máximo de documentos en WhatsApp
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_REDIRECTS  = 5;

export function isYcloudHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'ycloud.com' || h.endsWith('.ycloud.com');
}

/** Encabezados con la llave de YCloud SOLO si el destino es de YCloud. */
export function ycloudAuthHeaders(apiKey: string): (url: URL) => Record<string, string> {
  return (url): Record<string, string> => (apiKey && isYcloudHost(url.hostname) ? { 'X-API-Key': apiKey } : {});
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
      (a === 169 && b === 254) ||             // link-local / metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224                                // multicast / reservado
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('::ffff:')) {
    const rest = v6.slice(7);
    if (net.isIPv4(rest)) return isPrivateIp(rest);
    // Forma hexadecimal que produce new URL(): ::ffff:7f00:1 → 127.0.0.1
    const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (m) {
      const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true; // forma rara: bloquear
  }
  return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')
      || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

const isEmulator = (): boolean => process.env.FUNCTIONS_EMULATOR === 'true';

/** Lanza error si la URL no es un destino público permitido. */
export async function assertSafePublicUrl(raw: string | URL): Promise<URL> {
  const url = typeof raw === 'string' ? new URL(raw) : raw;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // En el emulador, Storage local corre en http://127.0.0.1:9199.
  if (isEmulator() && (host === '127.0.0.1' || host === 'localhost')) return url;

  if (url.protocol !== 'https:') throw new Error('Descarga bloqueada: solo se permite HTTPS');
  if (url.username || url.password) throw new Error('Descarga bloqueada: URL con credenciales');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('Descarga bloqueada: destino interno');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('Descarga bloqueada: destino en red privada');
  }
  return url;
}

export interface SafeDownloadOptions {
  /** Encabezados por destino (se recalculan en cada redirección). */
  headersFor?: (url: URL) => Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function safeDownload(raw: string, opts: SafeDownloadOptions = {}): Promise<{ buffer: Buffer; contentType: string | null }> {
  const maxBytes  = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal    = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let redirectsLeft = opts.maxRedirects ?? DEFAULT_REDIRECTS;
  let url = await assertSafePublicUrl(raw);

  for (;;) {
    const res = await fetch(url, { redirect: 'manual', headers: opts.headersFor?.(url) ?? {}, signal });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location || redirectsLeft-- <= 0) throw new Error('Descarga bloqueada: demasiadas redirecciones');
      url = await assertSafePublicUrl(new URL(location, url));
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`media HTTP ${res.status}`);
    }

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`Descarga bloqueada: archivo de ${declared} bytes supera el límite`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error('Descarga bloqueada: archivo supera el límite');
        }
        chunks.push(Buffer.from(value));
      }
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get('content-type') };
  }
}
