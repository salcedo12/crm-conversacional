import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getAuth }           from 'firebase-admin/auth';
import { logger }            from '../utils/logger';
import '../lib/admin'; // garantiza que la app de firebase-admin esté inicializada

/**
 * Sincroniza los custom claims del usuario de Firebase Auth con su doc de perfil.
 *
 * Fuente de verdad: companies/{companyId}/users/{userId}
 *   - El id del doc DEBE ser el uid de Firebase Auth.
 *   - Al crear/editar el doc → setea claims { companyId, role, active }.
 *   - Al eliminar el doc      → limpia los claims.
 *
 * Los claims son lo único en lo que confía el backend (ver lib/authContext.ts).
 * Tras un cambio, el usuario debe refrescar su ID token (getIdToken(true)) para
 * que los nuevos claims surtan efecto en el cliente.
 */
export const onUserProfileWritten = onDocumentWritten(
  { document: 'companies/{companyId}/users/{userId}', region: 'us-central1' },
  async (event) => {
    const { companyId, userId } = event.params as { companyId: string; userId: string };
    const after = event.data?.after;
    const auth  = getAuth();

    try {
      // Doc eliminado → revocar acceso limpiando claims
      if (!after?.exists) {
        await auth.setCustomUserClaims(userId, null);
        logger.info('[UserClaims] Claims limpiados', { userId, companyId });
        return;
      }

      const data   = after.data() ?? {};
      const role   = typeof data.role === 'string' ? data.role : 'advisor';
      const active = data.active !== false;

      await auth.setCustomUserClaims(userId, { companyId, role, active });
      logger.info('[UserClaims] Claims actualizados', { userId, companyId, role, active });
    } catch (err) {
      // Si el uid no existe en Auth todavía (doc creado antes que la cuenta),
      // se registra y se reintentará en la próxima escritura del doc.
      logger.error('[UserClaims] Error sincronizando claims', {
        userId, companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
