import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator }           from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator }     from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');
export const storage   = getStorage(app);

/**
 * Pruebas locales (`npm run dev:local`, modo `emulators`): todo va a los emuladores
 * de Firebase con el proyecto demo-crm-local, sin tocar datos ni servicios reales.
 */
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';
if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

export default app;
