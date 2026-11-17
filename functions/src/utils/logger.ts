import { reportError } from '../lib/sentry';
import { enqueueErrorAlert } from '../modules/monitoring/errorAlertQueue';

/**
 * Seguridad (R13): campos que nunca deben aparecer en logs, Sentry ni alertas.
 * Se comparan en minúsculas y sin guiones (antes 'apiKey' nunca coincidía
 * porque la clave se pasaba a minúsculas) y se aplica en objetos anidados.
 */
const SENSITIVE_KEYS = [
  'token', 'apikey', 'password', 'passwd', 'secret', 'authorization', 'cookie',
  'privatekey', 'credential', 'signature',
];
const MAX_DEPTH = 6;

/** Tapa secretos que viajan dentro de URLs: ?token=…, &secret=…, &key=… */
const URL_SECRET_RE = /([?&](?:token|access_token|secret|key|api_key|apikey|signature|sig|x-goog-signature)=)[^&\s"'#]+/gi;

function redactString(s: string): string {
  return s.replace(URL_SECRET_RE, '$1[REDACTED]');
}

function isSensitiveKey(k: string): boolean {
  const norm = k.toLowerCase().replace(/[-_\s]/g, '');
  // Conteos de consumo de IA (completionTokens, totalTokens…) no son secretos.
  if (/tokens$/.test(norm) || /^tokens(used|count)$/.test(norm)) return false;
  return SENSITIVE_KEYS.some((s) => norm.includes(s));
}

function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[…]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  // Timestamps, Buffers y otras clases: se dejan como estaban (JSON.stringify decide).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      isSensitiveKey(k) ? '[REDACTED]' : redact(v, depth + 1, seen),
    ])
  );
}

export function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  return redact(obj, 0, new WeakSet()) as Record<string, unknown>;
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  const safeContext = context ? sanitize(context) : undefined;
  message = redactString(message);
  const entry = JSON.stringify({
    severity: level.toUpperCase(),
    message,
    ...(safeContext ? { context: safeContext } : {}),
    timestamp: new Date().toISOString(),
  });

  if (level === 'error') {
    console.error(entry);
    reportError(message, safeContext);       // → Sentry si está configurado
    enqueueErrorAlert(message, safeContext);  // → WhatsApp con IA (dedup + tope)
  } else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

export const logger = {
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
};
