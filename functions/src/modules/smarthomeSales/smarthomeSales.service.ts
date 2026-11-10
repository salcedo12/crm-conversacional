import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import {
  getSmartHomeProjectProspects,
  getSmartHomeUnits,
  getSmartHomeUsers,
} from '../../integrations/smarthome/smarthome.client';
import {
  attachSiblingFiles,
  buildInventoryIndex,
  buildSaleDocs,
  inventoryOnlySales,
  SMARTHOME_SALES_PROJECTS,
  type InventoryLotRef,
  type InventoryOnlySale,
  type SmartHomeSaleDoc,
} from './smarthomeSales.logic';
import { inventoryDb } from '../inventory/inventory.client';

/** Disponibilidad (proyectos_resumen de tour-meraki). null si no se pudo leer: la sync sigue sin cruce. */
async function loadInventoryIndex(): Promise<Map<string, InventoryLotRef> | null> {
  try {
    const snap = await inventoryDb().collection('proyectos_resumen').get();
    return buildInventoryIndex(Object.fromEntries(snap.docs.map((doc) => [doc.id, (doc.data().lots ?? {}) as Record<string, { sec?: string; n?: string; s?: string }>])));
  } catch (err) {
    logger.warn('[smartHomeSales] no se pudo leer la disponibilidad', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export const smartHomeSalesCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('smarthomeSales');
export const smartHomeSalesStateRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('syncState').doc('smarthomeSales');

export interface SmartHomeSalesSyncResult {
  total:     number;
  removed:   number;
  byProject: Record<string, number>;
  /** Proyectos que SmartHome no respondió (sus ventas quedan como estaban). */
  failedProjects: string[];
}

/** SmartHome a veces tarda (>45 s) en getSales de Laguna: se reintenta una vez. */
async function withRetry<T>(load: () => Promise<T | null>): Promise<T | null> {
  return (await load()) ?? (await load());
}

/**
 * Copia en Firestore los lotes vendidos de SmartHome (1 doc por lote, id = moduleId).
 * Cada proyecto va por separado: si SmartHome no responde uno, los demás se
 * actualizan y del que falló no se borra nada (un listado a medias borraría
 * ventas reales). Solo lanza error si fallan todos.
 * El campo `ignored` (ventas de prueba) lo pone un admin y la sync no lo pisa.
 */
export async function syncSmartHomeSales(companyId: string): Promise<SmartHomeSalesSyncResult> {
  const users = await getSmartHomeUsers();
  const advisorNames = new Map((users ?? []).map((u) => [u.userId, `${u.firstName ?? ''} ${u.lastName ?? ''}`.replace(/\s+/g, ' ').trim()]));

  const inventory = await loadInventoryIndex();
  const docs: SmartHomeSaleDoc[] = [];
  const synced = new Set<string>();
  const failedProjects: string[] = [];
  // Por proyecto de SmartHome: lo que la disponibilidad da por vendido y SmartHome no.
  const inventoryOnly: Record<string, InventoryOnlySale[]> = {};
  // En serie: menos carga simultánea sobre SmartHome.
  for (const project of SMARTHOME_SALES_PROJECTS) {
    const [units, prospects] = await Promise.all([
      withRetry(() => getSmartHomeUnits(project.code)),
      withRetry(() => getSmartHomeProjectProspects(project.code)),
    ]);
    if (!units || !prospects) {
      failedProjects.push(project.code);
      continue;
    }
    synced.add(project.code);
    docs.push(...buildSaleDocs(project, units, prospects, advisorNames, inventory ?? undefined));
    if (inventory) inventoryOnly[project.code] = inventoryOnlySales(project, units, inventory);
  }
  if (!synced.size) throw new Error('SmartHome no respondió. Intenta de nuevo en unos minutos.');
  docs.splice(0, docs.length, ...attachSiblingFiles(docs));

  const col = smartHomeSalesCol(companyId);
  const existing = await col.select('smartHomeProjectCode').get();
  const current = new Set(docs.map((doc) => doc.moduleId));
  const stale = existing.docs.filter((snap) => !current.has(snap.id) && synced.has(String(snap.get('smartHomeProjectCode'))));

  const now = Timestamp.now();
  const writer = db.bulkWriter();
  for (const doc of docs) writer.set(col.doc(doc.moduleId), { ...doc, syncedAt: now }, { merge: true });
  for (const snap of stale) writer.delete(snap.ref);
  await writer.close();

  const byProject: Record<string, number> = {};
  for (const doc of docs) byProject[doc.crmProjectId] = (byProject[doc.crmProjectId] ?? 0) + 1;
  const failedNames = failedProjects.map(projectLabel);
  // merge: el proyecto que falló conserva su lista anterior de inventoryOnlyByProject.
  await smartHomeSalesStateRef(companyId).set({
    lastSyncAt: now, total: docs.length, byProject, failedProjects: failedNames,
    inventoryCheckedAt: inventory ? now : null,
    inventoryOnlyByProject: inventoryOnly,
  }, { merge: true });

  const log = failedProjects.length ? logger.warn : logger.info;
  log('[smartHomeSales] sincronizado', { companyId, total: docs.length, removed: stale.length, byProject, failedProjects });
  return { total: docs.length, removed: stale.length, byProject, failedProjects: failedNames };
}

const PROJECT_LABELS: Record<string, string> = {
  'laguna-mar': 'Laguna Mar',
  'cañon-arizona': 'Cañón de Arizona (con Llano Grande y Sobre Montañas)',
  'rio-claro': 'Río Claro',
};

function projectLabel(code: string): string {
  const project = SMARTHOME_SALES_PROJECTS.find((p) => p.code === code);
  return (project && PROJECT_LABELS[project.crmProjectId]) || code;
}
