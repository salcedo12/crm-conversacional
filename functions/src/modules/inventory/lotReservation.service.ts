import { HttpsError } from 'firebase-functions/v2/https';
import { FieldPath } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { inventoryDb } from './inventory.client';
import {
  canRelease,
  checkReservable,
  normalizeStatus,
  releaseFields,
  reservationFields,
  tramiteFields,
  summaryEntry,
  toDealLot,
  type InventoryLotDoc,
  type ReservationInfo,
} from './inventory.logic';
import type { DealLot } from '../deals/deals.types';

/**
 * Reserva y liberación de lotes en el inventario de disponibilidad, en transacción
 * para que dos asesores nunca tomen el mismo lote. Además del lote actualiza su
 * entrada en proyectos_resumen (lo que ve el mapa al instante) y deja el cambio en
 * `logs`, igual que cuando lo hace un asesor desde tour-meraki.
 */

interface Actor { name: string; email: string }

function writeLog(lotId: string, lot: InventoryLotDoc, from: string, to: string, actor: Actor) {
  return inventoryDb().collection('logs').add({
    proyecto: lot.proyecto,
    loteId: lotId,
    numeroTerreno: String(lot.numeroTerreno ?? lot.lote ?? ''),
    sector: lot.sector || 'GENERAL',
    campoModificado: 'STATUS',
    valorAnterior: from,
    valorNuevo: to,
    usuarioName: `CRM · ${actor.name}`,
    usuarioEmail: actor.email || 'crm',
    fechaHora: new Date().toISOString(),
  }).catch((err) => logger.warn('[Inventory] No se pudo registrar el log', { lotId, error: String(err) }));
}

export async function reserveLot(lotId: string, info: ReservationInfo, actor: Actor): Promise<DealLot> {
  const idb = inventoryDb();
  const lotRef = idb.collection('inventario').doc(lotId);

  const result = await idb.runTransaction(async (tx) => {
    const snap = await tx.get(lotRef);
    const lot = snap.exists ? (snap.data() as InventoryLotDoc) : undefined;
    const check = checkReservable(lot, info.dealId);
    if (!check.ok) throw new HttpsError('failed-precondition', check.reason);

    const fields = reservationFields(new Date(), info);
    const updated: InventoryLotDoc = { ...lot!, ...fields };
    tx.update(lotRef, fields);
    tx.update(
      idb.collection('proyectos_resumen').doc(String(lot!.proyecto).toLowerCase()),
      new FieldPath('lots', lotId), summaryEntry(updated),
      'lastUpdated', new Date().toISOString(),
    );
    return { lot: lot!, previousStatus: normalizeStatus(lot!.status), dealLot: toDealLot(lotId, updated, fields.fechaVencimiento) };
  });

  void writeLog(lotId, result.lot, result.previousStatus, 'NEGOCIACION', actor);
  return result.dealLot;
}

/**
 * Contrato enviado a firma: el lote del negocio pasa a TRAMITE (si sigue apartado por él o
 * volvió a quedar DISPONIBLE). Si otro lo tomó, falla y no se envía nada a firma.
 */
export async function moveLotToTramite(lotId: string, info: ReservationInfo, actor: Actor): Promise<void> {
  const idb = inventoryDb();
  const lotRef = idb.collection('inventario').doc(lotId);

  const result = await idb.runTransaction(async (tx) => {
    const snap = await tx.get(lotRef);
    const lot = snap.exists ? (snap.data() as InventoryLotDoc) : undefined;
    const check = checkReservable(lot, info.dealId);
    if (!check.ok) throw new HttpsError('failed-precondition', check.reason);

    const fields = tramiteFields(new Date(), info);
    tx.update(lotRef, fields);
    tx.update(
      idb.collection('proyectos_resumen').doc(String(lot!.proyecto).toLowerCase()),
      new FieldPath('lots', lotId), summaryEntry({ ...lot!, ...fields }),
      'lastUpdated', new Date().toISOString(),
    );
    return { lot: lot!, previousStatus: normalizeStatus(lot!.status) };
  });

  if (result.previousStatus !== 'TRAMITE') void writeLog(lotId, result.lot, result.previousStatus, 'TRAMITE', actor);
}

/** Libera el lote si este negocio lo tiene apartado. Devuelve false si ya no estaba apartado por él. */
export async function releaseLot(lotId: string, dealId: string, actor: Actor): Promise<boolean> {
  const idb = inventoryDb();
  const lotRef = idb.collection('inventario').doc(lotId);

  const released = await idb.runTransaction(async (tx) => {
    const snap = await tx.get(lotRef);
    const lot = snap.exists ? (snap.data() as InventoryLotDoc) : undefined;
    if (!canRelease(lot, dealId)) return null;

    const fields = releaseFields(new Date());
    tx.update(lotRef, fields);
    tx.update(
      idb.collection('proyectos_resumen').doc(String(lot!.proyecto).toLowerCase()),
      new FieldPath('lots', lotId), summaryEntry({ ...lot!, ...fields }),
      'lastUpdated', new Date().toISOString(),
    );
    return { lot: lot!, previousStatus: normalizeStatus(lot!.status) };
  });

  if (released) void writeLog(lotId, released.lot, released.previousStatus, 'DISPONIBLE', actor);
  return !!released;
}

/** Estado actual del lote en el inventario (para saber si la reserva del negocio sigue vigente). */
export async function getLotStatus(lotId: string): Promise<{ status: string; dealId: string; expiresAt: string } | null> {
  const snap = await inventoryDb().collection('inventario').doc(lotId).get();
  if (!snap.exists) return null;
  const lot = snap.data() as InventoryLotDoc;
  return { status: normalizeStatus(lot.status), dealId: lot.crmDealId || '', expiresAt: lot.fechaVencimiento || '' };
}
