import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export type AdStatus = 'active' | 'paused' | 'other';

export interface AdRow {
  key:          string;
  adId:         string | null;
  headline:     string | null;
  leads:        number;
  analyzed:     number;
  avgScore:     number;
  hot:          number;
  qualified:    number;
  scheduled:    number;
  closed:       number;
  lost:         number;
  scheduleRate: number;
  convRate:     number;
  topLoss:      string | null;
  // Estado / campaña (solo si hay integración de Meta Ads)
  status:          AdStatus | null;   // null = desconocido
  effectiveStatus: string | null;     // valor crudo de Meta
  campaignName:    string | null;
  adsetName:       string | null;
  // Costos (solo si hay integración de Meta Ads; si no, null)
  spend:        number | null;
  impressions:  number | null;
  clicks:       number | null;
  ctr:          number | null;   // % clics / impresiones
  cpm:          number | null;   // costo por mil impresiones
  cpl:          number | null;   // costo por lead
  cpql:         number | null;   // costo por lead calificado
  cpa:          number | null;   // costo por cita
  cpc:          number | null;   // costo por cierre
}

export type InsightKind = 'scale' | 'pause' | 'review' | 'info';

export interface Insight {
  kind:   InsightKind;
  title:  string;
  detail: string;
  adKey?: string;
}

export type MarketingRange = 'all' | '7d' | '30d' | '90d';

export interface SourceRow {
  source:       string;
  leads:        number;
  analyzed:     number;
  avgScore:     number;
  hot:          number;
  qualified:    number;
  scheduled:    number;
  closed:       number;
  lost:         number;
  scheduleRate: number;
  convRate:     number;
}

export interface FormRow {
  form:         string;
  leads:        number;
  analyzed:     number;
  avgScore:     number;
  qualified:    number;
  scheduled:    number;
  closed:       number;
  lost:         number;
  scheduleRate: number;
  convRate:     number;
}

export interface MarketingMetrics {
  range:           MarketingRange;
  totalLeads:      number;
  totalMetaLeads:  number;
  metaLeadsWithAdId:   number;
  attributionCoverage: number;   // % de leads de anuncio con adId identificado
  adsConfigured:   boolean;   // hay token + cuenta de anuncios
  spendAvailable:  boolean;   // se pudo traer el gasto (false = error de API)
  statusAvailable: boolean;   // se pudo traer estado/campaña de los anuncios
  totalSpend:      number;
  activeAds:       number;    // anuncios activos ahora
  campaigns:       string[];  // nombres de campañas (para el filtro)
  insights:        Insight[]; // recomendaciones accionables
  byAd:            AdRow[];
  bySource:        SourceRow[];
  byForm:          FormRow[];
  generatedAt:     number;
}

const _get = httpsCallable<{ companyId: string; range: MarketingRange }, MarketingMetrics>(functions, 'getMarketingMetrics');

export async function getMarketingMetrics(companyId: string, range: MarketingRange = 'all'): Promise<MarketingMetrics> {
  const r = await _get({ companyId, range });
  return r.data;
}
