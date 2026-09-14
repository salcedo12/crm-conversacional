import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'meraki:install-dismissed';

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

/**
 * Banner para instalar la PWA.
 *  - Android/Chrome de escritorio: usa el evento `beforeinstallprompt` (botón "Instalar").
 *  - iPhone/iPad (Safari): guía manual (Compartir → Añadir a inicio), ya que iOS no
 *    expone el evento y el push exige tener la app instalada.
 * Se oculta si ya está instalada o si el usuario lo descartó.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    if (isStandalone() || dismissed) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => { setDeferred(null); setShowIosHint(false); };
    window.addEventListener('appinstalled', onInstalled);

    // iOS no dispara beforeinstallprompt: mostrar la guía manual si es Safari en iPhone.
    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    setDeferred(null);
    setShowIosHint(false);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* modo privado */ }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    dismiss();
  };

  if (dismissed || isStandalone()) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[90] md:inset-x-auto md:right-4 md:bottom-4 md:w-[360px]">
      <div className="flex items-start gap-3 rounded-lg border border-violet-500/30 bg-zinc-950/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
          <Download className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100">Instala Meraki CRM</p>
          {deferred ? (
            <p className="mt-0.5 text-xs text-zinc-400">
              Añádelo a tu dispositivo para abrirlo como app y recibir notificaciones.
            </p>
          ) : (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-zinc-400">
              Toca <Share className="inline h-3.5 w-3.5 text-zinc-300" /> y luego
              <span className="font-medium text-zinc-200">"Añadir a inicio"</span>
              para instalar y recibir notificaciones.
            </p>
          )}
          {deferred && (
            <button
              type="button"
              onClick={install}
              className="mt-2 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
            >
              Instalar app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Descartar"
          className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
