import { randomUUID } from 'crypto';
import { storage }    from '../lib/admin';
import { env }        from '../config/env';

/**
 * Sube un Buffer a Firebase Storage y devuelve una URL de descarga permanente
 * compatible con el formato del cliente SDK de Firebase.
 *
 * La URL incluye un token de acceso embebido, es accesible públicamente
 * (sin auth headers) — necesario para que Twilio pueda mostrar la media
 * y para que el navegador la renderice directamente.
 */
export async function uploadMediaBuffer(
  buffer:      Buffer,
  contentType: string,
  storagePath: string  // e.g. companies/empresa_demo/media/leadId/filename.jpg
): Promise<{ downloadUrl: string; storagePath: string }> {
  const bucket = storage.bucket(env.storageBucket());
  const file   = bucket.file(storagePath);
  const token  = randomUUID();

  await file.save(buffer, {
    contentType,
    metadata: {
      metadata: {
        // Este token es el que usa el SDK cliente para generar la download URL
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const encodedPath  = encodeURIComponent(storagePath).replace(/%2F/g, '%2F');
  const downloadUrl  = `https://firebasestorage.googleapis.com/v0/b/${env.storageBucket()}/o/${encodedPath}?alt=media&token=${token}`;

  return { downloadUrl, storagePath };
}

/** Extensión de archivo a partir del MIME type */
export function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg':       'jpg',
    'image/jpg':        'jpg',
    'image/png':        'png',
    'image/gif':        'gif',
    'image/webp':       'webp',
    'video/mp4':        'mp4',
    'video/3gpp':       '3gp',
    'video/quicktime':  'mov',
    'audio/ogg':        'ogg',
    'audio/mpeg':       'mp3',
    'audio/mp4':        'mp4',
    'audio/webm':       'webm',
    'application/pdf':  'pdf',
  };
  return map[mimeType] ?? 'bin';
}
