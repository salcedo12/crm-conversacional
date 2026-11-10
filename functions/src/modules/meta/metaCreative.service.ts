import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { getMetaAdsConfigForCompany } from '../companies/channelCredentials.repository';

export interface AdCreativeDetails {
  adId:        string;
  name?:       string;
  headline?:   string;
  body?:       string;
  mediaType:   'video' | 'image' | 'unknown';
  videoUrl?:   string;  // Direct MP4 URL
  imageUrl?:   string;  // Thumbnail or image
  sourceUrl?:  string;  // Shortlink / Facebook post
  configured:  boolean;
  cached?:     boolean;
}

interface GraphAdResponse {
  id?:       string;
  name?:     string;
  creative?: {
    id?:            string;
    name?:          string;
    title?:         string;
    body?:          string;
    image_url?:     string;
    thumbnail_url?: string;
    video_id?:      string;
    effective_object_story_id?: string;
    object_story_spec?: {
      video_data?: {
        video_id?:  string;
        image_url?: string;
        title?:     string;
        message?:   string;
      };
    };
    asset_feed_spec?: {
      videos?: Array<{ video_id?: string }>;
    };
  };
  error?: { message?: string; type?: string; code?: number };
}

interface GraphVideoResponse {
  id?:      string;
  source?:  string;
  picture?: string;
  error?:   { message?: string; type?: string; code?: number };
}

const CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 días de caché

/**
 * Consulta y cachea los detalles multimedia de un anuncio de Meta (Facebook/Instagram).
 * Obtiene el archivo directo .mp4 si es video, y su miniatura.
 */
export async function getAdCreativeDetails(
  companyId: string,
  adId: string,
): Promise<AdCreativeDetails> {
  const cleanAdId = String(adId || '').trim();
  if (!cleanAdId) {
    return { adId: '', mediaType: 'unknown', configured: false };
  }

  const creativeRef = db
    .collection('companies')
    .doc(companyId)
    .collection('metaAdCreatives')
    .doc(cleanAdId);

  // 1. Revisar caché en Firestore
  try {
    const snap = await creativeRef.get();
    if (snap.exists) {
      const data = snap.data();
      const updatedMs = data?.updatedAt?.toMillis?.() ?? 0;
      if (Date.now() - updatedMs < CACHE_TTL_MS && (data?.videoUrl || data?.imageUrl)) {
        return {
          adId:       cleanAdId,
          name:       data?.name,
          headline:   data?.headline,
          body:       data?.body,
          mediaType:  data?.mediaType ?? (data?.videoUrl ? 'video' : 'image'),
          videoUrl:   data?.videoUrl,
          imageUrl:   data?.imageUrl,
          sourceUrl:  data?.sourceUrl,
          configured: true,
          cached:     true,
        };
      }
    }
  } catch (err) {
    logger.warn('[metaCreative] Error leyendo caché de creativo', { cleanAdId, error: String(err) });
  }

  // 2. Obtener credenciales de Meta Ads de la empresa
  const config = await getMetaAdsConfigForCompany(companyId);
  if (!config.accessToken) {
    logger.info('[metaCreative] Meta Ads no configurado para la empresa', { companyId, cleanAdId });
    return {
      adId:       cleanAdId,
      mediaType:  'unknown',
      configured: false,
    };
  }

  // 3. Consultar Meta Graph API
  try {
    const adParams = new URLSearchParams({
      fields:       'name,creative{id,name,title,body,image_url,thumbnail_url,video_id,effective_object_story_id,object_story_spec,asset_feed_spec}',
      access_token: config.accessToken,
    });

    const adUrl = `https://graph.facebook.com/v21.0/${cleanAdId}?${adParams.toString()}`;
    const adRes = await fetch(adUrl);
    const adData = (await adRes.json()) as GraphAdResponse;

    if (adData.error) {
      logger.error('[metaCreative] Graph API error al consultar anuncio', {
        adId: cleanAdId,
        error: adData.error.message,
        code: adData.error.code,
      });
      return { adId: cleanAdId, mediaType: 'unknown', configured: true };
    }

    const cr = adData.creative;
    const headline = cr?.object_story_spec?.video_data?.title || cr?.title || cr?.name || adData.name;
    const body = cr?.object_story_spec?.video_data?.message || cr?.body;
    let imageUrl = cr?.thumbnail_url || cr?.object_story_spec?.video_data?.image_url || cr?.image_url;
    let videoUrl: string | undefined;

    // Buscar el ID del video publicitario (preferir el video_data de la cuenta publicitaria)
    const targetVideoId =
      cr?.object_story_spec?.video_data?.video_id ||
      cr?.asset_feed_spec?.videos?.[0]?.video_id ||
      cr?.video_id;

    if (targetVideoId) {
      try {
        const vParams = new URLSearchParams({
          fields:       'id,source,picture,thumbnails',
          access_token: config.accessToken,
        });
        const vUrl = `https://graph.facebook.com/v21.0/${targetVideoId}?${vParams.toString()}`;
        const vRes = await fetch(vUrl);
        const vData = (await vRes.json()) as GraphVideoResponse;

        if (vData.source) {
          videoUrl = vData.source;
        }
        if (vData.picture && !imageUrl) {
          imageUrl = vData.picture;
        }
      } catch (vErr) {
        logger.warn('[metaCreative] Error consultando video source', {
          videoId: targetVideoId,
          error: String(vErr),
        });
      }
    }

    const mediaType: 'video' | 'image' | 'unknown' = videoUrl
      ? 'video'
      : (imageUrl ? 'image' : 'unknown');

    const result: AdCreativeDetails = {
      adId:       cleanAdId,
      name:       adData.name,
      headline:   headline || undefined,
      body:       body || undefined,
      mediaType,
      videoUrl:   videoUrl || undefined,
      imageUrl:   imageUrl || undefined,
      sourceUrl:  cr?.effective_object_story_id
        ? `https://www.facebook.com/${cr.effective_object_story_id}`
        : undefined,
      configured: true,
      cached:     false,
    };

    // 4. Guardar en caché de Firestore
    await creativeRef.set(
      {
        adId:       cleanAdId,
        name:       result.name ?? null,
        headline:   result.headline ?? null,
        body:       result.body ?? null,
        mediaType:  result.mediaType,
        videoUrl:   result.videoUrl ?? null,
        imageUrl:   result.imageUrl ?? null,
        sourceUrl:  result.sourceUrl ?? null,
        updatedAt:  Timestamp.now(),
      },
      { merge: true },
    );

    logger.info('[metaCreative] Creativo consultado y cacheado OK', {
      adId: cleanAdId,
      hasVideo: !!videoUrl,
      hasImage: !!imageUrl,
    });

    return result;
  } catch (err) {
    logger.error('[metaCreative] Fallo general consultando creativo', {
      adId: cleanAdId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { adId: cleanAdId, mediaType: 'unknown', configured: true };
  }
}
