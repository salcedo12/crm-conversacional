import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const LAYERS = {
  /** Ventanas que abren otras ventanas encima (p. ej. "Nuevo negocio"). */
  base: 'z-[120]',
  /** Por encima del panel del lead (LeadDrawer z-[110]) y de "Nuevo negocio". */
  sheet: 'z-[160]',
  /** Por encima de todo (enviar a firma, que se abre desde otras ventanas). */
  top: 'z-[200]',
} as const;

const WIDTHS = {
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-4xl',
  '2xl': 'sm:max-w-5xl',
} as const;

/**
 * Ventana de Negocios que se adapta al dispositivo:
 * - Celular (iPhone/Android): pantalla completa, encabezado y botones fijos respetando
 *   el notch y la barra de inicio, y campos de 16px para que iOS no haga zoom al tocarlos.
 * - Computador: ventana centrada como antes.
 * Es la misma estructura que se replicará en la app móvil.
 */
export function DealSheet({
  title,
  subtitle,
  icon,
  onClose,
  footer,
  children,
  width = 'lg',
  layer = 'sheet',
  bodyClassName = '',
  toolbar,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  layer?: keyof typeof LAYERS;
  bodyClassName?: string;
  /** Franja fija bajo el encabezado (filtros, buscador). */
  toolbar?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Evita que la página de atrás se desplace mientras la ventana está abierta (iOS).
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className={`deal-touch fixed inset-0 ${LAYERS[layer]} flex items-stretch justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex h-[100dvh] w-full flex-col overflow-hidden bg-zinc-900 shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-xl sm:border sm:border-zinc-800 ${WIDTHS[width]}`}
      >
        <header className="flex items-start gap-3 border-b border-zinc-800 px-4 pb-3 pt-[max(0.75rem,var(--safe-top))] sm:px-5 sm:pt-3.5">
          {icon && <span className="mt-0.5 shrink-0 text-emerald-400">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-zinc-100 sm:text-sm">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-zinc-500 sm:text-[11px]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:-mr-1 sm:h-8 sm:w-8"
          >
            <X size={18} />
          </button>
        </header>

        {toolbar && <div className="border-b border-zinc-800 px-4 py-3 sm:px-5">{toolbar}</div>}

        <div className={`flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <footer className="border-t border-zinc-800 bg-zinc-900 px-4 pb-[max(0.75rem,var(--safe-bottom))] pt-3 sm:px-5 sm:pb-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Pie estándar: mensaje (o error) arriba en celular / a la izquierda en computador, y los
 * botones ocupando todo el ancho en celular para tocarlos fácil con el pulgar.
 */
export function DealSheetFooter({ info, error, actions }: { info?: ReactNode; error?: string | null; actions: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-xs sm:text-[11px]">
        {error ? <p className="text-red-300">{error}</p> : <div className="text-zinc-500">{info}</div>}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:shrink-0">{actions}</div>
    </div>
  );
}

/** Clases compartidas de los campos de Negocios (más altos y legibles en celular). */
export const dealInputCls =
  'w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-800/90 px-3 py-2.5 text-base text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-60 sm:rounded-md sm:px-2.5 sm:py-1.5 sm:text-xs';

/** Botón de acción secundaria dentro de las tarjetas (chip con buena área táctil en celular). */
export const dealActionCls =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-700/80 px-3 text-xs font-medium transition-colors disabled:opacity-50 sm:min-h-0 sm:rounded-md sm:border-transparent sm:px-0 sm:text-[11px]';

/** Etiqueta + campo. */
export function DealField({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-[10px]">{label}</span>
      {children}
      {hint}
    </label>
  );
}
