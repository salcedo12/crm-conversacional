import { useState } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { bookAppointmentManual } from '@/features/calendar/services/calendar.service';
import type { Lead } from '@/features/inbox/types';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function defaultDateTime() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function BookAppointmentModal({
  companyId,
  lead,
  onClose,
  onBooked,
}: {
  companyId: string;
  lead: Lead;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const initial = defaultDateTime();
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState(`Cita con ${lead.name ?? lead.phone}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meet, setMeet] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    setMeet(null);
    try {
      const start = new Date(`${date}T${time}:00`);
      const result = await bookAppointmentManual(companyId, {
        leadId: lead.id,
        startISO: start.toISOString(),
        durationMinutes: duration,
        title: title.trim() || undefined,
      });
      setMeet(result.googleMeetLink);
      onBooked?.();
    } catch (err) {
      console.error('[BookAppointment] error:', err);
      setError('No se pudo agendar. Revisa disponibilidad o conexion de calendario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Agendar cita</p>
            <h3 className="text-sm font-semibold text-zinc-100">{lead.name ?? lead.phone}</h3>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs text-zinc-400">
            Titulo
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-zinc-400">
              Fecha
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" />
            </label>
            <label className="block text-xs text-zinc-400">
              Hora
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" />
            </label>
          </div>
          <label className="block text-xs text-zinc-400">
            Duracion
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60">
              <option value={30}>30 minutos</option>
              <option value={45}>45 minutos</option>
              <option value={60}>60 minutos</option>
              <option value={90}>90 minutos</option>
            </select>
          </label>
        </div>

        {error && <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {meet && (
          <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            Cita agendada. {meet && <a href={meet} target="_blank" rel="noreferrer" className="underline underline-offset-2">Abrir Meet</a>}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
          <Button size="sm" onClick={submit} loading={saving}><CalendarPlus size={15} /> Agendar</Button>
        </div>
      </div>
    </div>
  );
}
