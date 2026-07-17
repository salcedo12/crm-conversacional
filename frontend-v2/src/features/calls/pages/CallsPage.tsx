import { useCallback, useEffect, useState } from 'react';
import {
  PhoneCall, PhoneMissed, PhoneIncoming, Voicemail, PhoneForwarded, PhoneOff, Loader2,
  RefreshCw, Play, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Spinner } from '@/shared/components/Spinner';
import { formatPhone } from '@/shared/utils/formatPhone';
import { listRecentCalls, type RecentCall, type CallStatus } from '@/features/leads/services/calls.service';

const STATUS_META: Record<CallStatus, { label: string; icon: typeof PhoneCall; cls: string }> = {
  initiated:   { label: 'Marcando…',    icon: Loader2,        cls: 'text-violet-300' },
  ringing:      { label: 'Sonando…',     icon: PhoneIncoming,  cls: 'text-emerald-300' },
  connecting:   { label: 'Conectando…',  icon: Loader2,        cls: 'text-violet-300' },
  'in-progress': { label: 'En curso',   icon: PhoneCall,      cls: 'text-emerald-300' },
  missed:       { label: 'Perdida',      icon: PhoneMissed,    cls: 'text-amber-300' },
  rejected:     { label: 'Rechazada',    icon: PhoneOff,       cls: 'text-red-300' },
  completed:   { label: 'Completada',   icon: PhoneCall,      cls: 'text-emerald-300' },
  'no-answer': { label: 'Sin respuesta', icon: PhoneMissed,   cls: 'text-amber-300' },
  voicemail:   { label: 'Buzón de voz', icon: Voicemail,      cls: 'text-sky-300' },
  busy:        { label: 'Ocupado',      icon: PhoneOff,       cls: 'text-amber-300' },
  failed:      { label: 'Fallida',      icon: PhoneOff,       cls: 'text-red-300' },
  transferred: { label: 'Transferida',  icon: PhoneForwarded, cls: 'text-sky-300' },
};

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function CallsPage() {
  const { companyId } = useAuth();
  const [calls, setCalls]     = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setCalls(await listRecentCalls(companyId));
    } catch (err) {
      console.error('[CallsPage]', err);
      setError('No se pudo cargar el historial de llamadas.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <PhoneCall size={18} className="text-emerald-300" /> Llamadas IA
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500">Historial de llamadas realizadas por el agente de voz</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && calls.length === 0 ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <PhoneCall size={32} className="mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-400">Aún no hay llamadas con IA registradas.</p>
            <p className="mt-1 max-w-sm text-xs text-zinc-600">
              Cuando el agente de voz realice llamadas, aparecerán aquí con su resumen y transcripción.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-[11px] uppercase text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">Contacto</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Duración</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Resultado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const meta = STATUS_META[call.status] ?? STATUS_META.completed;
                  const Icon = meta.icon;
                  const open = expanded === call.id;
                  const hasDetail = !!(call.summary || call.transcript || call.recordingUrl);
                  return (
                    <CallRow
                      key={call.id}
                      call={call}
                      meta={meta}
                      Icon={Icon}
                      open={open}
                      hasDetail={hasDetail}
                      onToggle={() => setExpanded(open ? null : call.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CallRow({
  call, meta, Icon, open, hasDetail, onToggle,
}: {
  call: RecentCall;
  meta: { label: string; cls: string };
  Icon: typeof PhoneCall;
  open: boolean;
  hasDetail: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={() => hasDetail && onToggle()}
        className={`border-b border-zinc-800/60 ${hasDetail ? 'cursor-pointer hover:bg-zinc-800/40' : ''}`}
      >
        <td className="px-4 py-3">
          <p className="truncate font-medium text-zinc-200">{call.leadName}</p>
          {call.leadPhone && <p className="text-[11px] text-zinc-500">{formatPhone(call.leadPhone)}</p>}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1.5 text-xs ${meta.cls}`}>
            <Icon size={14} className={call.status === 'initiated' ? 'animate-spin' : ''} /> {meta.label}
          </span>
        </td>
        <td className="hidden px-4 py-3 text-xs text-zinc-400 sm:table-cell">{formatDuration(call.durationSec)}</td>
        <td className="hidden px-4 py-3 md:table-cell">
          {call.outcome
            ? <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">{call.outcome}</span>
            : <span className="text-xs text-zinc-600">—</span>}
        </td>
        <td className="px-4 py-3 text-right text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            {formatDate(call.createdAt)}
            {hasDetail && <ChevronDown size={13} className={`text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />}
          </span>
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="border-b border-zinc-800/60 bg-zinc-900/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-2.5">
              {call.summary && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-600">Resumen</p>
                  <p className="text-xs text-zinc-300">{call.summary}</p>
                </div>
              )}
              {call.recordingUrl && (
                <a
                  href={call.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] text-violet-300 hover:text-violet-200"
                >
                  <Play size={12} /> Escuchar grabación
                </a>
              )}
              {call.transcript && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-600">Transcripción</p>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{call.transcript}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
