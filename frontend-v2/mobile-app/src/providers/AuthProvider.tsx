import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import auth, { type FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import type { UserProfile } from '../types';

interface AuthValue {
  user: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  companyId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function loadProfile(user: FirebaseAuthTypes.User): Promise<UserProfile> {
  const token = await user.getIdTokenResult();
  const companyId = typeof token.claims.companyId === 'string'
    ? token.claims.companyId
    : 'empresa_demo';
  const snapshot = await firestore()
    .collection('companies').doc(companyId)
    .collection('users').doc(user.uid)
    .get();

  if (!snapshot.exists) throw new Error('Tu usuario no tiene un perfil activo en el CRM.');
  const data = snapshot.data() ?? {};
  if (data.active === false) throw new Error('Tu cuenta esta desactivada.');

  return {
    id: user.uid,
    companyId,
    email: String(data.email ?? user.email ?? ''),
    displayName: String(data.displayName ?? user.displayName ?? 'Asesor'),
    role: data.role ?? 'advisor',
    active: true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => auth().onAuthStateChanged(async (nextUser) => {
    setLoading(true);
    setError(null);
    try {
      setUser(nextUser);
      setProfile(nextUser ? await loadProfile(nextUser) : null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar tu cuenta.');
      setProfile(null);
      await auth().signOut();
    } finally {
      setLoading(false);
    }
  }), []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      await auth().signInWithEmailAndPassword(email.trim(), password);
    } catch (reason: any) {
      const code = String(reason?.code ?? '');
      const message = code.includes('invalid-credential')
        ? 'Correo o contrasena incorrectos.'
        : code.includes('network')
          ? 'No hay conexion. Revisa internet e intenta nuevamente.'
          : 'No fue posible iniciar sesion.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signOut = useCallback(() => auth().signOut(), []);

  const value = useMemo<AuthValue>(() => ({
    user,
    profile,
    loading,
    error,
    companyId: profile?.companyId ?? null,
    signIn,
    signOut,
  }), [user, profile, loading, error, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requiere AuthProvider');
  return context;
}
