import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '@/config/firebase';

export interface UploadProgress {
  percent: number;
  state:   'running' | 'paused' | 'error' | 'success';
}

export interface MediaUploadResult {
  downloadUrl:  string;
  storagePath:  string;
  contentType:  string;
  fileName:     string;
}

/**
 * Sube un archivo a Firebase Storage y devuelve la URL de descarga permanente.
 * El path incluye companyId y leadId para organización y futura aplicación de reglas.
 *
 * @param onProgress callback opcional para mostrar progreso (0-100)
 */
export async function uploadMedia(
  file:      File,
  companyId: string,
  leadId:    string,
  onProgress?: (p: UploadProgress) => void
): Promise<MediaUploadResult> {
  const timestamp   = Date.now();
  const storagePath = `companies/${companyId}/media/${leadId}/${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storageRef  = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.({ percent, state: snapshot.state as UploadProgress['state'] });
      },
      (error) => {
        console.error('[media.service] Upload error:', error);
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({
          downloadUrl,
          storagePath,
          contentType: file.type || 'application/octet-stream',
          fileName:    file.name,
        });
      }
    );
  });
}

/** Devuelve true si el MIME type es una imagen */
export const isImage = (mime?: string) => !!mime?.startsWith('image/');
/** WhatsApp entrega los stickers como WebP */
export const isWebp = (mime?: string) => mime === 'image/webp';
/** Devuelve true si el MIME type es un video */
export const isVideo = (mime?: string) => !!mime?.startsWith('video/');
/** Devuelve true si el MIME type es audio */
export const isAudio = (mime?: string) => !!mime?.startsWith('audio/');
/** Devuelve true si el MIME type es un PDF */
export const isPdf   = (mime?: string) => mime === 'application/pdf';
