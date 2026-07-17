import { useEffect, useState } from 'react';
import { useSchedulingConfig } from '../hooks/useSchedulingConfig';
import { fetchColombianHolidays, type ColombianHoliday } from '../services/scheduling.service';
import { Spinner } from '@/shared/components/Spinner';

/** Formatea 'YYYY-MM-DD' como "lun 12 ene" (parseando como fecha local). */
function formatHolidayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y, m - 1, d));
}

const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

const labelCls = 'block text-xs font-medium text-zinc-400 mb-1';
const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500';

export function SchedulingConfigForm({ companyId }: { companyId: string }) {
  const { draft, status, error, isDirty, save, update } = useSchedulingConfig(companyId);
  const [holidays, setHolidays] = useState<ColombianHoliday[]>([]);

  // Festivos del año en curso (uno por clave) para mostrarlos en la lista.
  useEffect(() => {
    fetchColombianHolidays()
      .then((all) => {
        const thisYear = String(new Date().getFullYear());
        const seen = new Set<string>();
        const list = all
          .filter((h) => h.date.startsWith(thisYear))
          .filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
        setHolidays(list);
      })
      .catch((err) => console.error('[SchedulingConfigForm] holidays load error:', err));
  }, []);

  if (!draft) {
    return status === 'error'
      ? <p className="text-sm text-zinc-500">{error ?? 'No se pudo cargar.'}</p>
      : <div className="flex justify-center py-16"><Spinner /></div>;
  }

  const toggleDay = (d: number) => {
    const has = draft.workingDays.includes(d);
    update('workingDays', has ? draft.workingDays.filter((x) => x !== d) : [...draft.workingDays, d]);
  };

  const toggleWorkedHoliday = (key: string) => {
    const has = draft.workedHolidays.includes(key);
    update('workedHolidays', has ? draft.workedHolidays.filter((k) => k !== key) : [...draft.workedHolidays, key]);
  };

  return (
    <div className="space-y-6">
      {/* Días laborales */}
      <div>
        <label className={labelCls}>Días de atención</label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(({ value, label }) => {
            const active = draft.workingDays.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleDay(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-violet-500/15 border-violet-500 text-violet-200'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Horario */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Hora de apertura</label>
          <input
            type="number" min={0} max={23} className={inputCls}
            value={draft.startHour}
            onChange={(e) => update('startHour', Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>Hora de cierre</label>
          <input
            type="number" min={1} max={24} className={inputCls}
            value={draft.endHour}
            onChange={(e) => update('endHour', Number(e.target.value))}
          />
        </div>
      </div>

      {/* Duración + ventana */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Duración de cita (min)</label>
          <select
            className={inputCls}
            value={draft.slotMinutes}
            onChange={(e) => update('slotMinutes', Number(e.target.value))}
          >
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Buscar alternativas (días)</label>
          <input
            type="number" min={1} max={60} className={inputCls}
            value={draft.lookaheadDays}
            onChange={(e) => update('lookaheadDays', Number(e.target.value))}
          />
        </div>
      </div>

      {/* Anticipación mínima */}
      <div>
        <label className={labelCls}>Anticipación mínima de la IA (minutos)</label>
        <input
          type="number" min={0} max={1440} className={inputCls}
          value={draft.minAdvanceMinutes}
          onChange={(e) => update('minAdvanceMinutes', Number(e.target.value))}
        />
        <p className="text-xs text-zinc-500 mt-1">
          La IA no agenda citas con menos de este tiempo desde ahora (evita citas en el pasado o "para ya"). Los asesores no tienen este límite.
        </p>
      </div>

      {/* Almuerzo */}
      <div>
        <label className="flex items-center gap-2 text-sm text-zinc-300 mb-2">
          <input
            type="checkbox"
            checked={!!draft.lunch}
            onChange={(e) => update('lunch', e.target.checked ? { startHour: 12, endHour: 13 } : null)}
          />
          Pausa de almuerzo (no se agenda en esta franja)
        </label>
        {draft.lunch && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div>
              <label className={labelCls}>Inicio</label>
              <input
                type="number" min={0} max={23} className={inputCls}
                value={draft.lunch.startHour}
                onChange={(e) => update('lunch', { ...draft.lunch!, startHour: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className={labelCls}>Fin</label>
              <input
                type="number" min={1} max={24} className={inputCls}
                value={draft.lunch.endHour}
                onChange={(e) => update('lunch', { ...draft.lunch!, endHour: Number(e.target.value) })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Festivos de Colombia (automático) */}
      <div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={draft.colombianHolidays}
            onChange={(e) => update('colombianHolidays', e.target.checked)}
          />
          Aplicar festivos de Colombia automáticamente
        </label>
        <p className="text-xs text-zinc-500 mt-1 pl-6">
          Calcula los 18 festivos nacionales cada año (incluye los que se trasladan al lunes). No tienes que escribirlos.
        </p>

        {draft.colombianHolidays && holidays.length > 0 && (
          <div className="mt-3 pl-6">
            <p className="text-xs text-zinc-500 mb-2">
              Festivos {new Date().getFullYear()}. Por defecto están <span className="text-zinc-300">cerrados</span>; marca los que tu empresa <span className="text-zinc-300">sí atiende</span>:
            </p>
            <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-72 overflow-y-auto">
              {holidays.map((h) => {
                const worked = draft.workedHolidays.includes(h.key);
                return (
                  <label
                    key={h.key}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-900/60"
                  >
                    <span className="min-w-0">
                      <span className="text-zinc-200">{h.name}</span>
                      <span className="text-zinc-500"> · {formatHolidayDate(h.date)}</span>
                    </span>
                    <span className={`shrink-0 flex items-center gap-1.5 text-xs ${worked ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      <input type="checkbox" checked={worked} onChange={() => toggleWorkedHoliday(h.key)} />
                      {worked ? 'se trabaja' : 'cerrado'}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Cierres adicionales */}
      <div>
        <label className={labelCls}>Cierres adicionales (uno por línea, formato AAAA-MM-DD)</label>
        <p className="text-xs text-zinc-500 mb-1">Solo para fechas que NO son festivos nacionales (ej. aniversario, vacaciones).</p>
        <textarea
          className={`${inputCls} h-24 font-mono`}
          placeholder={'2026-12-24\n2026-12-31'}
          value={draft.holidays.join('\n')}
          onChange={(e) =>
            update('holidays', e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))
          }
        />
      </div>

      {/* Guardar */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={!isDirty || status === 'saving'}
          onClick={save}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-500 transition-colors"
        >
          {status === 'saving' ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {status === 'saved' && <span className="text-xs text-emerald-400">✓ Guardado</span>}
        {status === 'error' && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
