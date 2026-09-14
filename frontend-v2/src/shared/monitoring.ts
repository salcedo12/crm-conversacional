/**
 * Reporte de errores del frontend (Sentry), cargado de forma diferida.
 *
 * Solo se activa si existe `VITE_SENTRY_DSN` en el build. Sin esa variable no
 * hace nada (ni siquiera descarga la librería), así el desarrollo local y los
 * builds sin DSN quedan igual de ligeros. Para activarlo en producción: definir
 * VITE_SENTRY_DSN al compilar (idealmente el mismo proyecto que usa el backend).
 */
type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;

function dsn(): string | undefined {
  return import.meta.env.VITE_SENTRY_DSN as string | undefined;
}

export async function initMonitoring(): Promise<void> {
  if (!dsn()) return;
  try {
    const mod = await import('@sentry/react');
    mod.init({
      dsn: dsn(),
      environment: import.meta.env.MODE,
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.1),
      sendDefaultPii: false,
    });
    sentry = mod;
  } catch {
    // Nunca dejar que el monitoreo rompa el arranque.
  }
}

/** Reporta un error manualmente (no-op si Sentry no está activo). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // silencioso
  }
}
