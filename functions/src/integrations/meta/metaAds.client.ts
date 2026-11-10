import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface AdSpend {
  adId:        string;
  adName:      string;
  spend:       number;
  impressions: number;
  clicks:      number;
}

/** Ventana temporal para el gasto. 'all' = histórico (lifetime). */
export type AdSpendRange = 'all' | '7d' | '30d' | '90d';

/** Traduce el rango de la UI al date_preset de la Meta Marketing API. */
function datePresetFor(range: AdSpendRange): string {
  switch (range) {
    case '7d':  return 'last_7d';
    case '30d': return 'last_30d';
    case '90d': return 'last_90d';
    default:    return 'maximum';
  }
}

/** Estado normalizado del anuncio para la UI. */
export type AdStatus = 'active' | 'paused' | 'other';

export interface AdMeta {
  adId:            string;
  adName:          string;
  status:          AdStatus;
  effectiveStatus: string;   // valor crudo de Meta (ACTIVE, PAUSED, DISAPPROVED, …)
  campaignName:    string | null;
  adsetName:       string | null;
}

function normalizeStatus(effective: string): AdStatus {
  if (effective === 'ACTIVE') return 'active';
  if (effective === 'PAUSED' || effective === 'CAMPAIGN_PAUSED' || effective === 'ADSET_PAUSED') return 'paused';
  return 'other';
}

interface InsightRow {
  ad_id?:      string;
  ad_name?:    string;
  spend?:      string;
  impressions?: string;
  clicks?:     string;
}

interface InsightsResponse {
  data?:   InsightRow[];
  paging?: { next?: string };
  error?:  { message?: string; type?: string; code?: number };
}

/**
 * Trae el gasto de anuncios (lifetime o por rango) por anuncio desde la Meta Marketing API.
 * Devuelve un mapa adId → gasto/impresiones/clics. Ante cualquier error de red o
 * de permisos, loguea y devuelve null (el ranking de calidad sigue funcionando
 * sin costos).
 */
export async function getLifetimeAdSpend(
  range: AdSpendRange = 'all',
  config?: { accessToken?: string; adAccountId?: string },
  /** Rango personalizado (YYYY-MM-DD, inclusivo). Si viene, reemplaza a `range`. */
  customRange?: { since: string; until: string }
): Promise<Map<string, AdSpend> | null> {
  const token = config?.accessToken || env.metaAdsAccessToken();
  const rawAccount = config?.adAccountId || env.metaAdAccountId();
  const account = rawAccount ? rawAccount.replace(/^act_/, '') : '';

  if (!token || !account) return null;

  const version = env.metaGraphVersion();

  const params = new URLSearchParams({
    level:       'ad',
    fields:      'ad_id,ad_name,spend,impressions,clicks',
    limit:       '500',
    access_token: token,
  });
  if (customRange) params.set('time_range', JSON.stringify(customRange));
  else params.set('date_preset', datePresetFor(range));

  let url: string | null =
    `https://graph.facebook.com/${version}/act_${account}/insights?${params.toString()}`;

  const result = new Map<string, AdSpend>();
  let pages = 0;

  try {
    while (url && pages < 20) {
      const res  = await fetch(url);
      const body = (await res.json()) as InsightsResponse;

      if (body.error) {
        logger.error('[metaAds] Graph API error', {
          message: body.error.message, code: body.error.code, type: body.error.type,
        });
        return null;
      }

      for (const row of body.data ?? []) {
        if (!row.ad_id) continue;
        result.set(row.ad_id, {
          adId:        row.ad_id,
          adName:      row.ad_name ?? '',
          spend:       Number(row.spend ?? 0) || 0,
          impressions: Number(row.impressions ?? 0) || 0,
          clicks:      Number(row.clicks ?? 0) || 0,
        });
      }

      url = body.paging?.next ?? null;
      pages++;
    }
  } catch (err) {
    logger.error('[metaAds] Error consultando insights', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  return result;
}

interface AdMetaRow {
  id?:              string;
  name?:            string;
  effective_status?: string;
  campaign?:        { name?: string };
  adset?:           { name?: string };
}

interface AdsMetaResponse {
  data?:   AdMetaRow[];
  paging?: { next?: string };
  error?:  { message?: string; type?: string; code?: number };
}

/**
 * Trae el estado (Activo/Pausado/…) y la campaña de cada anuncio de la cuenta,
 * para poder mostrar/filtrar por estado y por campaña. Excluye anuncios
 * archivados/borrados. Ante error devuelve null (la página sigue sin estado).
 */
export async function getAdsMeta(
  config?: { accessToken?: string; adAccountId?: string }
): Promise<Map<string, AdMeta> | null> {
  const token = config?.accessToken || env.metaAdsAccessToken();
  const rawAccount = config?.adAccountId || env.metaAdAccountId();
  const account = rawAccount ? rawAccount.replace(/^act_/, '') : '';

  if (!token || !account) return null;

  const version = env.metaGraphVersion();

  const params = new URLSearchParams({
    fields: 'id,name,effective_status,campaign{name},adset{name}',
    limit:  '500',
    access_token: token,
  });

  let url: string | null =
    `https://graph.facebook.com/${version}/act_${account}/ads?${params.toString()}`;

  const result = new Map<string, AdMeta>();
  let pages = 0;

  try {
    while (url && pages < 20) {
      const res  = await fetch(url);
      const body = (await res.json()) as AdsMetaResponse;

      if (body.error) {
        logger.error('[metaAds] Graph API error (ads)', {
          message: body.error.message, code: body.error.code, type: body.error.type,
        });
        return null;
      }

      for (const row of body.data ?? []) {
        if (!row.id) continue;
        const effective = row.effective_status ?? '';
        if (effective === 'ARCHIVED' || effective === 'DELETED') continue;
        result.set(row.id, {
          adId:            row.id,
          adName:          row.name ?? '',
          status:          normalizeStatus(effective),
          effectiveStatus: effective,
          campaignName:    row.campaign?.name ?? null,
          adsetName:       row.adset?.name ?? null,
        });
      }

      url = body.paging?.next ?? null;
      pages++;
    }
  } catch (err) {
    logger.error('[metaAds] Error consultando ads', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  return result;
}
