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

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
        <div className="max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl">
          <p className="text-sm font-semibold">No se pudo cargar Meraki CRM</p>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            El navegador puede tener una version anterior en cache. Recarga la pagina para traer la version nueva.
          </p>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem(RELOAD_KEY);
              const url = new URL(window.location.href);
              url.searchParams.set('v', String(Date.now()));
              window.location.replace(url.toString());
            }}
            className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-400"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
