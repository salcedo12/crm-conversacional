import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Spinner } from '@/shared/components/Spinner';

/**
 * Ruta protegida: redirige a /login si no hay sesión activa.
 * Muestra un spinner mientras se verifica el estado de auth.
 */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location           = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
