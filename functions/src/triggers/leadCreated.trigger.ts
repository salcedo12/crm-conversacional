import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import { enqueueInitialAutoCall } from '../modules/autocall/autoCall.service';
import type { Lead } from '../modules/leads/leads.types';

/**
 * Al crear un lead nuevo, si el modo de llamadas IA automáticas está activo y el
 * lead es elegible (entró por mensajería y tiene teléfono), encola la llamada
 * inicial. El disparo real lo hace el cron `processAutoCalls`, que respeta el
 * horario diurno del país del lead. Ver [autoCall.service].
 */
export const onLeadCreatedAutoCall = onDocumentCreated(
  { document: 'companies/{companyId}/leads/{leadId}', region: 'us-central1' },
  async (event) => {
    const companyId = event.params.companyId;
    const leadId    = event.params.leadId;
    const data = event.data?.data() as Omit<Lead, 'id'> | undefined;
    if (!data) return;

    try {
      await enqueueInitialAutoCall(companyId, { id: leadId, ...data } as Lead);
    } catch (err) {
      logger.error('[AutoCall] Error encolando llamada inicial', {
        companyId, leadId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
