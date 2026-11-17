import { safeDownload, ycloudAuthHeaders } from '../../utils/safeDownload';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { uploadMediaBuffer, mimeToExt } from '../../utils/storageUpload';
import { getYcloudConfigForCompany } from '../companies/channelCredentials.repository';
import { logger } from '../../utils/logger';
import type { Message } from '../messages/messages.types';

/** Tras estos intentos fallidos se desiste (la URL temporal de ycloud ya caducó). */
export const MAX_REHOST_ATTEMPTS = 6;

/**
 * Descarga un archivo (con autenticación X-API-Key para las URLs de ycloud),
 * siguiendo redirects. Devuelve el buffer completo.
 */
export async function downloadWithApiKey(url: string, apiKey: string): Promise<Buffer> {
  // Seguridad (R11): la llave solo se envía a dominios de YCloud (antes seguía
  // redirecciones a cualquier host con la llave) y se validan destino y tamaño.
  const { buffer } = await safeDownload(url, { headersFor: ycloudAuthHeaders(apiKey) });
  return buffer;
}

export interface RehostInput {
  companyId: string;
  msgId:     string;
  sourceUrl: string;
  mimeType:  string;
  apiKey:    string;
}

/**
 * Descarga una media temporal de ycloud y la re-aloja en Firebase Storage
 * (permanente). Devuelve la URL pública y el path de Storage.
 */
export async function rehostYcloudMedia(
  input: RehostInput
): Promise<{ downloadUrl: string; storagePath: string }> {
  const buffer = await downloadWithApiKey(input.sourceUrl, input.apiKey);
  const ext    = mimeToExt(input.mimeType);
  const path   = `companies/${input.companyId}/media/${input.msgId}.${ext}`;
  const result = await uploadMediaBuffer(buffer, input.mimeType, path);
  return { downloadUrl: result.downloadUrl, storagePath: result.storagePath };
}

export type RehostResult = 'done' | 'retry' | 'gaveup' | 'skip';

/**
 * Intenta re-alojar la media pendiente de UN mensaje y actualiza el doc:
 *  - éxito         → guarda mediaUrl/mediaStoragePath permanentes y limpia flags.
 *  - fallo         → suma un intento; si aún quedan, deja mediaPending para reintentar.
 *  - agotado (N)   → desiste (mediaPending: false) porque la URL temporal ya caducó.
 *
 * Lo usan el trigger onMediaRehost (inmediato) y el barrido processPendingMedia
 * (red de seguridad), para que TODA la media termine en Firebase Storage y no
 * dependamos de las URLs temporales de ycloud.
 */
export async function resolvePendingMedia(
  ref: DocumentReference,
  msg: Message,
  companyId: string,
  messageId: string
): Promise<RehostResult> {
  if (!msg.mediaPending || !msg.mediaSourceUrl || !msg.mediaType) return 'skip';

  try {
    const { apiKey } = await getYcloudConfigForCompany(companyId);
    const { downloadUrl, storagePath } = await rehostYcloudMedia({
      companyId,
      msgId:     messageId,
      sourceUrl: msg.mediaSourceUrl,
      mimeType:  msg.mediaType,
      apiKey,
    });
    await ref.update({
      mediaUrl:         downloadUrl,
      mediaStoragePath: storagePath,
      mediaPending:     FieldValue.delete(),
      mediaSourceUrl:   FieldValue.delete(),
      updatedAt:        FieldValue.serverTimestamp(),
    });
    logger.info('[MediaRehost] Media re-alojada', { companyId, messageId, type: msg.mediaType });
    return 'done';
  } catch (err) {
    const attempts = (msg.mediaRehostAttempts ?? 0) + 1;
    const giveUp   = attempts >= MAX_REHOST_ATTEMPTS;
    await ref.update({
      mediaRehostAttempts: attempts,
      ...(giveUp ? { mediaPending: false } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => { /* best-effort */ });
    logger.warn('[MediaRehost] Fallo re-alojando media', {
      companyId, messageId, attempts, giveUp,
      error: err instanceof Error ? err.message : String(err),
    });
    return giveUp ? 'gaveup' : 'retry';
  }
}
