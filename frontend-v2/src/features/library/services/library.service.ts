import {
  collection, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '@/config/firebase';
import type { LibraryItem } from '../types';
import type { MediaUploadResult } from '@/features/inbox/services/media.service';

const _save   = httpsCallable<
  {
    companyId: string; title: string; project?: string; fileName: string;
    storagePath: string; downloadUrl: string; contentType: string; sizeBytes: number;
    kind?: 'document' | 'video'; visibility?: 'general' | 'advisor'; advisorId?: string; advisorName?: string;
  },
  { itemId: string }
>(functions, 'saveLibraryItem');
const _rename = httpsCallable<
  {
    companyId: string; itemId: string; title: string; project?: string;
    kind?: 'document' | 'video'; visibility?: 'general' | 'advisor'; advisorId?: string; advisorName?: string;
  },
  { ok: boolean }
>(functions, 'renameLibraryItem');
const _delete = httpsCallable<{ companyId: string; itemId: string }, { ok: boolean }>(functions, 'deleteLibraryItem');

export interface LibraryUploadProgress {
  percent: number;
}

/** Resultado de subir un archivo a la carpeta de biblioteca en Storage. */
export interface LibraryFileUpload {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  fileName:    string;
  sizeBytes:   number;
}

/**
 * Sube un archivo a companies/{companyId}/library/… en Storage (permanente) y
 * devuelve su metadata. Solo admin/manager pueden escribir ahí (reglas Storage).
 */
export function uploadLibraryFile(
  file:      File,
  companyId: string,
  onProgress?: (p: LibraryUploadProgress) => void
): Promise<LibraryFileUpload> {
  const timestamp   = Date.now();
  const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/library/${timestamp}_${safeName}`;
  const storageRef  = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });
    task.on(
      'state_changed',
      (snap) => onProgress?.({ percent: Math.round((snap.bytesTransferred / snap.totalBytes) * 100) }),
      (err) => { console.error('[library.service] Upload error:', err); reject(err); },
      async () => {
        const downloadUrl = await getDownloadURL(task.snapshot.ref);
        resolve({
          storagePath,
          downloadUrl,
          contentType: file.type || 'application/octet-stream',
          fileName:    file.name,
          sizeBytes:   file.size,
        });
      }
    );
  });
}

/** Sube el archivo y registra su metadata en la biblioteca. Devuelve el itemId. */
export async function addLibraryItem(
  file:      File,
  companyId: string,
  title:     string,
  project:   string,
  onProgress?: (p: LibraryUploadProgress) => void,
  options?: {
    kind?: 'document' | 'video';
    visibility?: 'general' | 'advisor';
    advisorId?: string;
    advisorName?: string;
  }
): Promise<string> {
  const uploaded = await uploadLibraryFile(file, companyId, onProgress);
  const r = await _save({ companyId, title: title.trim() || file.name, project: project.trim() || undefined, ...uploaded, ...options });
  return r.data.itemId;
}

export async function renameLibraryItem(
  companyId: string,
  itemId: string,
  title: string,
  project?: string,
  options?: {
    kind?: 'document' | 'video';
    visibility?: 'general' | 'advisor';
    advisorId?: string;
    advisorName?: string;
  }
): Promise<void> {
  await _rename({ companyId, itemId, title, project, ...options });
}

export async function deleteLibraryItem(companyId: string, itemId: string): Promise<void> {
  await _delete({ companyId, itemId });
}

/** Escucha en tiempo real la biblioteca de la empresa (más recientes primero). */
export function listenLibrary(companyId: string, cb: (items: LibraryItem[]) => void): () => void {
  const q = query(
    collection(db, 'companies', companyId, 'library'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LibraryItem, 'id'>) })));
  }, (err) => {
    console.error('[library.service] listen error:', err);
    cb([]);
  });
}

/** Convierte un item de la biblioteca en el formato que espera el composer para enviar. */
export function itemToMedia(item: LibraryItem): MediaUploadResult {
  return {
    downloadUrl: item.downloadUrl,
    storagePath: item.storagePath,
    contentType: item.contentType,
    fileName:    item.fileName,
  };
}
