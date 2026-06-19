import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { UserRole } from '@/features/auth/types';

interface RoleRouteProps {
  /** Roles permitidos para acceder a estas rutas */
  allowed: UserRole[];
}

/**
 * Ruta por rol: bloquea el acceso si el usuario no tiene el rol requerido.
 * Siempre usar dentro de un <ProtectedRoute> (el usuario ya está autenticado).
 */
export function RoleRoute({ allowed }: RoleRouteProps) {
  const { role } = useAuth();

  if (!role || !allowed.includes(role)) {
    return <Navigate to="/dashboard/inbox" replace />;
  }

  return <Outlet />;
}
