import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { env } from '../../config/env';

/**
 * Credenciales de YCloud POR EMPRESA. Permiten que cada empresa (multi-tenant)
 * envíe/reciba por su propia cuenta de YCloud (API key + número + WABA distintos),
 * en vez de una sola cuenta global.
 *
 * Se guardan en la colección top-level `channelCredentials/{companyId}` bajo la
 * clave `ycloud`. Esa colección NO es legible por clientes (regla catch-all
 * `if false`); solo el backend (admin SDK) la lee. Si una empresa no tiene
 * credenciales propias, se cae a las variables de entorno globales (compatibilidad).
 */
export interface YcloudCompanyConfig {
  apiKey:            string;
  fromNumber:        string;
  wabaId:            string;
  callingFromNumber: string;
  callingPhoneId:    string;
}

// Caché en memoria por instancia (las credenciales cambian rara vez). Se limpia
// al guardar. Cada instancia de Function es efímera, así que no hay riesgo de
// quedar con datos viejos por mucho tiempo.
const cache = new Map<string, YcloudCompanyConfig>();

export async function getYcloudConfigForCompany(companyId: string): Promise<YcloudCompanyConfig> {
  const cached = cache.get(companyId);
  if (cached) return cached;

  let stored: Partial<YcloudCompanyConfig> = {};
  try {
    const snap = await db.collection('channelCredentials').doc(companyId).get();
    const ycloud = snap.data()?.ycloud;
    if (ycloud && typeof ycloud === 'object') stored = ycloud as Partial<YcloudCompanyConfig>;
  } catch {
    /* si falla la lectura, se usan las globales */
  }

  const fromNumber = stored.fromNumber || env.ycloudFromNumber();
  const config: YcloudCompanyConfig = {
    apiKey:            stored.apiKey            || env.ycloudApiKey(),
    fromNumber,
    wabaId:            stored.wabaId            || env.ycloudWabaId(),
    callingFromNumber: stored.callingFromNumber || fromNumber || env.ycloudCallingFromNumber(),
    callingPhoneId:    stored.callingPhoneId    || env.ycloudCallingPhoneId(),
  };
  cache.set(companyId, config);
  return config;
}

export function clearYcloudConfigCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/** Guarda (merge) las credenciales YCloud de una empresa. Ignora campos vacíos. */
export async function saveYcloudConfigForCompany(
  companyId: string,
  config: Partial<YcloudCompanyConfig>,
): Promise<void> {
  const clean: Record<string, string> = {};
  (['apiKey', 'fromNumber', 'wabaId', 'callingFromNumber', 'callingPhoneId'] as const).forEach((key) => {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  });

  await db.collection('channelCredentials').doc(companyId).set(
    { ycloud: clean, updatedAt: Timestamp.now() },
    { merge: true },
  );
  clearYcloudConfigCache(companyId);
}

export interface MetaAdsCompanyConfig {
  accessToken: string;
  adAccountId: string;
}

const metaAdsCache = new Map<string, MetaAdsCompanyConfig>();

export async function getMetaAdsConfigForCompany(companyId: string): Promise<MetaAdsCompanyConfig> {
  const cached = metaAdsCache.get(companyId);
  if (cached) return cached;

  let stored: Partial<MetaAdsCompanyConfig> = {};
  try {
    const snap = await db.collection('channelCredentials').doc(companyId).get();
    const metaAds = snap.data()?.metaAds;
    if (metaAds && typeof metaAds === 'object') stored = metaAds as Partial<MetaAdsCompanyConfig>;
  } catch {
    /* si falla la lectura, se usan las globales */
  }

  const config: MetaAdsCompanyConfig = {
    accessToken: stored.accessToken || env.metaAdsAccessToken(),
    adAccountId: (stored.adAccountId || env.metaAdAccountId()).replace(/^act_/, ''),
  };
  metaAdsCache.set(companyId, config);
  return config;
}

export async function saveMetaAdsConfigForCompany(
  companyId: string,
  config: Partial<MetaAdsCompanyConfig>
): Promise<void> {
  const clean: Record<string, string> = {};
  if (typeof config.accessToken === 'string' && config.accessToken.trim()) {
    clean.accessToken = config.accessToken.trim();
  }
  if (typeof config.adAccountId === 'string' && config.adAccountId.trim()) {
    clean.adAccountId = config.adAccountId.trim().replace(/^act_/, '');
  }

  await db.collection('channelCredentials').doc(companyId).set(
    { metaAds: clean, updatedAt: Timestamp.now() },
    { merge: true }
  );
  metaAdsCache.delete(companyId);
  metaCapiCache.delete(companyId);
}

/**
 * Conversions API (CAPI) por empresa — `channelCredentials/{companyId}.metaCapi`.
 * El token cae al de Meta Ads de la empresa si no se guarda uno propio.
 */
export interface MetaCapiCompanyConfig {
  datasetId:     string;
  /** Página que publica los anuncios CTWA — Meta exige page_id junto al ctwa_clid. */
  pageId:        string;
  accessToken:   string;
  testEventCode: string;
  currency:      string;
}

const metaCapiCache = new Map<string, MetaCapiCompanyConfig>();

export async function getMetaCapiConfigForCompany(companyId: string): Promise<MetaCapiCompanyConfig> {
  const cached = metaCapiCache.get(companyId);
  if (cached) return cached;

  let stored: Partial<MetaCapiCompanyConfig> = {};
  try {
    const snap = await db.collection('channelCredentials').doc(companyId).get();
    const metaCapi = snap.data()?.metaCapi;
    if (metaCapi && typeof metaCapi === 'object') stored = metaCapi as Partial<MetaCapiCompanyConfig>;
  } catch {
    /* si falla la lectura, se usan las globales */
  }

  const ads = await getMetaAdsConfigForCompany(companyId);
  const config: MetaCapiCompanyConfig = {
    datasetId:     stored.datasetId     || env.metaCapiDatasetId(),
    pageId:        stored.pageId        || env.metaPageId(),
    accessToken:   stored.accessToken   || env.metaCapiAccessToken() || ads.accessToken,
    testEventCode: stored.testEventCode || env.metaCapiTestCode(),
    currency:      stored.currency      || env.metaCapiCurrency(),
  };
  metaCapiCache.set(companyId, config);
  return config;
}

export function isMetaCapiConfigured(config: MetaCapiCompanyConfig): boolean {
  return !!config.datasetId && !!config.accessToken && !!config.pageId;
}

