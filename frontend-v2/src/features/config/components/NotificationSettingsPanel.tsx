import { useEffect, useState } from 'react';
import {
  getCurrentPushTokenId,
  getPushNotificationStatus,
  registerInboxPushToken,
  sendTestPushToDevice,
  type PushNotificationStatus,
} from '@/features/inbox/services/notifications.service';

interface NotificationSettingsPanelProps {
  companyId: string;
}

function permissionLabel(permission: NotificationPermission): string {
  if (permission === 'granted') return 'Permiso activo';
  if (permission === 'denied') return 'Bloqueadas en este dispositivo';
  return 'Sin activar';
}

export function NotificationSettingsPanel({ companyId }: NotificationSettingsPanelProps) {
  const [permission, setPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [status, setStatus] = useState<PushNotificationStatus | null>(null);
  const [currentTokenId, setCurrentTokenId] = useState<string | null>(() => getCurrentPushTokenId());
  const [busy, setBusy] = useState<'load' | 'allow' | 'repair' | 'test' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDevice = currentTokenId
    ? status?.devices.find((device) => device.id === currentTokenId)
    : undefined;
  const isRegistered = !!currentDevice;

  const refresh = async () => {
    setBusy('load');
    setError(null);
    try {
      const nextStatus = await getPushNotificationStatus(companyId);
      setCurrentTokenId(getCurrentPushTokenId());
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revisar este dispositivo.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (permission === 'granted') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, permission]);

  const allow = async () => {
    if (!('Notification' in window)) {
      setError('Este navegador no soporta notificaciones.');
      return;
    }

    setBusy('allow');
    setError(null);
    setMessage(null);
    try {
      const nextPermission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      setPermission(nextPermission);
      if (nextPermission !== 'granted') {
        setError('Las notificaciones no quedaron permitidas en este dispositivo.');
        return;
      }
      await registerInboxPushToken(companyId, { forceRefresh: true });
      await refresh();
      setMessage('Notificaciones activadas en este dispositivo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron activar las notificaciones.');
    } finally {
      setBusy(null);
    }
  };

  const repair = async () => {
    setBusy('repair');
    setError(null);
    setMessage(null);
    try {
      await registerInboxPushToken(companyId, { forceRefresh: true });
      await refresh();
      setMessage('Dispositivo reparado. Ya puedes probar la notificacion.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reparar este dispositivo.');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setError(null);
    setMessage(null);
    try {
      let tokenId = currentTokenId;
      if (!tokenId || !isRegistered) {
        await registerInboxPushToken(companyId, { forceRefresh: true });
        tokenId = getCurrentPushTokenId();
        setCurrentTokenId(tokenId);
      }
      if (!tokenId) throw new Error('No hay dispositivo registrado para probar.');
      await sendTestPushToDevice(companyId, tokenId);
      await refresh();
      setMessage('Prueba enviada. Debe aparecer como notificacion del iPhone.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la prueba.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Notificaciones de este dispositivo</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Estado: <span className="text-zinc-300">{permissionLabel(permission)}</span>
            {permission === 'granted' && (
              <span> · {isRegistered ? 'dispositivo registrado' : 'falta registrar este dispositivo'}</span>
            )}
          </p>
          {currentDevice?.lastPushErrorCode && (
            <p className="mt-1 text-xs text-red-300">
              Ultimo error: {currentDevice.lastPushErrorCode}
            </p>
          )}
          {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {permission !== 'granted' && (
          <button
            type="button"
            onClick={allow}
            disabled={busy !== null}
            className="rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-60"
          >
            {busy === 'allow' ? 'Activando...' : 'Permitir'}
          </button>
        )}
        <button
          type="button"
          onClick={repair}
          disabled={permission !== 'granted' || busy !== null}
          className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-60"
        >
          {busy === 'repair' ? 'Reparando...' : 'Reparar'}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={permission !== 'granted' || busy !== null}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy === 'test' ? 'Enviando...' : 'Probar'}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={permission !== 'granted' || busy !== null}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
        >
          {busy === 'load' ? 'Revisando...' : 'Revisar'}
        </button>
      </div>
    </section>
  );
}
