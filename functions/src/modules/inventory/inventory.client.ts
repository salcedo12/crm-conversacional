import '../../lib/admin'; // la app por defecto del CRM debe inicializarse primero
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore del inventario de disponibilidad (otro proyecto Firebase, app tour-meraki).
 *
 * - Producción: `disponibilidad-e8a81` (o INVENTORY_PROJECT_ID). La cuenta de servicio
 *   de las Cloud Functions del CRM necesita el rol "Cloud Datastore User" en ese proyecto.
 * - Emulador: `demo-disponibilidad` dentro del mismo emulador de Firestore (los datos
 *   van separados por proyecto); nunca toca el inventario real.
 */
const APP_NAME = 'inventory';

export function inventoryProjectId(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return 'demo-disponibilidad';
  return process.env.INVENTORY_PROJECT_ID || 'disponibilidad-e8a81';
}

let _db: Firestore | null = null;

export function inventoryDb(): Firestore {
  if (_db) return _db;
  const app = getApps().find((a) => a.name === APP_NAME)
    ?? initializeApp({ projectId: inventoryProjectId() }, APP_NAME);
  _db = getFirestore(app);
  return _db;
}
