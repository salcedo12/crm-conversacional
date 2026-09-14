import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { resolvePendingMedia } from '../modules/media/mediaRehost.service';
import type { Message } from '../modules/messages/messages.types';

/**
 * Re-aloja en segundo plano la media marcada como `mediaPending` (la deja así el
 * webhook para responder rápido a ycloud y evitar timeouts con archivos pesados).
 * Descarga la URL temporal de ycloud y la sube a Firebase Storage; luego actualiza
 * el mensaje con la URL permanente. Si falla, el barrido processPendingMedia lo
 * reintenta. Ver [mediaRehost.service].
 */
export const onMediaRehost = onDocumentCreated(
  {
    document:       'companies/{companyId}/leads/{leadId}/messages/{messageId}',
    region:         'us-central1',
    timeoutSeconds: 120,
    memory:         '1GiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data() as Message;
    if (!msg.mediaPending || !msg.mediaSourceUrl) return;

    const { companyId, messageId } = event.params;
    await resolvePendingMedia(snap.ref, msg, companyId, messageId);
  }
);
