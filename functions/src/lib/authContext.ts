import { HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';

/**
 * Contexto de autenticación de un callable, derivado de los custom claims.
 * Los claims (`companyId`, `role`, `active`) los sincroniza el trigger
 * onUserProfileWritten a partir del doc companies/{companyId}/users/{uid}.
 */
export type UserRole = 'admin' | 'manager' | 'advisor' | 'viewer' | 'platformAdmin';

export interface AuthContext {
  uid:       string;
  companyId: string;
  role:      UserRole;
  platformAdmin: boolean;
}

/** Roles con permisos administrativos (config IA, plantillas, conexión WhatsApp). */
export const ADMIN_ROLES: UserRole[] = ['admin', 'manager', 'platformAdmin'];

/** Roles que pueden operar sobre leads/mensajes/citas (todos menos viewer). */
export const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'advisor'];

/**
 * Exige usuario autenticado con empresa asignada en sus claims.
 * Lanza HttpsError si falta sesión o la cuenta aún no tiene claims.
 */
export function requireAuth(request: CallableRequest): AuthContext {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const token     = request.auth.token as Record<string, unknown>;
  const companyId = typeof token.companyId === 'string' ? token.companyId : '';
  const role      = (typeof token.role === 'string' ? token.role : 'advisor') as UserRole;
  const active    = token.active !== false; // undefined = activo por compatibilidad
  const platformAdmin = token.platformAdmin === true || role === 'platformAdmin';

  if (!companyId) {
    throw new HttpsError(
      'failed-precondition',
      'Tu cuenta aún no tiene una empresa asignada. Cierra sesión y vuelve a entrar; si el problema persiste, contacta al administrador.'
    );
  }

  if (!active) {
    throw new HttpsError('permission-denied', 'Tu cuenta está desactivada.');
  }

  return { uid: request.auth.uid, companyId, role, platformAdmin };
}

/** Exige que el contexto tenga uno de los roles permitidos. */
export function requireRole(ctx: AuthContext, allowed: UserRole[]): void {
  if (!ctx.platformAdmin && !allowed.includes(ctx.role)) {
    throw new HttpsError('permission-denied', 'No tienes permisos para realizar esta acción.');
  }
}

/**
 * Verifica que el companyId solicitado coincide con el de los claims.
 * Impide que un usuario acceda a datos de otra empresa enviando otro companyId.
 */
export function assertCompany(ctx: AuthContext, companyId: string): void {
  if (!ctx.platformAdmin && ctx.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'No puedes acceder a datos de otra empresa.');
  }
}

export function requirePlatformAdmin(ctx: AuthContext): void {
  if (!ctx.platformAdmin) {
    throw new HttpsError('permission-denied', 'Solo un administrador de plataforma puede realizar esta accion.');
  }
}
