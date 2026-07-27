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
  cpl:          number | null;   // costo por lead
  cpql:         number | null;   // costo por lead calificado
  cpa:          number | null;   // costo por cita
  cpc:          number | null;   // costo por cierre
}

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

export interface MarketingMetrics {
  totalLeads:      number;
  totalMetaLeads:  number;
  adsConfigured:   boolean;   // hay token + cuenta de anuncios
  spendAvailable:  boolean;   // se pudo traer el gasto (false = error de API)
  statusAvailable: boolean;   // se pudo traer estado/campaña de los anuncios
  totalSpend:      number;
  activeAds:       number;    // anuncios activos ahora
  campaigns:       string[];  // nombres de campañas (para el filtro)
  byAd:            AdRow[];
  bySource:        SourceRow[];
  generatedAt:     number;
}

const _get = httpsCallable<{ companyId: string }, MarketingMetrics>(functions, 'getMarketingMetrics');

export async function getMarketingMetrics(companyId: string): Promise<MarketingMetrics> {
  const r = await _get({ companyId });
  return r.data;
}
