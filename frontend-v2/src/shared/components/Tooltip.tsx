import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

interface InfoTipProps {
  text: React.ReactNode;
  label?: string;
  size?: number;
  className?: string;
}

interface Coords {
  top: number;
  left: number;
  placedBottom: boolean;
}

function computeCoords(rect: DOMRect, preferred: 'top' | 'bottom', tipHeight = 64): Coords {
  const gap = 8;
  const placedBottom = preferred === 'bottom' || (preferred === 'top' && rect.top < tipHeight + gap + 12);
  const centerX = rect.left + rect.width / 2;
  const maxHalf = 136;
  const left = Math.min(Math.max(centerX, maxHalf + 12), window.innerWidth - maxHalf - 12);
  const top = placedBottom ? rect.bottom + gap : rect.top - gap;
  return { top, left, placedBottom };
}

function TooltipBubble({
  id,
  content,
  coords,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  content: React.ReactNode;
  coords: Coords;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return createPortal(
    <div
      id={id}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: coords.placedBottom ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        zIndex: 1100,
      }}
      className="pointer-events-auto w-max max-w-[260px] rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-normal leading-relaxed text-zinc-100 shadow-2xl"
    >
      {content}
    </div>,
    document.body,
  );
}

/**
 * Tooltip reutilizable para envolver botones de ícono, logos o etiquetas sin ocupar espacio fijo.
 * Se muestra al pasar el cursor o enfocar con teclado y nunca queda recortado por contenedores con overflow.
 */
export function Tooltip({ content, children, side = 'top', className = '' }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      if (!triggerRef.current) return;
      setCoords(computeCoords(triggerRef.current.getBoundingClientRect(), side));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, side]);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      className={`inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
      onClick={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && coords && <TooltipBubble id={id} content={content} coords={coords} />}
    </span>
  );
}

/**
 * Ícono discreto `?` con explicación flotante instantánea en escritorio (hover) y celular (toque).
 */
export function InfoTip({ text, label = 'Más información', size = 13, className = '' }: InfoTipProps) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const open = hoverOpen || pinnedOpen;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleHoverClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setHoverOpen(false), 120);
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      setCoords(computeCoords(btnRef.current.getBoundingClientRect(), 'top'));
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!pinnedOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      setPinnedOpen(false);
      setHoverOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedOpen(false);
        setHoverOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pinnedOpen]);

  useEffect(() => cancelClose, []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => {
          cancelClose();
          setHoverOpen(true);
        }}
        onMouseLeave={scheduleHoverClose}
        onFocus={() => setHoverOpen(true)}
        onBlur={() => setHoverOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinnedOpen((v) => !v);
        }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
          open ? 'text-emerald-300' : ''
        } ${className}`}
      >
        <HelpCircle size={size} />
      </button>
      {open && coords && (
        <TooltipBubble
          id={id}
          content={text}
          coords={coords}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleHoverClose}
        />
      )}
    </>
  );
}
