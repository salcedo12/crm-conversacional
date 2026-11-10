import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'advisor' | 'viewer' | 'platformAdmin';

/** Roles con permisos administrativos (config IA, plantillas, conexión WhatsApp). */
export const ADMIN_ROLES: UserRole[] = ['admin', 'manager', 'platformAdmin'];

/** True si el rol tiene permisos administrativos. */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** True si el rol es "Solo lectura": ve todo como un admin pero no modifica nada. */
export function isViewerRole(role: UserRole | null | undefined): boolean {
  return role === 'viewer';
}

export interface UserProfile {
  id:          string;
  companyId:   string;
  email:       string;
  displayName: string;
  role:        UserRole;
  active:      boolean;
  receiveLeads?: boolean;
  platformAdmin?: boolean | string;
  isBlockedForLeads?: boolean;
  blockedReason?: string | null;
  unresolvedAppointmentId?: string | null;
  unresolvedLeadId?: string | null;
  unresolvedLeadName?: string | null;
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}
