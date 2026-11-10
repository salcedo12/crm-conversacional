import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

/** Día en formato YYYY-MM-DD (hora local del navegador). */
export type DayKey = string;

export function toDayKey(d: Date): DayKey {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDayKey(k: DayKey): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(k: DayKey, n: number): DayKey {
  const d = parseDayKey(k);
  d.setDate(d.getDate() + n);
  return toDayKey(d);
}

/** Días entre dos claves, inclusivo. */
function daySpan(from: DayKey, to: DayKey): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / 86_400_000) + 1;
}

const fmtShort = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' });

/** "Noviembre de 2026" (solo la primera letra en mayúscula). */
function monthTitle(d: Date): string {
  const s = fmtMonth.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texto corto de un rango: "9 nov 2026" o "3 nov – 9 nov 2026". */
export function formatDayRange(from: DayKey, to: DayKey): string {
  if (from === to) return fmtLong.format(parseDayKey(from));
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const left = a.getFullYear() === b.getFullYear() ? fmtShort.format(a) : fmtLong.format(a);
  return `${left} – ${fmtLong.format(b)}`;
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface Props {
  /** Rango aplicado (null = no hay rango personalizado activo). */
  value: { from: DayKey; to: DayKey } | null;
  onApply: (from: DayKey, to: DayKey) => void;
  onClear: () => void;
}

/**
 * Selector de calendario: un clic elige un día; un segundo clic cierra el rango
 * (en cualquier orden). "Aplicar" con un solo día marcado consulta solo ese día.
 */
export function DateRangePicker({ value, onApply, onClear }: Props) {
  const today = toDayKey(new Date());
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<DayKey | null>(value?.from ?? null);
  const [end, setEnd] = useState<DayKey | null>(value?.to ?? null);
  const [hover, setHover] = useState<DayKey | null>(null);
  const [month, setMonth] = useState(() => {
    const d = parseDayKey(value?.to ?? today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Al abrir, parte del rango aplicado.
  useEffect(() => {
    if (!open) return;
    setStart(value?.from ?? null);
    setEnd(value?.to ?? null);
    const d = parseDayKey(value?.to ?? today);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cerrar con clic afuera / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;   // lunes primero
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (DayKey | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(toDayKey(new Date(month.getFullYear(), month.getMonth(), d)));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const pick = (k: DayKey) => {
    if (!start || end) { setStart(k); setEnd(null); return; }
    if (k < start) { setEnd(start); setStart(k); } else setEnd(k);
  };

  // Rango que se pinta (con vista previa al pasar el mouse mientras falta el fin).
  const lo = start && !end && hover ? (hover < start ? hover : start) : start;
  const hi = start && !end && hover ? (hover < start ? start : hover) : (end ?? start);

  const apply = (from: DayKey, to: DayKey) => { onApply(from, to); setOpen(false); };

  const canNext = toDayKey(new Date(month.getFullYear(), month.getMonth() + 1, 1)) <= today;
  const selFrom = start;
  const selTo = end ?? start;

  const quick: [string, DayKey, DayKey][] = [
    ['Hoy', today, today],
    ['Ayer', addDays(today, -1), addDays(today, -1)],
    ['Esta semana', addDays(today, -((new Date().getDay() + 6) % 7)), today],
    ['Este mes', toDayKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), today],
  ];

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex items-center rounded-lg border text-[11px] transition-colors ${value ? 'border-violet-500/40 bg-violet-600/20 text-violet-300' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
      >
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 px-2.5 py-1.5">
          <CalendarDays size={13} />
          {value ? formatDayRange(value.from, value.to) : 'Elegir fechas'}
        </button>
        {value && (
          <button onClick={onClear} title="Quitar rango" className="pr-2 text-violet-300/70 hover:text-violet-200">
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[300px] max-w-[calc(100vw-32px)] rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Mes anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs font-semibold text-zinc-200">{monthTitle(month)}</span>
            <button
              onClick={() => canNext && setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              disabled={!canNext}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Mes siguiente"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-zinc-500">
            {WEEKDAYS.map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
            {cells.map((k, i) => {
              if (!k) return <span key={i} />;
              const future = k > today;
              const inRange = !!lo && !!hi && k >= lo && k <= hi;
              const edge = k === lo || k === hi;
              return (
                <button
                  key={k}
                  disabled={future}
                  onClick={() => pick(k)}
                  onMouseEnter={() => setHover(k)}
                  className={`relative h-9 text-xs tabular-nums transition-colors
                    ${inRange && !edge ? 'bg-violet-600/15 text-violet-200' : ''}
                    ${edge ? 'rounded-md bg-violet-600 font-semibold text-white' : ''}
                    ${!inRange && !future ? 'rounded-md text-zinc-300 hover:bg-zinc-800' : ''}
                    ${future ? 'cursor-not-allowed text-zinc-700' : ''}
                    ${k === today && !edge ? 'font-semibold underline decoration-violet-400 underline-offset-4' : ''}`}
                >
                  {Number(k.slice(8))}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {quick.map(([label, f, t]) => (
              <button
                key={label}
                onClick={() => apply(f, t)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:border-violet-500/50 hover:text-violet-300"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
            <span className="text-[11px] text-zinc-500">
              {selFrom && selTo
                ? `${formatDayRange(selFrom, selTo)} · ${daySpan(selFrom, selTo)} ${daySpan(selFrom, selTo) === 1 ? 'día' : 'días'}`
                : 'Elige un día o un rango'}
            </span>
            <button
              onClick={() => selFrom && selTo && apply(selFrom, selTo)}
              disabled={!selFrom}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
