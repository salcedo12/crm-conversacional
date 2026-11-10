import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, db } from '@/config/firebase';

export interface MetaAdCreative {
  adId:        string;
  name?:       string;
  headline?:   string;
  body?:       string;
  mediaType:   'video' | 'image' | 'unknown';
  videoUrl?:   string;
  imageUrl?:   string;
  sourceUrl?:  string;
  configured:  boolean;
  cached?:     boolean;
}

export interface MetaAdsConfig {
  configured:  boolean;
  hasToken:    boolean;
  adAccountId: string;
}

const _getMetaAdCreative = httpsCallable<
  { companyId: string; adId: string; leadId?: string },
  { creative: MetaAdCreative }
>(functions, 'getMetaAdCreative');

const _getMetaAdsConfig = httpsCallable<
  { companyId: string },
  MetaAdsConfig
>(functions, 'getMetaAdsConfig');

const _saveMetaAdsConfig = httpsCallable<
  { companyId: string; accessToken?: string; adAccountId?: string },
  { ok: boolean }
>(functions, 'saveMetaAdsConfig');

const _testMetaAdsConnection = httpsCallable<
  { companyId: string },
  { ok: boolean; accountName: string; currency: string }
>(functions, 'testMetaAdsConnection');

export async function fetchMetaAdCreative(
  companyId: string,
  adId: string,
  leadId?: string
): Promise<MetaAdCreative | null> {
  // 1. Intentar leer directo de la caché de Firestore (ultra rápido y sin dependencias de red externa)
  try {
    const cachedDoc = await getDoc(doc(db, 'companies', companyId, 'metaAdCreatives', adId));
    if (cachedDoc.exists()) {
      const data = cachedDoc.data();
      if (data?.videoUrl || data?.imageUrl) {
        return {
          adId,
          name: data.name,
          headline: data.headline,
          body: data.body,
          mediaType: data.mediaType || (data.videoUrl ? 'video' : 'image'),
          videoUrl: data.videoUrl,
          imageUrl: data.imageUrl,
          sourceUrl: data.sourceUrl,
          configured: true,
          cached: true,
        };
      }
    }
  } catch (err) {
    console.warn('[metaCreative] Error leyendo caché local de Firestore:', err);
  }

  // 2. Si no está en caché, invocar Cloud Function con Admin SDK
  try {
    const res = await _getMetaAdCreative({ companyId, adId, leadId });
    return res.data?.creative ?? null;
  } catch (err) {
    console.warn('[metaCreative] No se pudo consultar getMetaAdCreative callable:', err);
    return null;
  }
}

export async function fetchMetaAdsConfig(companyId: string): Promise<MetaAdsConfig> {
  const res = await _getMetaAdsConfig({ companyId });
  return res.data;
}

export async function updateMetaAdsConfig(
  companyId: string,
  config: { accessToken?: string; adAccountId?: string }
): Promise<void> {
  await _saveMetaAdsConfig({ companyId, ...config });
}

export async function verifyMetaAdsConnection(
  companyId: string
): Promise<{ ok: boolean; accountName: string; currency: string }> {
  const res = await _testMetaAdsConnection({ companyId });
  return res.data;
}
