import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getAuth }           from 'firebase-admin/auth';
import { logger }            from '../utils/logger';
import { db }                from '../lib/admin';

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
      // Doc eliminado → verificar si el usuario tiene perfil en grupo_meraki_real
      if (!after?.exists) {
        const realDoc = await db.collection('companies').doc('grupo_meraki_real').collection('users').doc(userId).get();
        if (realDoc.exists) {
          const rData = realDoc.data() ?? {};
          const rawRole = typeof rData.role === 'string' ? rData.role : 'advisor';
          const platformAdmin = rData.platformAdmin === true || rData.platformAdmin === 'true' || rawRole === 'platformAdmin';
          const role = rawRole === 'platformAdmin' ? 'admin' : rawRole;
          const active = rData.active !== false;
          await auth.setCustomUserClaims(userId, { companyId: 'grupo_meraki_real', role, active, platformAdmin });
          logger.info('[UserClaims] Claims preservados en grupo_meraki_real tras borrado en doc secundario', { userId, companyId });
          return;
        }

        await auth.setCustomUserClaims(userId, null);
        logger.info('[UserClaims] Claims limpiados', { userId, companyId });
        return;
      }

      // Si el doc escrito es de empresa_demo, solo permitirlo para google.tester
      if (companyId === 'empresa_demo') {
        const userRec = await auth.getUser(userId).catch(() => null);
        const email = userRec?.email?.toLowerCase() ?? '';
        if (!email.includes('google.tester')) {
          logger.warn('[UserClaims] Bloqueado claim empresa_demo para usuario no-tester', { userId, email });
          return;
        }
      }

      const data   = after.data() ?? {};
      const rawRole = typeof data.role === 'string' ? data.role : 'advisor';
      const platformAdmin = data.platformAdmin === true || data.platformAdmin === 'true' || rawRole === 'platformAdmin';
      const role = rawRole === 'platformAdmin' ? 'admin' : rawRole;
      const active = data.active !== false;

      // Seguridad (R01): conceder platformAdmin es un evento sensible; dejar rastro.
      if (platformAdmin) {
        const prevClaims = (await auth.getUser(userId).catch(() => null))?.customClaims ?? {};
        if (prevClaims.platformAdmin !== true) {
          logger.warn('[UserClaims][SECURITY] platformAdmin concedido', { userId, companyId, role });
        }
      }

      await auth.setCustomUserClaims(userId, { companyId, role, active, platformAdmin });
      logger.info('[UserClaims] Claims actualizados', { userId, companyId, role, active, platformAdmin });
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
