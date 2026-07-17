import { useEffect, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { formatPhone } from '@/shared/utils/formatPhone';
import { useRingingCalls } from '../hooks/useRingingCalls';
import { useCallSession } from '../providers/CallSessionProvider';

/**
 * Overlay global de llamadas de voz WhatsApp: banner de "llamada entrante" +
 * barra de llamada activa. Se monta una sola vez en el layout del dashboard
 * para que sobreviva la navegación entre páginas.
 */
export function CallOverlay() {
  const { user, companyId, role } = useAuth();
  const isAdmin = isAdminRole(role);
  const ringingCalls = useRingingCalls(companyId, user?.uid ?? null, isAdmin);
  const session = useCallSession();
  const [answering, setAnswering] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const incomingCall = session.state === 'idle' ? ringingCalls[0] : undefined;

  useEffect(() => {
    if (session.state !== 'in-call') { setElapsed(0); return; }
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [session.state]);

  if (!companyId) return null;

  const handleAnswer = async () => {
    if (!incomingCall || answering) return;
    setAnswering(true);
    try {
      await session.answerInboundCall(companyId, incomingCall);
    } finally {
      setAnswering(false);
    }
  };

  const handleReject = async () => {
    if (!incomingCall) return;
    setRejectingId(incomingCall.id);
    try {
      await session.rejectInboundCall(companyId, incomingCall);
    } finally {
      setRejectingId(null);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <>
      <audio ref={session.remoteAudioRef} autoPlay />

      {incomingCall && (
        <div className="fixed inset-x-0 top-4 z-[100] mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-emerald-500/30 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Phone size={18} className="animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              {incomingCall.leadName ?? formatPhone(incomingCall.leadPhone ?? '')}
            </p>
            <p className="text-[11px] text-zinc-500">Llamada de WhatsApp entrante</p>
          </div>
          <button
            onClick={handleReject}
            disabled={rejectingId === incomingCall.id}
            title="Rechazar"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
          >
            <PhoneOff size={16} />
          </button>
          <button
            onClick={handleAnswer}
            disabled={answering}
            title="Contestar"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            <Phone size={16} />
          </button>
        </div>
      )}

      {(session.state === 'connecting' || session.state === 'in-call') && session.activeCall && (
        <div className="fixed inset-x-0 bottom-4 z-[100] mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              {session.activeCall.leadName ?? formatPhone(session.activeCall.leadPhone ?? '')}
            </p>
            <p className="text-[11px] text-zinc-500">
              {session.state === 'connecting' ? 'Conectando…' : `${mm}:${ss}`}
            </p>
          </div>
          <button
            onClick={session.toggleMute}
            title={session.muted ? 'Reactivar micrófono' : 'Silenciar'}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${session.muted ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          >
            {session.muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            onClick={session.hangUp}
            title="Colgar"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-400 transition-colors hover:bg-red-500/25"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      )}

      {session.error && (
        <div className="fixed inset-x-0 bottom-20 z-[100] mx-auto w-full max-w-sm rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-300">
          {session.error}
        </div>
      )}
    </>
  );
}
