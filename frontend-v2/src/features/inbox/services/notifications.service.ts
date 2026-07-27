import { FieldPath, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getMessaging, getToken, isSupported, type GetTokenOptions } from 'firebase/messaging';
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
}, { ok: true }>(functions, 'registerPushToken');

const readMarkAttempts = new Set<string>();
const pushTokenAttempts = new Set<string>();

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

export async function registerInboxPushToken(companyId: string): Promise<boolean> {
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

  if (!vapidKey || missingConfig.length > 0) {
    return false;
  }

  const attemptKey = `${companyId}:${config.projectId}`;
  if (pushTokenAttempts.has(attemptKey)) return false;
  pushTokenAttempts.add(attemptKey);

  const params = new URLSearchParams(
    Object.entries(config).filter(([, value]) => !!value) as [string, string][]
  );
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${params.toString()}`,
    { scope: '/firebase-cloud-messaging-push-scope' }
  );
  const messaging = getMessaging(app);
  const tokenOptions: GetTokenOptions = {
    serviceWorkerRegistration: registration,
    ...(vapidKey ? { vapidKey } : {}),
  };
  const token = await getToken(messaging, tokenOptions);

  if (!token) return false;

  await _registerPushToken({
    companyId,
    token,
    platform: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile-web' : 'desktop-web',
  });

  return true;
}
