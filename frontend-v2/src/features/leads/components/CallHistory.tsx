import { useState } from 'react';
import { PhoneCall, PhoneMissed, PhoneIncoming, Voicemail, PhoneForwarded, PhoneOff, Loader2, ChevronDown, Play } from 'lucide-react';
import { formatMessageTime } from '@/shared/utils/date';
import type { Call, CallStatus } from '../services/calls.service';

interface CallHistoryProps {
  calls:   Call[];
  loading: boolean;
}

const STATUS_META: Record<CallStatus, { label: string; icon: typeof PhoneCall; cls: string }> = {
  initiated:   { label: 'Marcando…',   icon: Loader2,         cls: 'text-violet-300' },
  ringing:      { label: 'Sonando…',    icon: PhoneIncoming,  cls: 'text-emerald-300' },
  connecting:   { label: 'Conectando…', icon: Loader2,        cls: 'text-violet-300' },
  'in-progress': { label: 'En curso',  icon: PhoneCall,       cls: 'text-emerald-300' },
  missed:       { label: 'Perdida',     icon: PhoneMissed,    cls: 'text-amber-300' },
  rejected:     { label: 'Rechazada',   icon: PhoneOff,       cls: 'text-red-300' },
  completed:   { label: 'Completada',  icon: PhoneCall,       cls: 'text-emerald-300' },
  'no-answer': { label: 'Sin respuesta', icon: PhoneMissed,   cls: 'text-amber-300' },
  voicemail:   { label: 'Buzón de voz', icon: Voicemail,      cls: 'text-sky-300' },
  busy:        { label: 'Ocupado',     icon: PhoneOff,        cls: 'text-amber-300' },
  failed:      { label: 'Fallida',     icon: PhoneOff,        cls: 'text-red-300' },
  transferred: { label: 'Transferida', icon: PhoneForwarded,  cls: 'text-sky-300' },
};

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallHistory({ calls, loading }: CallHistoryProps) {
  if (loading && calls.length === 0) {
    return <p className="text-[11px] text-zinc-600">Cargando llamadas…</p>;
  }
  if (calls.length === 0) {
    return <p className="text-[11px] text-zinc-600">Aún no hay llamadas con IA para este contacto.</p>;
  }

  return (
    <ul className="space-y-2">
      {calls.map((call) => <CallItem key={call.id} call={call} />)}
    </ul>
  );
}

function CallItem({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[call.status] ?? STATUS_META.completed;
  const Icon = meta.icon;
  const duration = formatDuration(call.durationSec);
  const hasDetail = !!(call.summary || call.transcript || call.recordingUrl);

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-800/40">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left ${hasDetail ? 'hover:bg-zinc-800/60' : 'cursor-default'}`}
      >
        <Icon size={15} className={`mt-0.5 shrink-0 ${meta.cls} ${call.status === 'initiated' || call.status === 'connecting' ? 'animate-spin' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${meta.cls}`}>{meta.label}</span>
            <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">
              {call.provider === 'ycloud_whatsapp' ? 'WhatsApp' : 'IA'}
            </span>
            {duration && <span className="text-[10px] text-zinc-500">· {duration}</span>}
            <span className="ml-auto text-[10px] text-zinc-600">{formatMessageTime(call.createdAt)}</span>
          </div>
          {call.summary && (
            <p className={`mt-1 text-xs text-zinc-400 ${open ? '' : 'line-clamp-2'}`}>{call.summary}</p>
          )}
          {call.outcome && (
            <span className="mt-1.5 inline-block rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">{call.outcome}</span>
          )}
        </div>
        {hasDetail && (
          <ChevronDown size={14} className={`mt-0.5 shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-800 px-3 py-2.5">
          {call.recordingUrl && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-600">
                <Play size={11} /> Grabación
              </p>
              <audio controls preload="none" src={call.recordingUrl} className="h-8 w-full">
                <a href={call.recordingUrl} target="_blank" rel="noreferrer" className="text-[11px] text-violet-300">
                  Descargar grabación
                </a>
              </audio>
            </div>
          )}
          {call.transcript && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-600">Transcripción</p>
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{call.transcript}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
