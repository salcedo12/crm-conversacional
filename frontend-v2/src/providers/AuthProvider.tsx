import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/config/firebase';
import {
  signIn as authSignIn,
  signOut as authSignOut,
  resetPassword as authResetPassword,
  loadOrCreateUserProfile,
} from '@/features/auth/services/auth.service';
import type { UserProfile, UserRole } from '@/features/auth/types';

// ── Contexto ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:      User | null;
  profile:   UserProfile | null;
  loading:   boolean;
  error:     string | null;
  companyId: string | null;
  role:      UserRole | null;
  platformAdmin: boolean;
  setActiveCompanyId: (companyId: string) => void;
  signIn:    (email: string, password: string) => Promise<void>;
  signOut:   () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_COMPANY_KEY = 'meraki:active-company-id';

function isPlatformAdmin(profile: UserProfile | null): boolean {
  return profile?.platformAdmin === true
    || profile?.platformAdmin === 'true'
    || profile?.role === 'platformAdmin';
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_COMPANY_KEY)
  );

  const setActiveCompanyId = useCallback((companyId: string) => {
    setActiveCompanyIdState(companyId);
    localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
    window.location.assign('/dashboard/inbox');
  }, []);

  // Escuchar cambios de estado de auth de Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setError(null);

      try {
        if (firebaseUser) {
          const prof = await loadOrCreateUserProfile(firebaseUser);

          if (!prof.active) {
            // Usuario desactivado → forzar logout
            await authSignOut();
            setError('Tu cuenta está desactivada. Contacta al administrador.');
            setUser(null);
            setProfile(null);
          } else {
            setUser(firebaseUser);
            setProfile(prof);
          }
        } else {
          setUser(null);
          setProfile(null);
          setActiveCompanyIdState(null);
          localStorage.removeItem(ACTIVE_COMPANY_KEY);
        }
      } catch (err) {
        console.error('[Auth] Error cargando perfil:', err);
        setError(err instanceof Error ? err.message : 'No se pudo cargar el perfil de usuario.');
        setUser(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const firebaseUser = await authSignIn(email, password);
      const prof = await loadOrCreateUserProfile(firebaseUser);

      if (!prof.active) {
        await authSignOut();
        setError('Tu cuenta está desactivada. Contacta al administrador.');
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setProfile(prof);
      setLoading(false);
    } catch (err: unknown) {
      const msg = getAuthErrorMessage(err);
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }
  }, []);

  const signOut = useCallback(async () => {
    setActiveCompanyIdState(null);
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    await authSignOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      await authResetPassword(email);
    } catch (err) {
      throw new Error(getAuthErrorMessage(err));
    }
  }, []);

  const platformAdmin = isPlatformAdmin(profile);
  const effectiveCompanyId = platformAdmin
    ? (activeCompanyId || profile?.companyId || null)
    : (profile?.companyId ?? null);

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    error,
    companyId: effectiveCompanyId,
    role:      profile?.role      ?? null,
    platformAdmin,
    setActiveCompanyId,
    signIn,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext debe usarse dentro de <AuthProvider>');
  return ctx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAuthErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: string }).code;
    const map: Record<string, string> = {
      'auth/user-not-found':       'No existe una cuenta con ese email.',
      'auth/wrong-password':       'Contraseña incorrecta.',
      'auth/invalid-email':        'El email no es válido.',
      'auth/too-many-requests':    'Demasiados intentos. Espera unos minutos.',
      'auth/user-disabled':        'Esta cuenta está desactivada.',
      'auth/invalid-credential':   'Credenciales inválidas. Verifica tu email y contraseña.',
      'auth/network-request-failed': 'Error de red. Verifica tu conexión.',
    };
    return map[code] ?? `Error de autenticación (${code})`;
  }
  return 'Error inesperado. Intenta nuevamente.';
}
