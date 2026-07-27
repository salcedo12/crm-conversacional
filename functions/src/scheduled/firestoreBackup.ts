import { onSchedule } from 'firebase-functions/v2/scheduler';
import { v1 } from '@google-cloud/firestore';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const adminClient = new v1.FirestoreAdminClient();

/**
 * Backup diario de Firestore: exporta TODA la base a Cloud Storage.
 * Corre cada día a las 03:00 (America/Bogota) y guarda en
 *   gs://<bucket>/firestore-backups/<YYYY-MM-DD>/
 *
 * Requisitos (una sola vez):
 *  - La service account de las functions necesita el permiso
 *    `datastore.databases.export` (rol "Cloud Datastore Import Export Admin",
 *    o el rol Editor que ya lo incluye).
 *  - Acceso de escritura al bucket destino (el bucket por defecto de Storage
 *    ya lo tiene). Si falla por permisos, el log lo indica.
 *
 * Restaurar: desde la consola de Google Cloud (Firestore → Import/Export) o
 *   `gcloud firestore import gs://<bucket>/firestore-backups/<fecha>`.
 */
export const scheduledFirestoreBackup = onSchedule(
  {
    schedule:       'every day 03:00',
    timeZone:       'America/Bogota',
    region:         'us-central1',
    timeoutSeconds: 540,
    memory:         '256MiB',
  },
  async () => {
    const projectId    = process.env.GCLOUD_PROJECT ?? 'crm-conversacional';
    const databaseName = adminClient.databasePath(projectId, '(default)');
    const stamp        = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const outputUriPrefix = `gs://${env.storageBucket()}/firestore-backups/${stamp}`;

    try {
      const [operation] = await adminClient.exportDocuments({
        name:          databaseName,
        outputUriPrefix,
        collectionIds: [], // vacío = todas las colecciones
      });
      logger.info('[Backup] Export de Firestore iniciado', {
        outputUriPrefix, operation: operation.name,
      });
    } catch (err) {
      logger.error('[Backup] Falló el export de Firestore', {
        error: err instanceof Error ? err.message : String(err),
        hint:  'La service account necesita el permiso datastore.databases.export ' +
               'y escritura en el bucket destino.',
      });
      throw err;
    }
  }
);
