import { useEffect, useState, useCallback } from 'react';
import { Button }  from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { startGoogleAuth, getGoogleConnection, disconnectGoogle } from '../services/calendar.service';

interface Props { companyId: string }

export function GoogleConnectionPanel({ companyId }: Props) {
  const [loading,   setLoading]   = useState(true);
  const [connected, setConnected] = useState(false);
  const [email,     setEmail]     = useState<string | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await getGoogleConnection(companyId);
      setConnected(r.connected);
      setEmail(r.email);
    } catch {
      setError('No se pudo cargar el estado de la conexión.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Mostrar resultado del callback OAuth (?google=connected|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'error') setError('No se pudo conectar con Google. Intenta de nuevo.');
    if (g === 'connected' || g === 'error') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startGoogleAuth(companyId);
      window.location.href = url; // redirige a la pantalla de consentimiento de Google
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo iniciar la conexión.');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar tu Google Calendar? Las citas dejarán de crearse en tu calendario.')) return;
    setBusy(true);
    try {
      await disconnectGoogle(companyId);
      await load();
    } catch {
      setError('No se pudo desconectar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Calendarios */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-zinc-100">Calendarios</h3>
        <p className="text-xs text-zinc-500 mt-0.5 mb-4">
          Conecta tu Google Calendar para que las citas agendadas (por la IA o manualmente) se creen automáticamente y se eviten cruces.
        </p>

        <div className="flex items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3">
          <span className="text-2xl">📅</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-100">Google Calendar</p>
            {loading ? (
              <p className="text-xs text-zinc-500">Cargando…</p>
            ) : connected ? (
              <p className="text-xs text-green-400 truncate">Conectado · {email}</p>
            ) : (
              <p className="text-xs text-zinc-500">Conecta tu cuenta de Google (Gmail de la empresa)</p>
            )}
          </div>
          {loading ? <Spinner /> : connected ? (
            <Button variant="secondary" size="sm" onClick={handleDisconnect} disabled={busy}>Desconectar</Button>
          ) : (
            <Button size="sm" onClick={handleConnect} loading={busy} disabled={busy}>Conectar</Button>
          )}
        </div>
      </section>

      {/* Videoconferencia */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-zinc-100">Videoconferencia</h3>
        <p className="text-xs text-zinc-500 mt-0.5 mb-4">
          Se genera un enlace único de Google Meet cada vez que se agenda una cita.
        </p>

        {!connected && !loading && (
          <div className="mb-3 rounded-lg bg-amber-500/8 border border-amber-500/20 px-4 py-2.5">
            <p className="text-xs text-amber-300">⚠️ Google Meet requiere que Google Calendar esté conectado.</p>
          </div>
        )}

        <div className="flex items-center gap-4 rounded-lg border border-zinc-800 px-4 py-3">
          <span className="text-2xl">🎥</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-100">Google Meet</p>
            <p className="text-xs text-zinc-500">
              {connected ? 'Activo — se crea un enlace por cada cita' : 'Conecta Google Calendar para activarlo'}
            </p>
          </div>
          {connected && <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-300 border border-green-500/20">Activo</span>}
        </div>
      </section>
    </div>
  );
}
