import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { resolvePendingMedia } from '../modules/media/mediaRehost.service';
import type { Message } from '../modules/messages/messages.types';

/**
 * Red de seguridad: cada 10 min reintenta re-alojar la media que quedó pendiente
 * (si el trigger onMediaRehost falló o la primera descarga de ycloud dio error).
 * Garantiza que TODA la media termine en Firebase Storage y no dependamos de las
 * URLs temporales de ycloud. Tras MAX_REHOST_ATTEMPTS se desiste automáticamente.
 *
 * Usa una consulta collectionGroup sobre `messages` filtrada por mediaPending, así
 * que no recorre toda la colección — solo los pocos mensajes con media pendiente.
 */
export const processPendingMedia = onSchedule(
  {
    schedule:       'every 10 minutes',
    region:         'us-central1',
    timeoutSeconds: 300,
    memory:         '1GiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    const snap = await db
      .collectionGroup('messages')
      .where('mediaPending', '==', true)
      .limit(50)
      .get();

    if (snap.empty) return;

    let done = 0;
    for (const doc of snap.docs) {
      const parts = doc.ref.path.split('/'); // companies/{cid}/leads/{lid}/messages/{mid}
      const companyId = parts[1];
      const messageId = doc.id;
      const result = await resolvePendingMedia(doc.ref, doc.data() as Message, companyId, messageId);
      if (result === 'done') done++;
    }

    logger.info(`[PendingMedia] Barrido: ${snap.size} pendiente(s), ${done} re-alojada(s).`);
  }
);
