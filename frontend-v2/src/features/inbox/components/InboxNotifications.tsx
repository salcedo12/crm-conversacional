import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { MessageCircle, UserRoundPlus, X } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { formatPhone } from '@/shared/utils/formatPhone';
import { registerInboxPushToken } from '../services/notifications.service';
import { useLeads } from '../hooks/useLeads';
import { useLocalReadReceipts } from '../hooks/useLocalReadReceipts';
import type { Lead } from '../types';
import { countUnreadLeads } from '../utils/readState';

type InboxEventKind = 'new-lead' | 'new-message';

interface InboxEvent {
  id:        string;
  leadId:    string;
  kind:      InboxEventKind;
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

function createdMillis(lead: Lead): number {
  return lead.createdAt?.toMillis?.() ?? 0;
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

function showBrowserNotification(event: InboxEvent) {
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
    registerInboxPushToken(companyId).catch((err) => {
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
      if (previousInbound === undefined) {
        nextEvents.push({
          id: `${lead.id}-${lastInbound || createdMillis(lead)}`,
          leadId: lead.id,
          kind: 'new-lead',
          title: 'Nuevo lead asignado',
          body: `${leadName(lead)} entro a tu bandeja.`,
          createdAt: Math.max(lastInbound, createdMillis(lead)),
        });
        continue;
      }

      if (lastInbound > previousInbound) {
        nextEvents.push({
          id: `${lead.id}-${lastInbound}`,
          leadId: lead.id,
          kind: 'new-message',
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
    showBrowserNotification(latest);

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
      await registerInboxPushToken(companyId).catch((err) => {
        console.warn('[Notifications] No se pudo registrar push token:', err);
      });
    }
  };

  if (!event) return null;

  const Icon = event.kind === 'new-lead' ? UserRoundPlus : MessageCircle;
  const lead = leadsById.get(event.leadId);

  return (
    <div className="fixed right-4 top-4 z-[100] w-[min(360px,calc(100vw-2rem))]">
      <div className="overflow-hidden rounded-lg border border-violet-500/30 bg-zinc-950 shadow-2xl shadow-black/40">
        <button
          type="button"
          onClick={() => openLead(event.leadId)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
            <Icon className="h-4 w-4" />
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
          {permission === 'default' ? (
            <button
              type="button"
              onClick={requestPermission}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-violet-300 hover:bg-violet-500/10"
            >
              Permitir notificaciones
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500">{unreadCount} sin leer</span>
          )}

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
  );
}
