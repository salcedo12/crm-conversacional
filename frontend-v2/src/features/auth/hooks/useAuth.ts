/**
 * Hook de autenticación — wrapper sobre el contexto global.
 * Usar este hook en todos los componentes que necesiten acceso al usuario.
 */
export { useAuthContext as useAuth } from '@/providers/AuthProvider';
