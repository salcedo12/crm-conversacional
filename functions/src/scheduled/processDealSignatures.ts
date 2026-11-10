import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { refreshSignatures } from '../modules/deals/dealSignature.service';
import type { Deal } from '../modules/deals/deals.types';

/**
 * AUTOMÁTICO: cada 10 min consulta en DocuBlock los contratos en firma (negocios con
 * `signaturePending`) y actualiza quién firmó; al terminar guarda el PDF firmado.
 * DocuBlock no nos avisa (su webhook es de otro sistema), por eso se consulta.
 */
export const processDealSignatures = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: 'us-central1',
    timeZone: 'America/Bogota',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['DOCUBLOCK_API_KEY'],
  },
  async () => {
    const snap = await db.collectionGroup('deals').where('signaturePending', '==', true).limit(200).get();
    let updated = 0;
    for (const doc of snap.docs) {
      try {
        const deal = { id: doc.id, ...doc.data() } as Deal;
        if ((await refreshSignatures(doc.ref, deal)).changed) updated += 1;
      } catch (err) {
        logger.error('[processDealSignatures] error por negocio', { dealId: doc.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (snap.size) logger.info('[processDealSignatures] consulta', { enFirma: snap.size, actualizados: updated });
  },
);
