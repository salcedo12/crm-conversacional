import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';
import { getCommercialWeekStart } from '../services/commercial.service';

export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | '30d' | 'month' | 'custom';

export interface DateRangeValue {
  preset: DatePreset;
  startDate: Date | null;
  endDate: Date | null;
  label: string;
}

export function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDayKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const fmtShort = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' });

export function formatFriendlyRange(from: Date, to: Date): string {
  const kFrom = toDayKey(from);
  const kTo = toDayKey(to);
  if (kFrom === kTo) {
    return fmtLong.format(from);
  }
  const left = from.getFullYear() === to.getFullYear() ? fmtShort.format(from) : fmtLong.format(from);
  return `${left} – ${fmtLong.format(to)}`;
}

export function buildPresetRange(preset: DatePreset): DateRangeValue {
  const now = new Date();

  if (preset === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return {
      preset: 'today',
      startDate: s,
      endDate: e,
      label: `Hoy (${fmtShort.format(now)})`,
    };
  }

  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const s = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
    const e = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
    return {
      preset: 'yesterday',
      startDate: s,
      endDate: e,
      label: `Ayer (${fmtShort.format(y)})`,
    };
  }

  if (preset === 'week') {
    const s = getCommercialWeekStart(now);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return {
      preset: 'week',
      startDate: s,
      endDate: e,
      label: 'Esta semana',
    };
  }

  if (preset === '30d') {
    const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    s.setHours(0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return {
      preset: '30d',
      startDate: s,
      endDate: e,
      label: 'Últimos 30 días',
    };
  }

  if (preset === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthName = fmtMonth.format(now);
    return {
      preset: 'month',
      startDate: s,
      endDate: e,
      label: `${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`,
    };
  }

  return {
    preset: 'all',
    startDate: null,
    endDate: null,
    label: 'Histórico completo',
  };
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface Props {
  value: DateRangeValue;
  onChange: (newValue: DateRangeValue) => void;
}

export function CommercialDateFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const todayKey = toDayKey(new Date());

  // Rango local en el calendario mientras el usuario interactúa
  const [startKey, setStartKey] = useState<string | null>(() =>
    value.startDate ? toDayKey(value.startDate) : null
  );
  const [endKey, setEndKey] = useState<string | null>(() =>
    value.endDate ? toDayKey(value.endDate) : null
  );
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const [viewMonth, setViewMonth] = useState<Date>(() => {
    if (value.startDate) return new Date(value.startDate.getFullYear(), value.startDate.getMonth(), 1);
    return new Date();
  });

  // Sincronizar selección local cuando se abre
  useEffect(() => {
    if (!open) return;
    setStartKey(value.startDate ? toDayKey(value.startDate) : null);
    setEndKey(value.endDate ? toDayKey(value.endDate) : null);
    if (value.startDate) {
      setViewMonth(new Date(value.startDate.getFullYear(), value.startDate.getMonth(), 1));
    }
  }, [open, value.startDate, value.endDate]);

  // Cerrar al hacer clic fuera o Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Celdas de la cuadrícula mensual (Lunes a Domingo)
  const cells = useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // Lunes primero
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(toDayKey(new Date(y, m, d)));
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewMonth]);

  const handlePickDay = (k: string) => {
    if (!startKey || endKey) {
      setStartKey(k);
      setEndKey(null);
      return;
    }
    if (k < startKey) {
      setEndKey(startKey);
      setStartKey(k);
    } else {
      setEndKey(k);
    }
  };

  const handleApplyPreset = (preset: DatePreset) => {
    const r = buildPresetRange(preset);
    onChange(r);
    setOpen(false);
  };

  const handleApplyCustom = () => {
    if (!startKey) return;
    const finalStartKey = startKey;
    const finalEndKey = endKey || startKey;

    const s = parseDayKey(finalStartKey);
    s.setHours(0, 0, 0, 0);

    const e = parseDayKey(finalEndKey);
    e.setHours(23, 59, 59, 999);

    const label = formatFriendlyRange(s, e);
    onChange({
      preset: 'custom',
      startDate: s,
      endDate: e,
      label,
    });
    setOpen(false);
  };

  const handleClear = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onChange(buildPresetRange('all'));
    setOpen(false);
  };

  const lo = startKey && !endKey && hoverKey ? (hoverKey < startKey ? hoverKey : startKey) : startKey;
  const hi = startKey && !endKey && hoverKey ? (hoverKey < startKey ? startKey : hoverKey) : (endKey ?? startKey);

  const isFiltered = value.preset !== 'all' && value.startDate !== null;

  return (
    <div ref={rootRef} className="relative inline-block text-xs">
      {/* Botón Principal del Filtro de Fecha */}
      <div
        className={`flex items-center rounded-xl border text-xs transition-all shadow-sm ${
          isFiltered
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
            : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 font-semibold cursor-pointer truncate max-w-[210px] sm:max-w-[250px]"
          title="Filtrar prospectos y gestiones por rango de fechas (Calendario)"
        >
          <CalendarDays size={13} className={isFiltered ? 'text-emerald-400 shrink-0' : 'text-zinc-400 shrink-0'} />
          <span className="truncate">{value.label}</span>
        </button>

        {isFiltered && (
          <button
            type="button"
            onClick={handleClear}
            title="Quitar filtro de fecha (Ver histórico completo)"
            className="pr-2 pl-0.5 py-1 text-emerald-400/80 hover:text-emerald-200 cursor-pointer transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Popover del Calendario Interactivo */}
      {open && (
        <div className="absolute right-0 sm:left-0 sm:right-auto top-full z-50 mt-2 w-[310px] max-w-[calc(100vw-24px)] rounded-2xl border border-zinc-700/80 bg-zinc-900 p-3.5 shadow-2xl shadow-black/80 text-zinc-100 backdrop-blur-md">
          {/* Accesos Rápidos (Presets) */}
          <div className="mb-3 grid grid-cols-3 gap-1 pb-3 border-b border-zinc-800">
            <button
              type="button"
              onClick={() => handleApplyPreset('today')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === 'today'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              ⚡ Hoy
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('yesterday')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === 'yesterday'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              ⚡ Ayer
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('week')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === 'week'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              ⚡ Esta Semana
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('30d')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === '30d'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              🔥 Últimos 30d
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('month')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === 'month'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              🗓️ Este Mes
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('all')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition text-center cursor-pointer ${
                value.preset === 'all'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
            >
              Todo
            </button>
          </div>

          {/* Navegación del Mes */}
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition cursor-pointer"
              title="Mes anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="text-xs font-bold text-zinc-200 capitalize">
              {fmtMonth.format(viewMonth)}
            </span>

            <button
              type="button"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition cursor-pointer"
              title="Mes siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Días de la Semana */}
          <div className="grid grid-cols-7 text-center text-[10px] font-bold text-zinc-500 mb-1">
            {WEEKDAYS.map((w, idx) => (
              <span key={idx} className="py-1">
                {w}
              </span>
            ))}
          </div>

          {/* Celdas de Días */}
          <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHoverKey(null)}>
            {cells.map((k, idx) => {
              if (!k) return <span key={idx} className="h-8" />;

              const inRange = !!lo && !!hi && k >= lo && k <= hi;
              const isStart = k === lo;
              const isEnd = k === hi;
              const isSingleEdge = isStart || isEnd;
              const isToday = k === todayKey;

              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handlePickDay(k)}
                  onMouseEnter={() => setHoverKey(k)}
                  className={`h-8 text-xs tabular-nums transition-colors relative cursor-pointer font-medium ${
                    inRange && !isSingleEdge ? 'bg-emerald-500/20 text-emerald-200' : ''
                  } ${
                    isSingleEdge
                      ? 'rounded-lg bg-emerald-500 font-bold text-zinc-950 shadow-sm'
                      : !inRange
                      ? 'rounded-lg text-zinc-300 hover:bg-zinc-800'
                      : ''
                  } ${isToday && !isSingleEdge ? 'ring-1 ring-emerald-500/50 text-emerald-300 font-bold' : ''}`}
                >
                  {Number(k.slice(8))}
                </button>
              );
            })}
          </div>

          {/* Resumen del Rango y Botón Aplicar */}
          <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400 truncate max-w-[170px]" title={startKey ? `${startKey} a ${endKey || startKey}` : 'Selecciona un día o rango'}>
              {startKey ? (
                <>
                  {startKey === (endKey || startKey) ? (
                    <span className="text-zinc-200 font-medium">1 día marcado</span>
                  ) : (
                    <span className="text-zinc-200 font-medium">
                      {startKey.slice(5)} al {endKey?.slice(5)}
                    </span>
                  )}
                </>
              ) : (
                'Elige un día o rango'
              )}
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleApplyCustom}
                disabled={!startKey}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-40 cursor-pointer shadow-sm flex items-center gap-1"
              >
                <Check size={12} />
                <span>Aplicar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
