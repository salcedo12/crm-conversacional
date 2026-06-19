import { useState } from 'react';
import { Button } from '@/shared/components/Button';
import { createCalendarEvent } from '../services/calendar.service';

interface Props {
  companyId:   string;
  defaultDate: Date;       // día seleccionado
  onClose:     () => void;
  onCreated:   () => void;
}

const inputClass = `
  w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
  text-sm text-zinc-100 placeholder-zinc-500
  focus:outline-none focus:border-violet-500/50 transition-colors
`;

const pad = (n: number) => String(n).padStart(2, '0');

export function EventModal({ companyId, defaultDate, onClose, onCreated }: Props) {
  const [title,    setTitle]    = useState('');
  const [date,     setDate]     = useState(`${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}`);
  const [time,     setTime]     = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [withMeet, setWithMeet] = useState(true);
  const [desc,     setDesc]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim()) { setError('El título es obligatorio.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Construir ISO local (el backend usa la zona horaria configurada)
      const startISO = new Date(`${date}T${time}:00`).toISOString();
      await createCalendarEvent(companyId, {
        title: title.trim(), startISO, durationMinutes: duration,
        description: desc.trim() || undefined, withMeet,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo crear el evento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-zinc-100">Nuevo evento</h3>

        <input className={inputClass} placeholder="Título del evento" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-zinc-400">Fecha</label>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-zinc-400">Hora</label>
            <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-zinc-400">Duración (minutos)</label>
          <select className={inputClass} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>

        <textarea className={`${inputClass} resize-y`} rows={2} placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />

        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={withMeet} onChange={(e) => setWithMeet(e.target.checked)} />
          🎥 Crear enlace de Google Meet
        </label>

        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>Crear evento</Button>
        </div>
      </div>
    </div>
  );
}
