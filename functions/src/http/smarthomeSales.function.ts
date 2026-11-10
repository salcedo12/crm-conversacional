import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { isAdmin, parseInput } from '../modules/deals/dealAccess';
import { resolveOwnerId, smartHomeEnabledForCompany } from '../modules/smarthome/smarthomeSync.service';
import { DEFAULT_IGNORED_PROSPECT_IDS } from '../modules/smarthomeSales/smarthomeSales.logic';
import { smartHomeSalesCol, smartHomeSalesStateRef, syncSmartHomeSales } from '../modules/smarthomeSales/smarthomeSales.service';
import { copySmartHomeFiles, smartHomeFilesCol, type SmartHomeFileDoc } from '../modules/smarthomeSales/smarthomeFiles.service';
import { storage } from '../lib/admin';

/**
 * Lotes vendidos en SmartHome (copia en Firestore que arma syncSmartHomeSales).
 * Admin ve todos; el asesor solo los suyos (ownerId = su usuario de SmartHome).
 */

const CompanySchema = z.object({ companyId: z.string().min(1) });

const millis = (value: unknown) => (value as Timestamp | undefined)?.toMillis?.() ?? null;

export const listSmartHomeSales = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(CompanySchema, request.data, 'listar ventas de SmartHome');
  assertCompany(ctx, data.companyId);

  if (!(await smartHomeEnabledForCompany(data.companyId))) return { enabled: false, sales: [], lastSyncAt: null, inventoryCheckedAt: null, inventoryOnly: [] };

  const admin = isAdmin(ctx);
  const ownerId = admin ? null : (await resolveOwnerId(data.companyId, ctx.uid)).ownerId;
  if (!admin && !ownerId) return { enabled: true, sales: [], lastSyncAt: null, inventoryCheckedAt: null, inventoryOnly: [] };

  const query = admin ? smartHomeSalesCol(data.companyId) : smartHomeSalesCol(data.companyId).where('ownerId', '==', ownerId);
  const [snap, state, copies] = await Promise.all([
    query.get(),
    smartHomeSalesStateRef(data.companyId).get(),
    smartHomeFilesCol(data.companyId).where('status', 'in', ['copied', 'missing']).select('status').get(),
  ]);
  const copied = new Set(copies.docs.filter((doc) => doc.get('status') === 'copied').map((doc) => doc.id));
  const missing = new Set(copies.docs.filter((doc) => doc.get('status') === 'missing').map((doc) => doc.id));
  const sales = snap.docs.map((doc) => {
    const row = doc.data();
    const ignored = typeof row.ignored === 'boolean'
      ? row.ignored
      : DEFAULT_IGNORED_PROSPECT_IDS.has(String(row.prospectId)) || (String(row.buyerName || '').toUpperCase().includes('WALTEROS'));
    const files = ((row.files ?? []) as Array<{ id: string; title: string }>).map((file) => ({ ...file, copied: copied.has(file.id), missing: missing.has(file.id) }));
    return { ...row, id: doc.id, ignored, files, syncedAt: millis(row.syncedAt) };
  }).filter((sale) => admin || !sale.ignored);

  const stateData = state.data() ?? {};
  const inventoryOnly = Object.values((stateData.inventoryOnlyByProject ?? {}) as Record<string, unknown[]>).flat();
  return {
    enabled: true,
    sales,
    lastSyncAt: millis(stateData.lastSyncAt),
    inventoryCheckedAt: millis(stateData.inventoryCheckedAt),
    inventoryOnly,
  };
});

export const syncSmartHomeSalesNow = onCall({ region: 'us-central1', timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const startedAt = Date.now();
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(CompanySchema, request.data, 'sincronizar ventas de SmartHome');
  assertCompany(ctx, data.companyId);
  if (!(await smartHomeEnabledForCompany(data.companyId))) {
    throw new HttpsError('failed-precondition', 'SmartHome no está activo para esta empresa.');
  }
  try {
    const sync = await syncSmartHomeSales(data.companyId);
    // Una tanda de copia de archivos con el tiempo que sobre (máx. 3 min); el resto
    // lo sigue processSmartHomeFileCopy cada hora.
    const budget = Math.min(180_000, 480_000 - (Date.now() - startedAt));
    const files = budget > 10_000 ? await copySmartHomeFiles(data.companyId, budget) : { copied: 0, failed: 0, remaining: -1 };
    return { ...sync, files };
  } catch (err) {
    throw new HttpsError('unavailable', err instanceof Error ? err.message : 'No se pudo sincronizar con SmartHome.');
  }
});

const FileSchema = z.object({ companyId: z.string().min(1), fileId: z.string().min(1) });

/** Descarga la copia (en Storage del CRM) de un archivo de SmartHome. Asesor: solo de sus ventas. */
export const downloadSmartHomeFile = onCall({ region: 'us-central1', timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, WRITE_ROLES);
  const data = parseInput(FileSchema, request.data, 'descargar el archivo');
  assertCompany(ctx, data.companyId);

  const snap = await smartHomeFilesCol(data.companyId).doc(data.fileId).get();
  const file = snap.data() as SmartHomeFileDoc | undefined;
  if (!file || file.status !== 'copied' || !file.storagePath) {
    throw new HttpsError('not-found', 'Este archivo todavía no está copiado en el CRM.');
  }
  if (!isAdmin(ctx)) {
    const [sale, owner] = await Promise.all([
      smartHomeSalesCol(data.companyId).doc(file.moduleId).get(),
      resolveOwnerId(data.companyId, ctx.uid),
    ]);
    if (!owner.ownerId || sale.data()?.ownerId !== owner.ownerId) {
      throw new HttpsError('permission-denied', 'Solo puedes descargar archivos de tus ventas.');
    }
  }
  const [buffer] = await storage.bucket().file(file.storagePath).download();
  return { fileName: file.fileName || file.title, contentType: file.contentType || 'application/octet-stream', base64: buffer.toString('base64') };
});

const IgnoreSchema =z.object({ companyId: z.string().min(1), moduleId: z.string().min(1), ignored: z.boolean() });

/** Marca/desmarca una venta como "de prueba" (se oculta en el CRM; la sync no lo pisa). */
export const setSmartHomeSaleIgnored = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const data = parseInput(IgnoreSchema, request.data, 'marcar la venta');
  assertCompany(ctx, data.companyId);
  const ref = smartHomeSalesCol(data.companyId).doc(data.moduleId);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Venta no encontrada.');
  await ref.set({ ignored: data.ignored }, { merge: true });
  return { ok: true as const };
});
