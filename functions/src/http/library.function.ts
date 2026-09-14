import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, storage } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

/**
 * Biblioteca de archivos reutilizables de la empresa ("portafolios").
 *
 * Idea: un admin sube una vez cada archivo pesado (p. ej. un PDF de 70 MB) a
 * Storage bajo companies/{companyId}/library/… y aquí se guarda su metadata en
 * Firestore. Los asesores luego lo eligen desde la Bandeja y se envía por el
 * enlace permanente (WhatsApp lo descarga solo), sin volver a subirlo cada vez.
 *
 * El archivo se sube directo a Storage desde el cliente (reglas de storage
 * restringen la escritura a admin/manager); estos callables solo gestionan la
 * metadata y el borrado del objeto.
 */

const libraryCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('library');

async function authorName(companyId: string, uid: string): Promise<string> {
  const snap = await db.collection('companies').doc(companyId).collection('users').doc(uid).get();
  const data = snap.data() ?? {};
  return (data.displayName as string) || (data.email as string) || 'Admin';
}

/** Solo se aceptan rutas dentro de la carpeta de biblioteca de la propia empresa. */
function assertLibraryPath(companyId: string, storagePath: string): void {
  const prefix = `companies/${companyId}/library/`;
  if (!storagePath.startsWith(prefix)) {
    throw new HttpsError('invalid-argument', 'La ruta del archivo no pertenece a la biblioteca de la empresa.');
  }
}

export const saveLibraryItem = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId:   z.string().min(1),
      title:       z.string().trim().min(1).max(120),
      project:     z.string().trim().max(120).optional(), // proyecto / club de campo
      kind:        z.enum(['document', 'video']).optional(),
      visibility:  z.enum(['general', 'advisor']).optional(),
      advisorId:   z.string().trim().max(128).optional(),
      advisorName: z.string().trim().max(160).optional(),
      fileName:    z.string().trim().min(1).max(255),
      storagePath: z.string().trim().min(1).max(500),
      downloadUrl: z.string().url(),
      contentType: z.string().trim().min(1).max(120),
      sizeBytes:   z.number().int().nonnegative(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);
    assertLibraryPath(data.companyId, data.storagePath);

    const now = Timestamp.now();
    const ref = await libraryCol(data.companyId).add({
      companyId:     data.companyId,
      kind:          data.kind ?? (data.contentType.startsWith('video/') ? 'video' : 'document'),
      visibility:    data.visibility ?? 'general',
      advisorId:     data.visibility === 'advisor' ? (data.advisorId ?? '') : '',
      advisorName:   data.visibility === 'advisor' ? (data.advisorName ?? '') : '',
      title:         data.title,
      project:       data.project ?? '',
      fileName:      data.fileName,
      storagePath:   data.storagePath,
      downloadUrl:   data.downloadUrl,
      contentType:   data.contentType,
      sizeBytes:     data.sizeBytes,
      createdBy:     ctx.uid,
      createdByName: await authorName(data.companyId, ctx.uid),
      createdAt:     now,
      updatedAt:     now,
    });

    logger.info('[Library] Item creado', { companyId: data.companyId, itemId: ref.id, fileName: data.fileName });
    return { itemId: ref.id };
  }
);

export const renameLibraryItem = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      itemId:    z.string().min(1),
      title:     z.string().trim().min(1).max(120),
      project:   z.string().trim().max(120).optional(), // si viene, reasigna el proyecto
      kind:      z.enum(['document', 'video']).optional(),
      visibility:  z.enum(['general', 'advisor']).optional(),
      advisorId:   z.string().trim().max(128).optional(),
      advisorName: z.string().trim().max(160).optional(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const ref = libraryCol(data.companyId).doc(data.itemId);
    if (!(await ref.get()).exists) {
      throw new HttpsError('not-found', 'El archivo no existe en la biblioteca.');
    }
    await ref.update({
      title: data.title,
      ...(data.project !== undefined ? { project: data.project } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      ...(data.advisorId !== undefined ? { advisorId: data.advisorId } : {}),
      ...(data.advisorName !== undefined ? { advisorName: data.advisorName } : {}),
      updatedAt: Timestamp.now(),
    });
    return { ok: true as const };
  }
);

export const deleteLibraryItem = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      itemId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const ref  = libraryCol(data.companyId).doc(data.itemId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'El archivo no existe en la biblioteca.');
    }

    // Borra primero el objeto de Storage (best-effort) y luego el doc.
    const storagePath = snap.get('storagePath') as string | undefined;
    if (storagePath) {
      try {
        assertLibraryPath(data.companyId, storagePath);
        await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
      } catch (err) {
        logger.warn('[Library] No se pudo borrar el objeto de Storage', { companyId: data.companyId, storagePath, err });
      }
    }
    await ref.delete();

    logger.info('[Library] Item borrado', { companyId: data.companyId, itemId: data.itemId });
    return { ok: true as const };
  }
);
