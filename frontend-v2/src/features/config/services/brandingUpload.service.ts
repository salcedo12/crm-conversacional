import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from '@/config/firebase';

export interface BrandingUploadProgress {
  percent: number;
  state: 'running' | 'paused' | 'error' | 'success';
}

export interface BrandingUploadResult {
  downloadUrl: string;
  storagePath: string;
}

export async function uploadBrandLogo(
  file: File,
  companyId: string,
  onProgress?: (progress: BrandingUploadProgress) => void
): Promise<BrandingUploadResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecciona un archivo de imagen.');
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error('El logo no puede superar 2 MB.');
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/branding/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  // Storage Rules use custom claims (companyId/role). Refresh before upload so
  // recently-created or recently-promoted admins do not hit stale-token errors.
  await auth.currentUser?.getIdToken(true);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.({ percent, state: snapshot.state as BrandingUploadProgress['state'] });
      },
      (error) => {
        console.error('[brandingUpload] Upload error:', error);
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ downloadUrl, storagePath });
      }
    );
  });
}
