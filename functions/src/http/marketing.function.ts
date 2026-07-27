import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { env } from '../config/env';
import { getLifetimeAdSpend, getAdsMeta } from '../integrations/meta/metaAds.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import type { Lead } from '../modules/leads/leads.types';

/** Score a partir del cual un lead se considera "calificado" (para costo por lead calificado). */
const QUALIFIED_SCORE = 60;

/**
 * Métricas de marketing: cruza el anuncio de origen (sourceMeta) con la calidad
 * (score IA) y la conversión (estado del lead). Responde "qué anuncio/fuente
 * trae los mejores leads", algo que el panel de Meta no puede saber porque no ve
 * el resultado comercial. Solo admin/manager.
 */

interface AdAcc {
  key: string;
  adId: string | null;
  headline: string | null;
  leads: number;
  analyzed: number;
  scoreSum: number;
  hot: number;
  qualified: number;   // leads con score >= QUALIFIED_SCORE
  scheduled: number;   // alcanzó agendamiento (status scheduled o closed)
  closed: number;
  lost: number;
  lossCount: Map<string, number>;
}

function newAcc(key: string, adId: string | null, headline: string | null): AdAcc {
  return { key, adId, headline, leads: 0, analyzed: 0, scoreSum: 0, hot: 0, qualified: 0, scheduled: 0, closed: 0, lost: 0, lossCount: new Map() };
}

function accumulate(acc: AdAcc, lead: Lead): void {
  acc.leads++;
  if (lead.status === 'scheduled' || lead.status === 'closed') acc.scheduled++;
  if (lead.status === 'closed') acc.closed++;
  if (lead.status === 'lost') acc.lost++;

  const ai = lead.aiAnalysis;
  if (ai && typeof ai.score === 'number') {
    acc.analyzed++;
    acc.scoreSum += ai.score;
    if (ai.temperature === 'hot') acc.hot++;
    if (ai.score >= QUALIFIED_SCORE) acc.qualified++;
    if (lead.status === 'lost' && ai.lossCategory && ai.lossCategory !== 'ninguno') {
      acc.lossCount.set(ai.lossCategory, (acc.lossCount.get(ai.lossCategory) ?? 0) + 1);
    }
  }
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Redondea un costo a 2 decimales (o null si el divisor es 0). */
function cost(spend: number, count: number): number | null {
  return count > 0 ? Math.round((spend / count) * 100) / 100 : null;
}

function finalizeAd(acc: AdAcc) {
  const topLoss = [...acc.lossCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    key:          acc.key,
    adId:         acc.adId,
    headline:     acc.headline,
    leads:        acc.leads,
    analyzed:     acc.analyzed,
    avgScore:     acc.analyzed > 0 ? Math.round(acc.scoreSum / acc.analyzed) : 0,
    hot:          acc.hot,
    qualified:    acc.qualified,
    scheduled:    acc.scheduled,
    closed:       acc.closed,
    lost:         acc.lost,
    scheduleRate: pct(acc.scheduled, acc.leads),
    convRate:     pct(acc.closed, acc.leads),
    topLoss,
  };
}

export const getMarketingMetrics = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const leadsSnap = await db
      .collection('companies').doc(companyId)
      .collection('leads')
      .get();

    const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead));

    const adMap = new Map<string, AdAcc>();       // por anuncio (meta_ads)
    const sourceMap = new Map<string, AdAcc>();    // por fuente (todas)
    let totalMetaLeads = 0;

    for (const lead of leads) {
      // ── Por fuente ──────────────────────────────────────────────────────────
      const src = lead.source || 'whatsapp';
      let srcAcc = sourceMap.get(src);
      if (!srcAcc) { srcAcc = newAcc(src, null, null); sourceMap.set(src, srcAcc); }
      accumulate(srcAcc, lead);

      // ── Por anuncio (solo leads que vienen de un anuncio de Meta) ────────────
      const meta = lead.sourceMeta;
      if (lead.source === 'meta_ads' || meta?.adId || meta?.headline) {
        totalMetaLeads++;
        const key = meta?.adId || meta?.headline || '__sin_id__';
        let adAcc = adMap.get(key);
        if (!adAcc) { adAcc = newAcc(key, meta?.adId ?? null, meta?.headline ?? null); adMap.set(key, adAcc); }
        accumulate(adAcc, lead);
      }
    }

    const leadRows = [...adMap.values()].map(finalizeAd);

    // ── Gasto + estado/campaña de Meta (en paralelo; null si no configurado) ────
    const [spendMap, adsMeta] = await Promise.all([getLifetimeAdSpend(), getAdsMeta()]);
    let totalSpend = 0;

    // Índice de filas de leads por adId (para unir con el gasto).
    const leadByAdId = new Map<string, ReturnType<typeof finalizeAd>>();
    const headlineOnly: ReturnType<typeof finalizeAd>[] = [];
    for (const r of leadRows) {
      if (r.adId) leadByAdId.set(r.adId, r);
      else headlineOnly.push(r);
    }

    const withSpend = (row: ReturnType<typeof finalizeAd>, s?: { spend: number; impressions: number; clicks: number }) => {
      const meta = row.adId ? adsMeta?.get(row.adId) : undefined;
      const withMeta = {
        ...row,
        status:          meta?.status ?? null,           // 'active' | 'paused' | 'other' | null (desconocido)
        effectiveStatus: meta?.effectiveStatus ?? null,
        campaignName:    meta?.campaignName ?? null,
        adsetName:       meta?.adsetName ?? null,
      };
      if (!s) return { ...withMeta, spend: null, impressions: null, clicks: null, cpl: null, cpql: null, cpa: null, cpc: null };
      return {
        ...withMeta,
        spend:       Math.round(s.spend * 100) / 100,
        impressions: s.impressions,
        clicks:      s.clicks,
        cpl:         cost(s.spend, row.leads),      // costo por lead
        cpql:        cost(s.spend, row.qualified),  // costo por lead calificado
        cpa:         cost(s.spend, row.scheduled),  // costo por cita
        cpc:         cost(s.spend, row.closed),     // costo por cierre
      };
    };

    // Unión: anuncios con gasto + con leads + activos/pausados (aunque no tengan
    // ni gasto ni leads, para que SIEMPRE se vean los que están corriendo hoy).
    const rows: ReturnType<typeof withSpend>[] = [];
    const seen = new Set<string>();

    if (spendMap) {
      for (const [adId, s] of spendMap) {
        totalSpend += s.spend;
        seen.add(adId);
        const nameFallback = adsMeta?.get(adId)?.adName || s.adName || null;
        const leadRow = leadByAdId.get(adId) ?? finalizeAd(newAcc(adId, adId, nameFallback));
        rows.push(withSpend(leadRow, s));
      }
    }
    // Filas de leads con adId que NO tuvieron gasto en Meta.
    for (const [adId, r] of leadByAdId) {
      if (!seen.has(adId)) { seen.add(adId); rows.push(withSpend(r)); }
    }
    // Anuncios que existen en Meta (activos/pausados) sin gasto ni leads.
    if (adsMeta) {
      for (const [adId, meta] of adsMeta) {
        if (seen.has(adId)) continue;
        seen.add(adId);
        rows.push(withSpend(finalizeAd(newAcc(adId, adId, meta.adName || null))));
      }
    }
    // Filas de leads solo por titular (sin adId).
    for (const r of headlineOnly) rows.push(withSpend(r));

    // Orden: activos primero, luego por calidad/leads/gasto.
    const statusRank = (s: string | null) => (s === 'active' ? 0 : s === 'paused' ? 1 : 2);
    const byAd = rows.sort((a, b) =>
      statusRank(a.status) - statusRank(b.status)
      || b.avgScore - a.avgScore
      || b.leads - a.leads
      || (b.spend ?? 0) - (a.spend ?? 0));

    // Lista de campañas (para el filtro) + conteo de anuncios activos.
    const campaigns = [...new Set(rows.map((r) => r.campaignName).filter((c): c is string => !!c))].sort();
    const activeAds = rows.filter((r) => r.status === 'active').length;

    const bySource = [...sourceMap.values()]
      .map(finalizeAd)
      .sort((a, b) => b.leads - a.leads)
      .map(({ key, leads, analyzed, avgScore, hot, qualified, scheduled, closed, lost, scheduleRate, convRate }) => ({
        source: key, leads, analyzed, avgScore, hot, qualified, scheduled, closed, lost, scheduleRate, convRate,
      }));

    return {
      totalLeads: leads.length,
      totalMetaLeads,
      adsConfigured: env.metaAdsConfigured(),
      spendAvailable: spendMap !== null,
      statusAvailable: adsMeta !== null,
      totalSpend: Math.round(totalSpend * 100) / 100,
      activeAds,
      campaigns,
      byAd,
      bySource,
      generatedAt: Date.now(),
    };
  }
);
