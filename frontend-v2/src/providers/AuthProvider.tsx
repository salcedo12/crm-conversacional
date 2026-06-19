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
  signIn:    (email: string, password: string) => Promise<void>;
  signOut:   () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Escuchar cambios de estado de auth de Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setError(null);

      if (firebaseUser) {
        try {
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
        } catch (err) {
          console.error('[Auth] Error cargando perfil:', err);
          setError('No se pudo cargar el perfil de usuario.');
          setUser(null);
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      await authSignIn(email, password);
      // El onAuthStateChanged de arriba carga el perfil automáticamente
    } catch (err: unknown) {
      const msg = getAuthErrorMessage(err);
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
  }, []);

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    error,
    companyId: profile?.companyId ?? null,
    role:      profile?.role      ?? null,
    signIn,
    signOut,
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
