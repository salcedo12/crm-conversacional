import * as Sentry from '@sentry/node';
import { env } from '../config/env';

let initialized = false;
let enabled = false;

/** Inicializa Sentry una sola vez (perezoso). Si no hay SENTRY_DSN, queda no-op. */
function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const dsn = env.sentryDsn();
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment:      env.nodeEnv(),
      tracesSampleRate: 0, // solo errores, sin performance tracing
    });
    enabled = true;
  } catch {
    // Si Sentry falla al iniciar, no debe tumbar la función.
  }
}

/**
 * Reporta un error a Sentry (si está configurado). Se llama desde logger.error,
 * así que todo el código que ya usa el logger queda monitoreado sin cambios.
 */
export function reportError(message: string, context?: Record<string, unknown>): void {
  ensureInit();
  if (!enabled) return;
  try {
    Sentry.captureMessage(message, {
      level: 'error',
      ...(context ? { extra: context } : {}),
    });
    // Best-effort: intentar enviar antes de que la instancia se congele.
    void Sentry.flush(2000).catch(() => {});
  } catch {
    // nunca propagar errores del propio monitoreo
  }
}
