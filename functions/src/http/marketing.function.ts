import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { env } from '../config/env';
import { getLifetimeAdSpend, getAdsMeta, type AdSpendRange } from '../integrations/meta/metaAds.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import type { Lead } from '../modules/leads/leads.types';
import { countsAsBusinessLead } from '../modules/leads/leadClassification';

/** Score a partir del cual un lead se considera "calificado" (para costo por lead calificado). */
const QUALIFIED_SCORE = 60;

// ── Umbrales del motor de recomendaciones (COP) ─────────────────────────────
/** Gasto mínimo para considerar que un anuncio sin leads está "quemando plata". */
const WASTE_MIN_SPEND = 100_000;
/** Leads mínimos para juzgar la calidad/rendimiento de un anuncio con confianza. */
const MIN_LEADS_FOR_JUDGEMENT = 5;
/** Score por debajo del cual la calidad de los leads se considera baja. */
const LOW_SCORE = 35;
/** Score a partir del cual un anuncio con volumen es candidato a escalar. */
const GOOD_SCORE = 60;

/** Días de la ventana temporal (para filtrar leads por createdAt). */
const RANGE_DAYS: Record<Exclude<AdSpendRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Recomendación accionable que el panel muestra arriba del ranking. */
export type InsightKind = 'scale' | 'pause' | 'review' | 'info';
export interface Insight {
  kind:   InsightKind;
  title:  string;
  detail: string;
  adKey?: string;   // ancla al anuncio en la tabla (si aplica)
}

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

/** Formatea un monto en COP para los textos de las recomendaciones. */
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** Nombre mostrable de un anuncio. */
function adName(r: { headline: string | null; adId: string | null }): string {
  return r.headline || (r.adId ? `Anuncio ${r.adId}` : 'Sin identificar');
}

/**
 * Motor de recomendaciones: convierte el ranking en acciones concretas
 * (pausar/escalar/revisar) con reglas deterministas, sin costo de IA. Devuelve
 * las tarjetas ya ordenadas por prioridad para el panel superior.
 */
interface InsightRow {
  key: string; headline: string | null; adId: string | null; leads: number;
  avgScore: number; convRate: number; closed: number; spend: number | null;
  cpl: number | null; status: string | null; campaignName: string | null;
}

function buildInsights(
  rows: InsightRow[],
  opts: { spendAvailable: boolean; totalMetaLeads: number },
): Insight[] {
  const insights: Insight[] = [];
  const isRunning = (s: string | null) => s === 'active' || s === null; // activo o desconocido
  const totalClosed = rows.reduce((n, r) => n + r.closed, 0);

  // 🔴 PAUSAR — gasto significativo sin ningún lead.
  if (opts.spendAvailable) {
    const waste = rows
      .filter((r) => isRunning(r.status) && r.leads === 0 && (r.spend ?? 0) >= WASTE_MIN_SPEND)
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
      .slice(0, 3);
    for (const r of waste) {
      insights.push({
        kind: 'pause', adKey: r.key,
        title: `Pausar: ${adName(r)}`,
        detail: `Gastó ${cop.format(r.spend ?? 0)} y no trajo ni un lead. Considera pausarlo o cambiar el creativo/segmentación.`,
      });
    }
  }

  // 🟢 ESCALAR — buen volumen y buena calidad; el de menor costo por lead primero.
  const winners = rows
    .filter((r) => isRunning(r.status) && r.leads >= MIN_LEADS_FOR_JUDGEMENT && r.avgScore >= GOOD_SCORE)
    .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.avgScore - a.avgScore);
  const winner = winners[0];
  if (winner) {
    const cplTxt = winner.cpl != null ? ` con CPL ${cop.format(winner.cpl)}` : '';
    insights.push({
      kind: 'scale', adKey: winner.key,
      title: `Escalar: ${adName(winner)}`,
      detail: `${winner.leads} leads y score ${winner.avgScore}${cplTxt}. Es de tus mejores anuncios: súbele presupuesto.`,
    });
  }

  // 🟡 REVISAR — trae volumen pero de baja calidad.
  const lowQuality = rows
    .filter((r) => r.leads >= MIN_LEADS_FOR_JUDGEMENT && r.avgScore > 0 && r.avgScore < LOW_SCORE)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 2);
  for (const r of lowQuality) {
    insights.push({
      kind: 'review', adKey: r.key,
      title: `Revisar: ${adName(r)}`,
      detail: `Trae ${r.leads} leads pero de baja calidad (score ${r.avgScore}). Ajusta la segmentación o el mensaje para atraer mejores prospectos.`,
    });
  }

  // 💡 INFO — cierres no marcados: bloquea ROAS y costo/cierre.
  if (totalClosed === 0 && (opts.totalMetaLeads > 0)) {
    insights.push({
      kind: 'info',
      title: 'No hay cierres registrados en el CRM',
      detail: 'No se puede calcular ROAS ni costo por cierre. Marca como “Cerrado” los leads que se ganaron (o conéctalo con SmartHome) para medir el retorno real de cada anuncio.',
    });
  }

  return insights;
}

export const getMarketingMetrics = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, range } = z.object({
      companyId: z.string().min(1),
      range:     z.enum(['all', '7d', '30d', '90d']).default('all'),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const leadsSnap = await db
      .collection('companies').doc(companyId)
      .collection('leads')
      .get();

    // Fuera los leads directos al WhatsApp del asesor: no son dato de pauta.
    const allLeads = leadsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Lead))
      .filter(countsAsBusinessLead);

    // Ventana temporal: filtra leads por createdAt (el gasto se filtra vía date_preset
    // en Meta, más abajo). 'all' = histórico completo.
    const cutoffMs = range === 'all' ? 0 : Date.now() - RANGE_DAYS[range] * 86_400_000;
    const leads = cutoffMs === 0
      ? allLeads
      : allLeads.filter((l) => (l.createdAt?.toMillis?.() ?? 0) >= cutoffMs);

    const adMap = new Map<string, AdAcc>();       // por anuncio (meta_ads)
    const sourceMap = new Map<string, AdAcc>();    // por fuente (todas)
    const formMap = new Map<string, AdAcc>();      // por formulario (Lead Ads)
    let totalMetaLeads = 0;
    let metaLeadsWithAdId = 0;   // leads de anuncio con adId (para cobertura de atribución)

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
        if (meta?.adId) metaLeadsWithAdId++;
        const key = meta?.adId || meta?.headline || '__sin_id__';
        let adAcc = adMap.get(key);
        if (!adAcc) { adAcc = newAcc(key, meta?.adId ?? null, meta?.headline ?? null); adMap.set(key, adAcc); }
        accumulate(adAcc, lead);
      }

      // ── Por formulario (pautas de Lead Ads que registran el form) ────────────
      const formName = lead.metadata?.metaFormName;
      const formId   = lead.metadata?.metaFormId;
      if (formName || formId) {
        const fkey = formId || formName!;
        let fAcc = formMap.get(fkey);
        if (!fAcc) { fAcc = newAcc(fkey, null, formName ?? null); formMap.set(fkey, fAcc); }
        accumulate(fAcc, lead);
      }
    }

    const leadRows = [...adMap.values()].map(finalizeAd);

    // ── Gasto + estado/campaña de Meta (en paralelo; null si no configurado) ────
    const [spendMap, adsMeta] = await Promise.all([getLifetimeAdSpend(range), getAdsMeta()]);
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
      if (!s) return { ...withMeta, spend: null, impressions: null, clicks: null, ctr: null, cpm: null, cpl: null, cpql: null, cpa: null, cpc: null };
      return {
        ...withMeta,
        spend:       Math.round(s.spend * 100) / 100,
        impressions: s.impressions,
        clicks:      s.clicks,
        ctr:         s.impressions > 0 ? Math.round((s.clicks / s.impressions) * 1000) / 10 : null, // % clics/impresiones
        cpm:         s.impressions > 0 ? Math.round((s.spend / s.impressions) * 1000 * 100) / 100 : null, // costo por mil impresiones
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

    // Desglose por formulario de Lead Ads (nombre legible cuando se pudo resolver).
    const byForm = [...formMap.values()]
      .map(finalizeAd)
      .sort((a, b) => b.leads - a.leads)
      .map(({ key, headline, leads, analyzed, avgScore, qualified, scheduled, closed, lost, scheduleRate, convRate }) => ({
        form: headline || key, leads, analyzed, avgScore, qualified, scheduled, closed, lost, scheduleRate, convRate,
      }));

    // Motor de recomendaciones (activo cuando hay algo de gasto o leads que analizar).
    const insights = buildInsights(byAd, {
      spendAvailable: spendMap !== null,
      totalMetaLeads,
    });

    return {
      range,
      totalLeads: leads.length,
      totalMetaLeads,
      metaLeadsWithAdId,
      attributionCoverage: pct(metaLeadsWithAdId, totalMetaLeads), // % de leads de anuncio con adId identificado
      adsConfigured: env.metaAdsConfigured(),
      spendAvailable: spendMap !== null,
      statusAvailable: adsMeta !== null,
      totalSpend: Math.round(totalSpend * 100) / 100,
      activeAds,
      campaigns,
      insights,
      byAd,
      bySource,
      byForm,
      generatedAt: Date.now(),
    };
  }
);
