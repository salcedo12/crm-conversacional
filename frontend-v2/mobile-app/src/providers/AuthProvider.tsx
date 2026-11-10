import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth, { type FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { isAdminRole, type UserProfile, type UserRole } from '../types';

const DEFAULT_COMPANY_ID = 'grupo_meraki_real';
const ACTIVE_COMPANY_KEY = 'meraki:active-company-id';

interface AuthValue {
  user: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  companyId: string | null;
  role: UserRole | null;
  platformAdmin: boolean;
  isAdmin: boolean;
  setActiveCompanyId: (companyId: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function snapshotExists(snap: { exists: boolean | (() => boolean) }): boolean {
  return typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
}

function checkIsPlatformAdmin(profile: UserProfile | null, claims?: Record<string, any>): boolean {
  if (claims?.platformAdmin === true || claims?.platformAdmin === 'true') return true;
  return (
    profile?.platformAdmin === true ||
    profile?.platformAdmin === 'true' ||
    profile?.role === 'platformAdmin'
  );
}

async function waitForCompanyClaim(
  user: FirebaseAuthTypes.User,
  attempts = 5
): Promise<Record<string, any>> {
  let claims: Record<string, any> = {};
  for (let i = 0; i < attempts; i++) {
    const res = await user.getIdTokenResult(true);
    claims = res.claims ?? {};
    if (typeof claims.companyId === 'string' && claims.companyId) return claims;
    await new Promise((r) => setTimeout(r, 600 + i * 400));
  }
  return claims;
}

async function loadOrCreateUserProfile(
  user: FirebaseAuthTypes.User
): Promise<{ profile: UserProfile; claims: Record<string, any> }> {
  const isTester = user.email?.toLowerCase().includes('google.tester') ?? false;
  let tokenResult = await user.getIdTokenResult(true);
  let claims: Record<string, any> = tokenResult.claims ?? {};

  let companyId =
    typeof claims.companyId === 'string' &&
    claims.companyId &&
    (isTester || claims.companyId !== 'empresa_demo')
      ? claims.companyId
      : DEFAULT_COMPANY_ID;

  if (!isTester && companyId !== 'grupo_meraki_real') {
    try {
      const realSnap = await firestore()
        .collection('companies')
        .doc('grupo_meraki_real')
        .collection('users')
        .doc(user.uid)
        .get();
      if (snapshotExists(realSnap)) {
        companyId = 'grupo_meraki_real';
      }
    } catch {}
  }

  const ref = firestore()
    .collection('companies')
    .doc(companyId)
    .collection('users')
    .doc(user.uid);
  const snap = await ref.get();

  if (snapshotExists(snap)) {
    if (
      !claims.companyId ||
      (!isTester && claims.companyId === 'empresa_demo') ||
      claims.companyId !== companyId
    ) {
      try {
        await ref.set({ updatedAt: firestore.Timestamp.now() }, { merge: true });
        claims = await waitForCompanyClaim(user);
        if (
          typeof claims.companyId === 'string' &&
          claims.companyId &&
          (isTester || claims.companyId !== 'empresa_demo')
        ) {
          companyId = claims.companyId;
        }
      } catch {}
    }

    const data = snap.data() ?? {};
    const active = data.active !== false;
    if (!active) {
      throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
    }

    return {
      claims,
      profile: {
        id: user.uid,
        companyId,
        email: String(data.email ?? user.email ?? ''),
        displayName: String(data.displayName ?? user.displayName ?? user.email?.split('@')[0] ?? 'Asesor'),
        role: (data.role as UserRole) ?? 'advisor',
        active: true,
        receiveLeads: data.receiveLeads !== false && data.excludeFromLeadAssignment !== true,
        platformAdmin: data.platformAdmin ?? claims.platformAdmin ?? false,
        isBlockedForLeads: data.isBlockedForLeads === true,
        blockedReason: data.blockedReason ?? null,
        unresolvedAppointmentId: data.unresolvedAppointmentId ?? null,
        unresolvedLeadId: data.unresolvedLeadId ?? null,
        unresolvedLeadName: data.unresolvedLeadName ?? null,
        phone: data.phone ? String(data.phone) : undefined,
      },
    };
  }

  // Autocrear perfil por defecto (rol 'advisor' seguro, idéntico a auth.service.ts web)
  const now = firestore.Timestamp.now();
  const defaultProfile = {
    companyId,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Usuario',
    role: 'advisor' as UserRole,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(defaultProfile);
  claims = await waitForCompanyClaim(user);
  return {
    claims,
    profile: {
      id: user.uid,
      ...defaultProfile,
    },
  };
}

function getAuthErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code: string }).code);
    const map: Record<string, string> = {
      'auth/user-not-found': 'No existe una cuenta con ese email.',
      'auth/wrong-password': 'Contraseña incorrecta.',
      'auth/invalid-email': 'El email no es válido.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
      'auth/user-disabled': 'Esta cuenta está desactivada.',
      'auth/invalid-credential': 'Credenciales inválidas. Verifica tu email y contraseña.',
      'auth/network-request-failed': 'Error de red. Verifica tu conexión.',
    };
    for (const [k, msg] of Object.entries(map)) {
      if (code.includes(k) || code === k) return msg;
    }
    return `Error de autenticación (${code})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Error inesperado. Intenta nuevamente.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [claims, setClaims] = useState<Record<string, any>>({});
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isTester = user?.email?.toLowerCase().includes('google.tester') ?? false;

  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_COMPANY_KEY)
      .then((stored) => {
        if (stored && (isTester || stored !== 'empresa_demo')) {
          setActiveCompanyIdState(stored);
        } else if (stored === 'empresa_demo' && !isTester) {
          AsyncStorage.removeItem(ACTIVE_COMPANY_KEY).catch(() => {});
        }
      })
      .catch(() => {});
  }, [isTester]);

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(async (nextUser) => {
      setError(null);
      try {
        if (nextUser) {
          const loaded = await loadOrCreateUserProfile(nextUser);
          setUser(nextUser);
          setProfile(loaded.profile);
          setClaims(loaded.claims);
        } else {
          setUser(null);
          setProfile(null);
          setClaims({});
          setActiveCompanyIdState(null);
        }
      } catch (reason) {
        const msg = getAuthErrorMessage(reason);
        setError(msg);
        setUser(null);
        setProfile(null);
        await auth().signOut().catch(() => {});
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const platformAdmin = checkIsPlatformAdmin(profile, claims);
  const isAdmin = platformAdmin || isAdminRole(profile?.role);
  const sanitizedActiveId = !isTester && activeCompanyId === 'empresa_demo' ? null : activeCompanyId;
  const rawCompanyId =
    !isTester && profile?.companyId === 'empresa_demo'
      ? DEFAULT_COMPANY_ID
      : (profile?.companyId ?? null);

  const effectiveCompanyId = user
    ? platformAdmin
      ? sanitizedActiveId || rawCompanyId || DEFAULT_COMPANY_ID
      : rawCompanyId || DEFAULT_COMPANY_ID
    : null;

  // Escuchar cambios en vivo del documento del usuario (bloqueos SLA, desbloqueos automáticos, receiveLeads)
  useEffect(() => {
    if (!user?.uid || !effectiveCompanyId) return;
    const userRef = firestore()
      .collection('companies')
      .doc(effectiveCompanyId)
      .collection('users')
      .doc(user.uid);
    const unsub = userRef.onSnapshot(
      (snap) => {
        if (!snapshotExists(snap)) return;
        const d = snap.data() ?? {};
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                role: (d.role as UserRole) ?? prev.role,
                displayName: d.displayName ? String(d.displayName) : prev.displayName,
                isBlockedForLeads: d.isBlockedForLeads === true,
                blockedReason: d.blockedReason ?? null,
                unresolvedAppointmentId: d.unresolvedAppointmentId ?? null,
                unresolvedLeadId: d.unresolvedLeadId ?? null,
                unresolvedLeadName: d.unresolvedLeadName ?? null,
                receiveLeads: d.receiveLeads !== false && d.excludeFromLeadAssignment !== true,
              }
            : prev
        );
      },
      () => {}
    );
    return () => unsub();
  }, [user?.uid, effectiveCompanyId]);

  const setActiveCompanyId = useCallback(
    async (nextCompanyId: string) => {
      const targetId = !isTester && nextCompanyId === 'empresa_demo' ? DEFAULT_COMPANY_ID : nextCompanyId;
      setActiveCompanyIdState(targetId);
      await AsyncStorage.setItem(ACTIVE_COMPANY_KEY, targetId).catch(() => {});
    },
    [isTester]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const cred = await auth().signInWithEmailAndPassword(email.trim(), password);
      const loaded = await loadOrCreateUserProfile(cred.user);
      setUser(cred.user);
      setProfile(loaded.profile);
      setClaims(loaded.claims);
    } catch (reason) {
      const message = getAuthErrorMessage(reason);
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setActiveCompanyIdState(null);
    await AsyncStorage.removeItem(ACTIVE_COMPANY_KEY).catch(() => {});
    await auth().signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      await auth().sendPasswordResetEmail(email.trim());
    } catch (reason) {
      throw new Error(getAuthErrorMessage(reason));
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      loading,
      error,
      companyId: effectiveCompanyId,
      role: profile?.role ?? null,
      platformAdmin,
      isAdmin,
      setActiveCompanyId,
      signIn,
      signOut,
      resetPassword,
    }),
    [
      user,
      profile,
      loading,
      error,
      effectiveCompanyId,
      platformAdmin,
      isAdmin,
      setActiveCompanyId,
      signIn,
      signOut,
      resetPassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requiere AuthProvider');
  return context;
}
