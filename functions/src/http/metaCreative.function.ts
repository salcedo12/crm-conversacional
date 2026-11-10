import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { getAdCreativeDetails } from '../modules/meta/metaCreative.service';
import {
  getMetaAdsConfigForCompany,
  saveMetaAdsConfigForCompany,
} from '../modules/companies/channelCredentials.repository';
import { leadsRepository } from '../modules/leads/leads.repository';
import { logger } from '../utils/logger';

const CALLABLE_OPTIONS = { region: 'us-central1', timeoutSeconds: 30, cors: true } as const;

export const getMetaAdCreative = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, adId, leadId } = z.object({
      companyId: z.string().min(1),
      adId:      z.string().min(1),
      leadId:    z.string().optional(),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    const creative = await getAdCreativeDetails(companyId, adId);

    // Si se pasó leadId y obtuvimos video o imagen, enriquecer el lead si aún no los tenía
    if (leadId && (creative.videoUrl || creative.imageUrl)) {
      try {
        const lead = await leadsRepository.findById(companyId, leadId);
        if (lead && lead.source === 'meta_ads' && (!lead.sourceMeta?.videoUrl || !lead.sourceMeta?.imageUrl)) {
          await leadsRepository.update(companyId, leadId, {
            sourceMeta: {
              ...lead.sourceMeta,
              ...(creative.videoUrl && { videoUrl: creative.videoUrl }),
              ...(creative.imageUrl && { imageUrl: creative.imageUrl }),
              ...(creative.headline && { headline: creative.headline }),
            },
          });
        }
      } catch (err) {
        logger.warn('[metaCreative] No se pudo enriquecer el lead con el video', { leadId, err: String(err) });
      }
    }

    return { creative };
  }
);

export const getMetaAdsConfigCallable = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId } = z.object({
      companyId: z.string().min(1),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    const config = await getMetaAdsConfigForCompany(companyId);

    return {
      configured:  !!config.accessToken,
      hasToken:    !!config.accessToken,
      adAccountId: config.adAccountId || '',
    };
  }
);

export const saveMetaAdsConfigCallable = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, accessToken, adAccountId } = z.object({
      companyId:   z.string().min(1),
      accessToken: z.string().optional(),
      adAccountId: z.string().optional(),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    await saveMetaAdsConfigForCompany(companyId, {
      ...(typeof accessToken === 'string' && { accessToken }),
      ...(typeof adAccountId === 'string' && { adAccountId }),
    });

    return { ok: true };
  }
);

export const testMetaAdsConnection = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId } = z.object({
      companyId: z.string().min(1),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    const config = await getMetaAdsConfigForCompany(companyId);
    if (!config.accessToken) {
      throw new HttpsError('failed-precondition', 'No hay token de Meta Ads configurado.');
    }

    try {
      const endpoint = config.adAccountId
        ? `https://graph.facebook.com/v21.0/act_${config.adAccountId}?fields=name,account_status,currency&access_token=${encodeURIComponent(config.accessToken)}`
        : `https://graph.facebook.com/v21.0/me?fields=name,id&access_token=${encodeURIComponent(config.accessToken)}`;

      const res = await fetch(endpoint);
      const data = await res.json() as { name?: string; account_status?: number; currency?: string; error?: { message?: string } };

      if (data.error) {
        throw new HttpsError('invalid-argument', `Error de Meta: ${data.error.message || 'Token inválido'}`);
      }

      return {
        ok:          true,
        accountName: data.name || 'Conexión válida',
        currency:    data.currency || 'COP',
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', `Fallo al verificar con Meta: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);
