import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth }  from '@/features/auth/hooks/useAuth';
import { Spinner }  from '@/shared/components/Spinner';
import { Button }   from '@/shared/components/Button';
import { EventModal } from '../components/EventModal';
import {
  listCalendarEvents, cancelAppointment, deleteCalendarEvent, type CalendarEvent,
} from '../services/calendar.service';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const fmtTime = (ms: number) => new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(ms);
const dayKey  = (d: Date | number) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

/** Lunes de la semana que contiene `d` (inicio de grilla). */
function startOfGrid(monthStart: Date): Date {
  const d = new Date(monthStart);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function CalendarPage() {
  const { companyId } = useAuth();
  const [viewDate, setViewDate] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [events,   setEvents]   = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [dayDetail, setDayDetail] = useState<{ date: Date; events: CalendarEvent[] } | null>(null);

  // 42 días (6 semanas) desde el lunes de la primera semana
  const gridDays = useMemo(() => {
    const start = startOfGrid(viewDate);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [viewDate]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const from = gridDays[0];
      const to   = new Date(gridDays[41]); to.setHours(23, 59, 59);
      const r = await listCalendarEvents(companyId, from, to);
      setEvents(r.events);
      setConnected(r.connected);
    } catch {
      setError('No se pudieron cargar los eventos.');
    } finally {
      setLoading(false);
    }
  }, [companyId, gridDays]);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of events) (map[dayKey(e.start)] ??= []).push(e);
    for (const k in map) map[k].sort((a, b) => a.start - b.start);
    return map;
  }, [events]);

  const handleDelete = async (ev: CalendarEvent) => {
    if (!companyId) return;
    if (!confirm(ev.source === 'crm' ? '¿Cancelar esta cita?' : '¿Eliminar este evento de Google Calendar?')) return;
    try {
      if (ev.source === 'crm') await cancelAppointment(companyId, ev.id);
      else                     await deleteCalendarEvent(companyId, ev.id);
      setSelected(null);
      load();
    } catch {
      alert('No se pudo eliminar/cancelar.');
    }
  };

  const todayKey = dayKey(new Date());
  const goMonth = (delta: number) => setViewDate((d) => { const n = new Date(d); n.setMonth(n.getMonth() + delta); return n; });
  const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setViewDate(d); };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <h2 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => goMonth(-1)} className="px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800">◀</button>
            <button onClick={goToday} className="px-2.5 py-1 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 border border-zinc-700">Hoy</button>
            <button onClick={() => goMonth(1)} className="px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800">▶</button>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateFor(new Date())}>
          <span className="sm:hidden">+ Evento</span><span className="hidden sm:inline">+ Nuevo evento</span>
        </Button>
      </div>

      {/* Aviso si no hay Google conectado */}
      {connected === false && (
        <div className="mx-5 mt-3 rounded-lg bg-amber-500/8 border border-amber-500/20 px-4 py-2 shrink-0">
          <p className="text-xs text-amber-300">⚠️ Conecta tu Google Calendar en Config → Conexiones para ver y crear eventos.</p>
        </div>
      )}
      {error && <p className="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 shrink-0">{error}</p>}

      {/* Grilla */}
      <div className="flex-1 overflow-auto p-2 sm:p-5">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="grid grid-cols-7 gap-px bg-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
            {WEEKDAYS.map((w) => (
              <div key={w} className="bg-zinc-950 px-2 py-1.5 text-center text-[11px] font-medium text-zinc-500">{w}</div>
            ))}
            {gridDays.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === viewDate.getMonth();
              const isToday = k === todayKey;
              const dayEvents = byDay[k] ?? [];
              return (
                <div
                  key={k}
                  onClick={() => setCreateFor(d)}
                  className={`min-h-[64px] sm:min-h-[96px] bg-zinc-950 p-1 sm:p-1.5 cursor-pointer hover:bg-zinc-900 transition-colors ${inMonth ? '' : 'opacity-40'}`}
                >
                  <div className={`text-[11px] mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-violet-600 text-white font-semibold' : 'text-zinc-400'}`}>
                    {d.getDate()}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={`${ev.source}-${ev.id}`}
                        onClick={(e) => { e.stopPropagation(); setSelected(ev); }}
                        className={`text-left text-[10px] px-1.5 py-0.5 rounded truncate
                          ${ev.status === 'canceled' ? 'line-through opacity-50 ' : ''}
                          ${ev.source === 'crm' ? 'bg-violet-600/25 text-violet-200' : 'bg-sky-600/25 text-sky-200'}`}
                        title={ev.title}
                      >
                        {!ev.allDay && <span className="opacity-70">{fmtTime(ev.start)} </span>}{ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDayDetail({ date: d, events: dayEvents });
                        }}
                        className="w-fit text-left text-[9px] text-zinc-500 pl-1 hover:text-violet-300"
                      >
                        +{dayEvents.length - 3} más
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal crear */}
      {createFor && companyId && (
        <EventModal companyId={companyId} defaultDate={createFor} onClose={() => setCreateFor(null)} onCreated={load} />
      )}

      {/* Eventos del dia */}
      {dayDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDayDetail(null)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase text-zinc-500">Eventos del dia</p>
                <h3 className="text-sm font-semibold text-zinc-100">
                  {new Intl.DateTimeFormat('es-CO', { dateStyle: 'full' }).format(dayDetail.date)}
                </h3>
              </div>
              <button onClick={() => setDayDetail(null)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800">x</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <div className="flex flex-col gap-2">
                {dayDetail.events.map((ev) => (
                  <button
                    key={`${ev.source}-${ev.id}`}
                    type="button"
                    onClick={() => {
                      setDayDetail(null);
                      setSelected(ev);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors hover:border-violet-500/40
                      ${ev.source === 'crm' ? 'border-violet-500/20 bg-violet-600/10' : 'border-sky-500/20 bg-sky-600/10'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`min-w-0 truncate text-xs font-medium ${ev.status === 'canceled' ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
                        {ev.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {ev.allDay ? 'Todo el dia' : `${fmtTime(ev.start)}-${fmtTime(ev.end)}`}
                      </span>
                    </div>
                    {ev.leadName && <p className="mt-1 truncate text-[11px] text-zinc-500">{ev.leadName}</p>}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setDayDetail(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Detalle evento */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${selected.source === 'crm' ? 'bg-violet-600/20 text-violet-300 border-violet-500/30' : 'bg-sky-600/20 text-sky-300 border-sky-500/30'}`}>
                {selected.source === 'crm' ? 'Cita CRM' : 'Google Calendar'}
              </span>
              {selected.status && <span className="text-[10px] text-zinc-500">{selected.status}</span>}
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">{selected.title}</h3>
            <p className="text-xs text-zinc-400">
              {new Intl.DateTimeFormat('es-CO', { dateStyle: 'full' }).format(selected.start)}
              {!selected.allDay && ` · ${fmtTime(selected.start)}–${fmtTime(selected.end)}`}
            </p>
            {selected.leadName && <p className="text-xs text-zinc-400">👤 {selected.leadName}</p>}
            {selected.meetLink && (
              <a href={selected.meetLink} target="_blank" rel="noreferrer" className="text-xs text-violet-400 hover:text-violet-300">🎥 Unirse a Google Meet</a>
            )}
            <div className="flex gap-2 justify-end mt-1">
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Cerrar</Button>
              {selected.status !== 'canceled' && (
                <Button variant="secondary" size="sm" onClick={() => handleDelete(selected)}>
                  {selected.source === 'crm' ? 'Cancelar cita' : 'Eliminar'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
