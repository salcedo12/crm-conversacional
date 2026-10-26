import { db } from './admin';
import { logger } from '../utils/logger';

/**
 * Caché de reportes agregados (dashboard, informes por asesor).
 *
 * Problema que resuelve: getDashboardMetrics y getAdvisorReports escanean TODA
 * la colección de leads (y, en el caso de informes, los mensajes de cada lead)
 * en CADA llamada. Con varios admins abriendo el panel, eso relee la base entera
 * muchas veces al día → costo alto de lecturas y riesgo de timeout con bases
 * grandes.
 *
 * Solución: se guarda el resultado calculado en
 * `companies/{companyId}/reportCache/{key}` con su marca de tiempo. Mientras el
 * caché siga fresco (dentro del TTL) las llamadas devuelven el doc cacheado
 * (1 lectura) en vez de recalcular. El recálculo ocurre, como máximo, una vez
 * por TTL sin importar cuántos usuarios abran el panel.
 *
 * El payload se guarda como JSON plano (sin `undefined`, que Firestore rechaza).
 * Los payloads de estos reportes son agregados pequeños, muy por debajo del
 * límite de 1 MiB por documento.
 */

const cacheRef = (companyId: string, key: string) =>
  db.collection('companies').doc(companyId).collection('reportCache').doc(key);

export interface CachedMeta {
  /** true si se sirvió desde caché; false si se recalculó en esta llamada. */
  cached:     boolean;
  /** epoch ms del cálculo que produjo estos datos. */
  computedAt: number;
}

/**
 * Devuelve el reporte cacheado si sigue fresco; si no, ejecuta `compute`,
 * guarda el resultado y lo devuelve. Añade `cached` y `computedAt` al payload.
 *
 * @param ttlMs  Ventana de frescura en ms (p. ej. 5 min dashboard, 10 min informes).
 * @param force  Si es true, ignora el caché y recalcula (para un botón "Actualizar").
 */
export async function getCachedReport<T extends object>(
  companyId: string,
  key:       string,
  ttlMs:     number,
  compute:   () => Promise<T>,
  force = false,
): Promise<T & CachedMeta> {
  const ref = cacheRef(companyId, key);

  if (!force) {
    try {
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data() as { payload?: T; computedAt?: number } | undefined;
        if (data?.payload && typeof data.computedAt === 'number' && Date.now() - data.computedAt < ttlMs) {
          return { ...data.payload, cached: true, computedAt: data.computedAt };
        }
      }
    } catch (err) {
      // Un fallo leyendo el caché no debe tumbar el reporte: se recalcula.
      logger.warn('[reportCache] No se pudo leer el caché — se recalcula', {
        companyId, key, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const payload    = await compute();
    const computedAt = Date.now();

    // JSON round-trip: elimina `undefined` (que Firestore no acepta) y garantiza
    // un objeto plano serializable.
    const plain = JSON.parse(JSON.stringify(payload)) as T;
    await ref.set({ payload: plain, computedAt }).catch((err) => {
      logger.warn('[reportCache] No se pudo escribir el caché', {
        companyId, key, error: err instanceof Error ? err.message : String(err),
      });
    });

    return { ...payload, cached: false, computedAt };
  } catch (computeErr) {
    logger.error('[reportCache] Falló compute(), intentando servir caché existente como salvavidas', {
      companyId, key, error: computeErr instanceof Error ? computeErr.message : String(computeErr),
    });
    try {
      const fallbackSnap = await ref.get();
      if (fallbackSnap.exists) {
        const data = fallbackSnap.data() as { payload?: T; computedAt?: number } | undefined;
        if (data?.payload) {
          return { ...data.payload, cached: true, computedAt: data.computedAt ?? Date.now() };
        }
      }
    } catch {
      // Si tampoco se puede leer el doc de caché, relanzamos el error original
    }
    throw computeErr;
  }
}
