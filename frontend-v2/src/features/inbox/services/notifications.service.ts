import { FieldPath, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { deleteToken, getMessaging, getToken, isSupported, type GetTokenOptions } from 'firebase/messaging';
import app, { auth, db, functions } from '@/config/firebase';

const _markLeadRead = httpsCallable<{ companyId: string; leadId: string }, { ok: true }>(
  functions,
  'markLeadRead'
);

const _markLeadsRead = httpsCallable<{ companyId: string; leadIds: string[] }, { updated: number }>(
  functions,
  'markLeadsRead'
);

const _registerPushToken = httpsCallable<{
  companyId: string;
  token:     string;
  platform:  string;
}, { ok: true; tokenId: string }>(functions, 'registerPushToken');

export interface PushNotificationStatus {
  tokenCount: number;
  devices: {
    id: string;
    platform: string;
    updatedAt: number | null;
    userAgent: string;
    lastPushAttemptAt?: number | null;
    lastPushSuccessAt?: number | null;
    lastPushErrorAt?: number | null;
    lastPushErrorCode?: string | null;
    lastPushErrorMessage?: string | null;
  }[];
}

const _getPushNotificationStatus = httpsCallable<{ companyId: string }, PushNotificationStatus>(
  functions,
  'getPushNotificationStatus'
);

const _sendTestPushNotification = httpsCallable<{ companyId: string }, { ok: true }>(
  functions,
  'sendTestPushNotification'
);

const _sendTestPushToDevice = httpsCallable<
  { companyId: string; tokenId: string },
  { ok: true; messageId: string }
>(
  functions,
  'sendTestPushToDevice'
);

const readMarkAttempts = new Set<string>();
const pushTokenAttempts = new Set<string>();

const CURRENT_PUSH_TOKEN_KEY = 'meraki:currentPushTokenId';

export function getCurrentPushTokenId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setCurrentPushTokenId(tokenId: string): void {
  try {
    window.localStorage.setItem(CURRENT_PUSH_TOKEN_KEY, tokenId);
  } catch {
    // localStorage can be unavailable in some privacy modes.
  }
}

function clearCurrentPushTokenId(): void {
  try {
    window.localStorage.removeItem(CURRENT_PUSH_TOKEN_KEY);
  } catch {
    // localStorage can be unavailable in some privacy modes.
  }
}

async function unregisterOldAppShellServiceWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(async (registration) => {
    const scriptUrl = registration.active?.scriptURL
      || registration.waiting?.scriptURL
      || registration.installing?.scriptURL
      || '';

    if (scriptUrl.includes('/sw.js')) {
      await registration.unregister();
    }
  }));
}

async function waitForActiveServiceWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active?.scriptURL.includes('/firebase-messaging-sw.js')) return registration;

  const worker = registration.installing || registration.waiting;
  if (!worker) {
    await navigator.serviceWorker.ready;
    return registration;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('El service worker no se activo a tiempo.')), 8000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timer);
        resolve();
      }
    });
  });

  return registration;
}

async function clearMessagingTokenCache(): Promise<void> {
  if (!('indexedDB' in window)) return;

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.open('firebase-messaging-database');

    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve();
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('firebase-messaging-store')) {
        database.close();
        resolve();
        return;
      }

      const transaction = database.transaction('firebase-messaging-store', 'readwrite');
      transaction.objectStore('firebase-messaging-store').clear();
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        resolve();
      };
    };
  });
}

function mobileWebPlatform(): string {
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) return 'ios-web';
  if (/Android/i.test(navigator.userAgent)) return 'android-web';
  if (/Mobi/i.test(navigator.userAgent)) return 'mobile-web';
  return 'desktop-web';
}

export async function markLeadRead(companyId: string, leadId: string, readAtMillis = 0): Promise<void> {
  const attemptKey = `${companyId}:${leadId}:${readAtMillis}`;
  if (readMarkAttempts.has(attemptKey)) return;
  readMarkAttempts.add(attemptKey);

  try {
    await _markLeadRead({ companyId, leadId });
    return;
  } catch (err) {
    console.warn('[Notifications] markLeadRead callable fallo:', err);
  }

  if (import.meta.env.VITE_ENABLE_DIRECT_READ_RECEIPT_FALLBACK !== 'true') return;

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('No hay usuario autenticado para marcar lectura.');

  await updateDoc(
    doc(db, 'companies', companyId, 'leads', leadId),
    new FieldPath('readBy', uid),
    serverTimestamp()
  );
}

/** Marca varios leads como leídos en el servidor (para "marcar todo como leído"). */
export async function markLeadsRead(companyId: string, leadIds: string[]): Promise<void> {
  if (!leadIds.length) return;
  const chunkSize = 400; // el backend hace un batch de Firestore (< 500 writes)
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    await _markLeadsRead({ companyId, leadIds: leadIds.slice(i, i + chunkSize) });
  }
}

export async function registerInboxPushToken(
  companyId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<boolean> {
  if (!companyId || !('Notification' in window) || !('serviceWorker' in navigator)) return false;
  if (Notification.permission !== 'granted') return false;
  if (!(await isSupported())) return false;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  const config = {
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  };
  const missingConfig = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingConfig.length > 0) {
    throw new Error(`Faltan variables de Firebase para notificaciones: ${missingConfig.join(', ')}`);
  }

  if (!vapidKey) {
    throw new Error('Falta VITE_FIREBASE_VAPID_KEY. Sin esta llave el navegador no puede registrar el token push.');
  }

  const attemptKey = `${companyId}:${config.projectId}`;
  if (pushTokenAttempts.has(attemptKey) && !options.forceRefresh) return false;

  const params = new URLSearchParams(
    Object.entries(config).filter(([, value]) => !!value) as [string, string][]
  );

  await unregisterOldAppShellServiceWorkers();

  const registration = await waitForActiveServiceWorker(await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${params.toString()}`,
    { scope: '/' }
  ));
  const messaging = getMessaging(app);
  if (options.forceRefresh) {
    pushTokenAttempts.delete(attemptKey);
    clearCurrentPushTokenId();
    await deleteToken(messaging).catch((err) => {
      console.warn('[Notifications] No se pudo borrar el token push vencido:', err);
    });
    const staleSubscription = await registration.pushManager.getSubscription().catch(() => null);
    await staleSubscription?.unsubscribe().catch((err) => {
      console.warn('[Notifications] No se pudo cancelar la suscripcion push vencida:', err);
    });
    await clearMessagingTokenCache();
  }

  const tokenOptions: GetTokenOptions = {
    serviceWorkerRegistration: registration,
    ...(vapidKey ? { vapidKey } : {}),
  };
  const token = await getToken(messaging, tokenOptions);

  if (!token) return false;

  const result = await _registerPushToken({
    companyId,
    token,
    platform: mobileWebPlatform(),
  });

  setCurrentPushTokenId(result.data.tokenId);
  pushTokenAttempts.add(attemptKey);
  return true;
}

export function isExpiredPushTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  return normalized.includes('registration-token-not-registered')
    || normalized.includes('notregistered')
    || normalized.includes('token-not-registered');
}

export async function getPushNotificationStatus(companyId: string): Promise<PushNotificationStatus> {
  const r = await _getPushNotificationStatus({ companyId });
  return r.data;
}

export async function sendTestPushNotification(companyId: string): Promise<void> {
  await _sendTestPushNotification({ companyId });
}

export async function sendTestPushToDevice(companyId: string, tokenId: string): Promise<void> {
  await _sendTestPushToDevice({ companyId, tokenId });
}
