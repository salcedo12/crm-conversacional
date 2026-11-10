import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/shared/monitoring';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

const RELOAD_KEY = 'meraki:chunk-reload-attempted';

function isChunkLoadError(error: Error): boolean {
  return /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i
    .test(error.message);
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info);
    reportError(error, { componentStack: info.componentStack });

    if (!isChunkLoadError(error)) return;
    if (sessionStorage.getItem(RELOAD_KEY)) return;

    sessionStorage.setItem(RELOAD_KEY, 'true');
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.toString());
  }

  handleCleanReload = async () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
      localStorage.removeItem(RELOAD_KEY);
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {
      console.warn('Error clearing caches:', e);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.toString());
  };

  render() {
    if (!this.state.error) return this.props.children;

    const errorMsg = this.state.error?.message || 'Error inesperado';

    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
        <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl space-y-4">
          <p className="text-base font-bold text-white">No se pudo cargar Meraki CRM</p>
          <p className="text-xs leading-5 text-zinc-400">
            El navegador puede tener módulos anteriores en caché o se produjo una actualización de versión.
          </p>

          <div className="text-left p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-rose-400 font-mono text-[11px] overflow-x-auto max-h-36">
            <span className="font-bold text-zinc-400 block mb-1">Detalle del error:</span>
            {errorMsg}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleCleanReload}
              className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-bold text-zinc-950 transition cursor-pointer shadow-md"
            >
              Limpiar caché y recargar
            </button>

            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(RELOAD_KEY);
                window.location.href = '/dashboard';
              }}
              className="rounded-xl bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 transition cursor-pointer"
            >
              Ir a Inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
