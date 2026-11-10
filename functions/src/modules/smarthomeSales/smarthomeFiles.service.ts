import { Timestamp } from 'firebase-admin/firestore';
import { db, storage } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { downloadSmartHomeProspectFile } from '../../integrations/smarthome/smarthome.client';
import { smartHomeSalesCol } from './smarthomeSales.service';
import type { SmartHomeSaleFile } from './smarthomeSales.logic';

/**
 * Copia en Firebase Storage los archivos que los clientes tienen en SmartHome,
 * para no depender de SmartHome cuando se deje de usar.
 *
 * 1 doc por archivo en `smarthomeFiles/{fileId}` (aparte de smarthomeSales: si la
 * venta se cae en SmartHome, la copia se conserva). Los que fallan se reintentan
 * en las siguientes corridas hasta MAX_ATTEMPTS.
 */

export const smartHomeFilesCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('smarthomeFiles');

// Fallos pasajeros: se reintenta en cada corrida horaria durante ~1 día.
// Los archivos perdidos en SmartHome ('missing') no se reintentan.
const MAX_ATTEMPTS = 24;
const CONCURRENCY = 3;

export interface SmartHomeFileDoc {
  fileId:       string;
  prospectId:   string;
  moduleId:     string;
  crmProjectId: string;
  title:        string;
  /** missing = SmartHome lo lista pero el archivo ya no existe allá (no se puede recuperar). */
  status:       'copied' | 'failed' | 'missing';
  attempts:     number;
  storagePath?: string;
  fileName?:    string;
  contentType?: string;
  size?:        number;
  lastError?:   string;
  copiedAt?:    Timestamp;
  updatedAt:    Timestamp;
}

interface PendingFile { fileId: string; title: string; prospectId: string; moduleId: string; crmProjectId: string; attempts: number }

function safeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120) || 'archivo';
}

/** Archivos listados en las ventas sincronizadas que aún no están copiados. */
export async function pendingSmartHomeFiles(companyId: string): Promise<PendingFile[]> {
  const [sales, files] = await Promise.all([smartHomeSalesCol(companyId).get(), smartHomeFilesCol(companyId).get()]);
  const state = new Map(files.docs.map((doc) => [doc.id, doc.data() as SmartHomeFileDoc]));
  const pending: PendingFile[] = [];
  const queued = new Set<string>();
  for (const sale of sales.docs) {
    const row = sale.data() as { prospectId?: string; crmProjectId?: string; files?: SmartHomeSaleFile[] };
    if (!row.prospectId) continue;
    for (const file of row.files ?? []) {
      const current = state.get(file.id);
      // El mismo archivo puede estar en 2 lotes (compartido entre lotes del comprador): se copia una vez,
      // desde el lote que lo tiene (fromLot vacío) para que moduleId apunte a la venta original.
      if (file.fromLot || queued.has(file.id)) continue;
      if (current?.status === 'copied' || current?.status === 'missing' || (current?.attempts ?? 0) >= MAX_ATTEMPTS) continue;
      queued.add(file.id);
      pending.push({ fileId: file.id, title: file.title, prospectId: file.prospectId || row.prospectId, moduleId: sale.id, crmProjectId: row.crmProjectId ?? '', attempts: current?.attempts ?? 0 });
    }
  }
  return pending;
}

async function copyOne(companyId: string, file: PendingFile): Promise<boolean> {
  const ref = smartHomeFilesCol(companyId).doc(file.fileId);
  const base = { fileId: file.fileId, prospectId: file.prospectId, moduleId: file.moduleId, crmProjectId: file.crmProjectId, title: file.title };
  try {
    const download = await downloadSmartHomeProspectFile(file.prospectId, file.fileId);
    if (!download) throw new Error('SmartHome no devolvió el archivo');
    if (download.status === 'missing') {
      await ref.set({
        ...base, status: 'missing', attempts: file.attempts + 1, lastError: download.reason, updatedAt: Timestamp.now(),
      } satisfies SmartHomeFileDoc);
      return false;
    }
    const fileName = download.fileName || file.title;
    const storagePath = `companies/${companyId}/smarthome-files/${file.prospectId}/${file.fileId}-${safeName(fileName)}`;
    await storage.bucket().file(storagePath).save(download.buffer, {
      contentType: download.contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });
    const now = Timestamp.now();
    await ref.set({
      ...base, status: 'copied', attempts: file.attempts + 1, storagePath, fileName,
      contentType: download.contentType, size: download.buffer.length, copiedAt: now, updatedAt: now,
    } satisfies SmartHomeFileDoc);
    return true;
  } catch (err) {
    await ref.set({
      ...base, status: 'failed', attempts: file.attempts + 1,
      lastError: err instanceof Error ? err.message : String(err), updatedAt: Timestamp.now(),
    } satisfies SmartHomeFileDoc);
    return false;
  }
}

/** Copia pendientes hasta agotar `budgetMs` (para no pasarse del timeout de la función). */
export async function copySmartHomeFiles(companyId: string, budgetMs: number): Promise<{ copied: number; failed: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  const queue = await pendingSmartHomeFiles(companyId);
  let copied = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const file = queue[next++];
      if (await copyOne(companyId, file)) copied += 1; else failed += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const remaining = queue.length - next;
  if (copied || failed) logger.info('[smartHomeFiles] copia', { companyId, copied, failed, remaining });
  return { copied, failed, remaining };
}
