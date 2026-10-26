import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage }   from 'firebase-admin/storage';

if (!getApps().length) {
  initializeApp();
}

export const db      = getFirestore();
export const storage = getStorage();
export const messaging = getMessaging();

// Ignora campos undefined en escrituras (set/update) en vez de lanzar error.
// Evita fallos cuando un campo opcional (header, footer, etc.) llega undefined.
db.settings({ ignoreUndefinedProperties: true });
