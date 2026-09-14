import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Video } from 'lucide-react';
import { listLeadAppointments, type AppointmentDTO } from '@/features/calendar/services/calendar.service';

interface Props {
  companyId: string;
  leadId: string;
  /** Cambia este número para forzar una recarga (p. ej. tras agendar). */
  refreshKey?: number;
}

const STATUS_STYLE: Record<AppointmentDTO['status'], { label: string; className: string }> = {
  scheduled: { label: 'Agendada',  className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' },
  completed: { label: 'Realizada', className: 'border-sky-500/25 bg-sky-500/10 text-sky-300' },
  canceled:  { label: 'Cancelada', className: 'border-zinc-600 bg-zinc-800 text-zinc-400' },
};

const dateFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });

function formatRange(start: number, end: number): string {
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}

export function LeadAppointmentsPanel({ companyId, leadId, refreshKey = 0 }: Props) {
  const [appointments, setAppointments] = useState<AppointmentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId || !leadId) return;
    setLoading(true);
    try {
      setAppointments(await listLeadAppointments(companyId, leadId));
    } catch (err) {
      console.error('[LeadAppointments] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, leadId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const copyMeet = async (id: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      /* clipboard no disponible */
    }
  };

  if (loading) return <p className="text-xs text-zinc-500">Cargando citas…</p>;
  if (appointments.length === 0) return <p className="text-xs text-zinc-500">Sin citas agendadas.</p>;

  return (
    <div className="space-y-2.5">
      {appointments.map((appt) => {
        const style = STATUS_STYLE[appt.status];
        return (
          <div key={appt.id} className="rounded-lg border border-zinc-800 bg-zinc-800/40 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-100">{appt.title}</p>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${style.className}`}>{style.label}</span>
            </div>
            <p className="mt-0.5 text-[11px] capitalize text-zinc-400">{formatRange(appt.startTime, appt.endTime)}</p>
            {appt.googleMeetLink && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <a
                  href={appt.googleMeetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Video size={12} /> Abrir Meet
                </a>
                <button
                  onClick={() => copyMeet(appt.id, appt.googleMeetLink!)}
                  title={appt.googleMeetLink}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700"
                >
                  {copiedId === appt.id ? <Check size={12} /> : <Copy size={12} />} {copiedId === appt.id ? 'Copiado' : 'Copiar enlace'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
