/** Campos que nunca deben aparecer en logs */
const SENSITIVE_KEYS = ['authToken', 'apiKey', 'token', 'password', 'secret', 'authorization'];

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s)) ? '[REDACTED]' : v,
    ])
  );
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry = JSON.stringify({
    severity: level.toUpperCase(),
    message,
    ...(context ? { context: sanitize(context) } : {}),
    timestamp: new Date().toISOString(),
  });

  if (level === 'error') console.error(entry);
  else if (level === 'warn')  console.warn(entry);
  else console.log(entry);
}

export const logger = {
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
};
