import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  type User,
  type ParsedToken,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import type { UserProfile, UserRole } from '../types';

const DEFAULT_COMPANY_ID = import.meta.env.VITE_DEFAULT_COMPANY_ID ?? 'empresa_demo';

/** Login con email y contraseña */
export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Cierre de sesión */
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/** Enviar email de recuperación de contraseña */
export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

/**
 * Refresca el ID token y espera a que los custom claims (companyId) estén
 * presentes. El backend (trigger onUserProfileWritten) setea los claims de
 * forma asíncrona, por lo que tras crear/tocar el doc hay que reintentar.
 */
async function waitForCompanyClaim(user: User, attempts = 5): Promise<ParsedToken> {
  let claims: ParsedToken = {};
  for (let i = 0; i < attempts; i++) {
    const res = await user.getIdTokenResult(true); // force refresh
    claims = res.claims;
    if (typeof claims.companyId === 'string' && claims.companyId) return claims;
    // Espera incremental para dar tiempo al trigger (eventual consistency)
    await new Promise((r) => setTimeout(r, 600 + i * 400));
  }
  return claims;
}

/**
 * Carga el perfil del usuario desde Firestore.
 * Ruta: companies/{companyId}/users/{uid}
 *
 * Fuente de verdad del companyId: los custom claims del ID token (los sincroniza
 * el backend desde el doc de perfil). Si el usuario aún no tiene claims —cuenta
 * nueva o creada antes de este despliegue— se hace un "backfill": se escribe el
 * doc para disparar el trigger y se espera a que los claims aparezcan.
 *
 * Rol por defecto de una cuenta autocreada: 'advisor' (seguro). El primer admin
 * se aprovisiona manualmente editando el doc en Firestore (el trigger sincroniza
 * los claims automáticamente).
 */
export async function loadOrCreateUserProfile(user: User): Promise<UserProfile> {
  // 1. Resolver companyId desde los claims (con fallback al default para bootstrap)
  let { claims } = await user.getIdTokenResult();
  let companyId  = typeof claims.companyId === 'string' && claims.companyId
    ? claims.companyId
    : DEFAULT_COMPANY_ID;

  const ref  = doc(db, 'companies', companyId, 'users', user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    // Si el doc existe pero los claims aún no traen companyId, hacer backfill:
    // tocar el doc → el trigger setea los claims → refrescar el token.
    if (!claims.companyId) {
      await setDoc(ref, { updatedAt: Timestamp.now() }, { merge: true });
      claims = await waitForCompanyClaim(user);
      if (typeof claims.companyId === 'string' && claims.companyId) {
        companyId = claims.companyId;
      }
    }

    const data = snap.data();
    return {
      ...data,          // datos de Firestore (role, displayName, etc.)
      id:        snap.id,
      companyId,        // companyId siempre desde el claim resuelto (no del doc)
    } as UserProfile;
  }

  // 2. Crear perfil por defecto. Rol 'advisor' por seguridad (no admin).
  const now = Timestamp.now();
  const profile: Omit<UserProfile, 'id'> = {
    companyId,
    email:       user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Usuario',
    role:        'advisor' as UserRole,
    active:      true,
    createdAt:   now,
    updatedAt:   now,
  };

  await setDoc(ref, profile);
  // Esperar a que el trigger setee los claims del nuevo usuario.
  await waitForCompanyClaim(user);
  return { id: user.uid, ...profile };
}
