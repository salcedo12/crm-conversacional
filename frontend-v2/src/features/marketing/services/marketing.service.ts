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

export type MarketingRange = 'all' | '7d' | '30d' | '90d' | 'custom';

/** Ventana temporal: un preset, o 'custom' con días YYYY-MM-DD (inclusivos, hora Colombia). */
export interface MarketingWindow {
  range: MarketingRange;
  from?: string;
  to?:   string;
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
  from?:           string | null;
  to?:             string | null;
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

/** Contacto que entró por un anuncio (listado "Ver contactos"). */
export interface AdContact {
  id:            string;
  adKey:         string;
  name:          string | null;
  phone:         string | null;
  email:         string | null;
  channel:       string;
  status:        string;
  score:         number | null;
  temperature:   string | null;
  lossCategory:  string | null;
  advisorName:   string | null;
  adName:        string | null;
  campaignName:  string | null;
  formName:      string | null;
  createdAt:     number | null;
  lastMessageAt: number | null;
}

const _get = httpsCallable<{ companyId: string } & MarketingWindow, MarketingMetrics>(functions, 'getMarketingMetrics');
const _getAdLeads = httpsCallable<{ companyId: string; adKeys: string[] } & MarketingWindow, { contacts: AdContact[] }>(functions, 'getMarketingAdLeads');

/** Solo manda from/to cuando el rango es personalizado. */
function windowParams(w: MarketingWindow): MarketingWindow {
  return w.range === 'custom' ? { range: 'custom', from: w.from, to: w.to } : { range: w.range };
}

export async function getMarketingMetrics(companyId: string, win: MarketingWindow = { range: 'all' }): Promise<MarketingMetrics> {
  const r = await _get({ companyId, ...windowParams(win) });
  return r.data;
}

/** Contactos de uno o varios anuncios (por `AdRow.key`) en la misma ventana temporal. */
export async function getMarketingAdLeads(companyId: string, win: MarketingWindow, adKeys: string[]): Promise<AdContact[]> {
  const r = await _getAdLeads({ companyId, adKeys, ...windowParams(win) });
  return r.data.contacts;
}
