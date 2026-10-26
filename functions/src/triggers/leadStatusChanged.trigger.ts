import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import { sendLeadConversion } from '../modules/meta/leadConversions.service';
import type { Lead } from '../modules/leads/leads.types';

/**
 * Al cambiar el estado de un lead que vino de un anuncio "Click to WhatsApp",
 * devuelve la conversión a Meta (CAPI) usando su ctwa_clid. Así Meta aprende a
 * optimizar la pauta hacia gente que realmente agenda/cierra, no solo que abre
 * WhatsApp. La config sale de channelCredentials/{companyId}.metaCapi.
 */
export const onLeadStatusChanged = onDocumentUpdated(
  { document: 'companies/{companyId}/leads/{leadId}', region: 'us-central1' },
  async (event) => {
    const before = event.data?.before.data() as Lead | undefined;
    const after  = event.data?.after.data() as Lead | undefined;
    if (!before || !after) return;

    // Solo actuar cuando cambia el estado (el doc se actualiza por muchos motivos).
    if (before.status === after.status) return;

    const { companyId, leadId } = event.params;
    const result = await sendLeadConversion(companyId, leadId, after);
    // si falla no se marca: se reintentará en el próximo cambio de estado

    if (result.status !== 'skipped') {
      logger.info('[CAPI] Conversión de lead', {
        companyId, leadId, ...result, from: before.status, to: after.status,
      });
    }
  }
);
