import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { formatPhone } from '@/shared/utils/formatPhone';
import {
  getCurrentPushTokenId,
  getPushNotificationStatus,
  isExpiredPushTokenError,
  registerInboxPushToken,
  sendTestPushNotification,
  sendTestPushToDevice,
  type PushNotificationStatus,
} from '../services/notifications.service';
import { useLeads } from '../hooks/useLeads';
import { useLocalReadReceipts } from '../hooks/useLocalReadReceipts';
import type { Lead } from '../types';
import { countUnreadLeads } from '../utils/readState';

interface InboxEvent {
  id:        string;
  leadId:    string;
  title:     string;
  body:      string;
  createdAt: number;
}

function leadName(lead: Lead): string {
  return lead.name?.trim() || formatPhone(lead.phone);
}

function inboundMillis(lead: Lead): number {
  return lead.lastInboundAt?.toMillis?.() ?? 0;
}

function playInboxTone() {
  try {
    const AudioContextClass = window.AudioContext || (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(520, audioContext.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.2);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.22);
    window.setTimeout(() => audioContext.close().catch(() => {}), 350);
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isStandaloneWebApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function notificationStatusText(
  permission: NotificationPermission,
  status: PushNotificationStatus | null,
  currentDeviceRegistered: boolean
): string {
  if (isIos() && !isStandaloneWebApp()) {
    return 'En iPhone instala el CRM en pantalla de inicio para activar notificaciones web.';
  }

  if (permission === 'granted') {
    if (currentDeviceRegistered) return 'Este dispositivo ya recibe notificaciones.';
    return status?.tokenCount
      ? `${status.tokenCount} dispositivo(s) registrado(s), pero falta este dispositivo.`
      : 'Permiso activo, falta registrar este navegador.';
  }

  if (permission === 'denied') {
    return 'El navegador tiene las notificaciones bloqueadas. Activalas desde permisos del sitio.';
  }

  return 'Activa los avisos para recibir mensajes fuera del CRM.';
}

function showNativeNotification(event: InboxEvent) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notification = new Notification(event.title, {
    body: event.body,
    icon: '/icon.svg',
    tag: event.leadId,
  });

  notification.onclick = () => {
    window.focus();
    window.location.assign(`/dashboard/inbox?lead=${event.leadId}`);
    notification.close();
  };
}

export function InboxNotifications() {
  const navigate = useNavigate();
  const { companyId, user } = useAuth();
  const { leads } = useLeads(companyId, 500, { uid: user?.uid ?? null, role: 'advisor' });
  const localReadAt = useLocalReadReceipts();
  const [event, setEvent] = useState<InboxEvent | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushNotificationStatus | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [repairingPush, setRepairingPush] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [currentTokenId, setCurrentTokenId] = useState<string | null>(() => getCurrentPushTokenId());
  const knownRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const originalTitleRef = useRef(document.title);

  const visibleLeads = useMemo(() => {
    if (!user?.uid) return leads;
    return leads.map((lead) => {
      const readAtMillis = localReadAt[lead.id];
      if (!readAtMillis) return lead;

      const remoteReadAt = lead.readBy?.[user.uid]?.toMillis?.() ?? 0;
      if (remoteReadAt >= readAtMillis) return lead;

      return {
        ...lead,
        readBy: {
          ...(lead.readBy ?? {}),
          [user.uid]: Timestamp.fromMillis(readAtMillis),
        },
      };
    });
  }, [leads, localReadAt, user?.uid]);
  const leadsById = useMemo(() => new Map(visibleLeads.map((lead) => [lead.id, lead])), [visibleLeads]);
  const unreadCount = useMemo(() => countUnreadLeads(visibleLeads, user?.uid), [visibleLeads, user?.uid]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      document.title = originalTitleRef.current;
    };
  }, []);

  useEffect(() => {
    if (!companyId || permission !== 'granted') return;
    registerInboxPushToken(companyId)
      .then(() => getPushNotificationStatus(companyId))
      .then((nextStatus) => {
        setCurrentTokenId(getCurrentPushTokenId());
        setPushStatus(nextStatus);
      })
      .then(() => setRegistrationError(null))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'No se pudo registrar este navegador.';
        setRegistrationError(message);
        console.warn('[Notifications] No se pudo registrar push token:', err);
      });
  }, [companyId, permission]);

  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${originalTitleRef.current}`;
      return;
    }

    document.title = originalTitleRef.current;
  }, [unreadCount]);

  useEffect(() => {
    const nextKnown = new Map<string, number>();
    const nextEvents: InboxEvent[] = [];

    for (const lead of visibleLeads) {
      const lastInbound = inboundMillis(lead);
      nextKnown.set(lead.id, lastInbound);

      if (!initializedRef.current || lastInbound === 0) continue;

      const previousInbound = knownRef.current.get(lead.id);
      if (previousInbound === undefined) continue;

      if (lastInbound > previousInbound) {
        nextEvents.push({
          id: `${lead.id}-${lastInbound}`,
          leadId: lead.id,
          title: 'Nuevo mensaje',
          body: `${leadName(lead)}: ${lead.lastMessageText ?? 'Mensaje entrante'}`,
          createdAt: lastInbound,
        });
      }
    }

    knownRef.current = nextKnown;

    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    const latest = nextEvents.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return;

    setEvent(latest);
    playInboxTone();
    showNativeNotification(latest);

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setEvent(null), 7000);
  }, [visibleLeads]);

  const openLead = (leadId: string) => {
    setEvent(null);
    navigate(`/dashboard/inbox?lead=${leadId}`);
  };

  const requestPermission = async () => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    if (nextPermission === 'granted' && companyId) {
      await registerInboxPushToken(companyId)
        .then(() => getPushNotificationStatus(companyId))
        .then((nextStatus) => {
          setCurrentTokenId(getCurrentPushTokenId());
          setPushStatus(nextStatus);
        })
        .then(() => setRegistrationError(null))
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'No se pudo registrar este navegador.';
          setRegistrationError(message);
          console.warn('[Notifications] No se pudo registrar push token:', err);
        });
    }
  };

  const refreshPushStatus = async () => {
    if (!companyId) return;
    const nextStatus = await getPushNotificationStatus(companyId);
    setCurrentTokenId(getCurrentPushTokenId());
    setPushStatus(nextStatus);
  };

  const repairPushRegistration = async () => {
    if (!companyId) return;
    setRepairingPush(true);
    setTestSent(false);
    try {
      await registerInboxPushToken(companyId, { forceRefresh: true });
      await refreshPushStatus();
      setRegistrationError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo reparar este dispositivo.';
      setRegistrationError(message);
    } finally {
      setRepairingPush(false);
    }
  };

  const testPush = async () => {
    if (!companyId) return;
    setTestingPush(true);
    setTestSent(false);
    try {
      if (currentTokenId) {
        try {
          await sendTestPushToDevice(companyId, currentTokenId);
        } catch (err) {
          const missingToken = err instanceof Error && err.message.toLowerCase().includes('no tiene token registrado');
          if (!isExpiredPushTokenError(err) && !missingToken) throw err;

          setRegistrationError(null);
          await registerInboxPushToken(companyId, { forceRefresh: true });
          const renewedTokenId = getCurrentPushTokenId();
          if (!renewedTokenId) {
            throw new Error('No se pudo generar un token nuevo para este dispositivo.');
          }

          setCurrentTokenId(renewedTokenId);
          await sendTestPushToDevice(companyId, renewedTokenId);
        }
      } else {
        await registerInboxPushToken(companyId, { forceRefresh: true });
        const renewedTokenId = getCurrentPushTokenId();
        if (renewedTokenId) {
          setCurrentTokenId(renewedTokenId);
          await sendTestPushToDevice(companyId, renewedTokenId);
        } else {
          await sendTestPushNotification(companyId);
        }
      }
      setTestSent(true);
      await refreshPushStatus();
      setRegistrationError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar la prueba a este dispositivo.';
      setRegistrationError(message);
      await refreshPushStatus().catch(() => {});
    } finally {
      setTestingPush(false);
    }
  };

  const currentDeviceRegistered = !!currentTokenId && !!pushStatus?.devices.some((device) => device.id === currentTokenId);
  const currentDevice = currentTokenId
    ? pushStatus?.devices.find((device) => device.id === currentTokenId)
    : undefined;
  const showSetupPanel =
    (!isIos() || isStandaloneWebApp()) && (
      permission !== 'granted' ||
      !!registrationError ||
      !!currentDevice?.lastPushErrorCode ||
      (permission === 'granted' && pushStatus !== null && !currentDeviceRegistered)
    );
  const canUseWebPushHere = !isIos() || isStandaloneWebApp();
  const showAndroidRegisteredPanel = isAndroid() && permission === 'granted' && currentDeviceRegistered;

  const lead = event ? leadsById.get(event.leadId) : undefined;

  useEffect(() => {
    if (!companyId || permission !== 'granted' || !currentDevice?.lastPushErrorCode) return;
    const errorText = `${currentDevice.lastPushErrorCode} ${currentDevice.lastPushErrorMessage ?? ''}`;
    if (!isExpiredPushTokenError(new Error(errorText))) return;

    registerInboxPushToken(companyId, { forceRefresh: true })
      .then(() => getPushNotificationStatus(companyId))
      .then((nextStatus) => {
        setCurrentTokenId(getCurrentPushTokenId());
        setPushStatus(nextStatus);
        setRegistrationError(null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'No se pudo renovar este dispositivo.';
        setRegistrationError(message);
      });
  }, [companyId, currentDevice?.lastPushErrorCode, currentDevice?.lastPushErrorMessage, permission]);

  useEffect(() => {
    if (!companyId || permission !== 'granted' || pushStatus === null) return;
    if (!currentTokenId || currentDeviceRegistered) return;

    registerInboxPushToken(companyId, { forceRefresh: true })
      .then(() => getPushNotificationStatus(companyId))
      .then((nextStatus) => {
        setCurrentTokenId(getCurrentPushTokenId());
        setPushStatus(nextStatus);
        setRegistrationError(null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'No se pudo renovar este dispositivo.';
        setRegistrationError(message);
      });
  }, [companyId, currentDeviceRegistered, currentTokenId, permission, pushStatus]);

  return (
    <>
      {(showSetupPanel || showAndroidRegisteredPanel) && (
        <div className="fixed bottom-16 right-3 z-[90] w-[min(360px,calc(100vw-1.5rem))] md:bottom-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-zinc-100">Notificaciones</p>
                <p className="mt-0.5 text-zinc-500">
                  {notificationStatusText(permission, pushStatus, currentDeviceRegistered)}
                </p>
                {registrationError && <p className="mt-1 text-red-300">{registrationError}</p>}
                {!registrationError && currentDevice?.lastPushErrorCode && (
                  <p className="mt-1 text-red-300">
                    Ultimo error: {currentDevice.lastPushErrorCode}
                  </p>
                )}
                {testSent && <p className="mt-1 text-emerald-300">Prueba enviada. Debe aparecer como aviso del navegador.</p>}
              </div>
              {showAndroidRegisteredPanel && (
                <button
                  type="button"
                  onClick={() => setPushStatus(null)}
                  className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="Ocultar estado de notificaciones"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {canUseWebPushHere && permission === 'default' && (
                <button
                  type="button"
                  onClick={requestPermission}
                  className="rounded-md bg-violet-500 px-3 py-1.5 font-medium text-white hover:bg-violet-400"
                >
                  Permitir
                </button>
              )}
              {canUseWebPushHere && permission === 'granted' && (
                <>
                  <button
                    type="button"
                    onClick={refreshPushStatus}
                    disabled={repairingPush || testingPush}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
                  >
                    Revisar
                  </button>
                  <button
                    type="button"
                    onClick={repairPushRegistration}
                    disabled={repairingPush || testingPush}
                    className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-60"
                  >
                    {repairingPush ? 'Reparando...' : 'Reparar'}
                  </button>
                  <button
                    type="button"
                    onClick={testPush}
                    disabled={testingPush || repairingPush}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {testingPush ? 'Enviando...' : 'Probar'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {event && (
        <div className="fixed right-4 top-4 z-[100] w-[min(360px,calc(100vw-2rem))]">
          <div className="overflow-hidden rounded-lg border border-violet-500/30 bg-zinc-950 shadow-2xl shadow-black/40">
            <button
              type="button"
              onClick={() => openLead(event.leadId)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100">{event.title}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-400">{event.body}</span>
                {lead?.inboxId && (
                  <span className="mt-1 block text-[10px] text-zinc-500">Bandeja: {formatPhone(lead.inboxId)}</span>
                )}
              </span>
            </button>

            <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-2">
              <span className="text-[11px] text-zinc-500">{unreadCount} sin leer</span>

              <button
                type="button"
                onClick={() => setEvent(null)}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Cerrar notificacion"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
