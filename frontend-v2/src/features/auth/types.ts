import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'advisor' | 'viewer' | 'platformAdmin';

/** Roles con permisos administrativos (config IA, plantillas, conexión WhatsApp). */
export const ADMIN_ROLES: UserRole[] = ['admin', 'manager', 'platformAdmin'];

/** True si el rol tiene permisos administrativos. */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

export interface UserProfile {
  id:          string;
  companyId:   string;
  email:       string;
  displayName: string;
  role:        UserRole;
  active:      boolean;
  platformAdmin?: boolean | string;
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}
