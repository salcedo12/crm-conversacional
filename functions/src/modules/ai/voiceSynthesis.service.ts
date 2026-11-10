import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { storage } from '../../lib/admin';

export interface VoiceGenerationResult {
  audioUrl: string;
  mimeType: string;
}

/**
 * Convierte abreviaturas técnicas, números con puntos y símbolos en palabras habladas naturales
 * para que el modelo TTS de ElevenLabs no balbucee ni diga cosas raras.
 */
function cleanTextForSpeech(raw: string): string {
  let t = raw
    // Quitar enlaces URLs
    .replace(/https?:\/\/\S+/g, '')
    // Expandir m² y m2 a "metros cuadrados"
    .replace(/(\d+)\s*(?:m²|m2)/gi, (_m, p1) => `${p1} metros cuadrados`)
    .replace(/m²|m2/gi, 'metros cuadrados')
    // Precios y montos con formato
    .replace(/\$(\d+)\.000\.000\b/g, (_m, p1) => `${p1} millones de pesos`)
    .replace(/\$(\d+)\.(\d{3})\.000\b/g, (_m, p1, p2) => `${p1} millones ${p2} mil pesos`)
    .replace(/\$(\d+)\b/g, (_m, p1) => `${p1} pesos`)
    // Números con puntos de miles (ej: 2.200 -> 2200 o 2 mil 200) para evitar que lea "punto"
    .replace(/\b(\d+)\.000\b/g, (_m, p1) => `${p1} mil`)
    .replace(/\b(\d+)\.(\d{3})\b/g, (_m, p1, p2) => `${p1} mil ${p2}`)
    // Horas y minutos
    .replace(/(\d+)\s*min\b/gi, (_m, p1) => `${p1} minutos`)
    .replace(/(\d+)\s*h\b/gi, (_m, p1) => `${p1} horas`)
    // Grados centígrados
    .replace(/(\d+)\s*°C/gi, (_m, p1) => `${p1} grados`)
    .replace(/°C/gi, 'grados')
    // Kilómetros
    .replace(/KM\s*(\d+(?:\.\d+)?)/gi, (_m, p1) => `kilómetro ${p1}`)
    .replace(/km\b/gi, 'kilómetros')
    // Quitar viñetas y guiones de lista al inicio de línea
    .replace(/^[\s*•-]+/gm, '')
    // Quitar markdown (asteriscos, guiones bajos, numerales, backticks, virgulillas)
    .replace(/[*_#`~]/g, '')
    // Quitar emojis
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Espacios múltiples y saltos dobles
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

/**
 * Genera un archivo de audio con ElevenLabs usando la voz oficial de Victoria Sarmiento (Andrea Paisa)
 * y lo sube a Firebase Storage para obtener una URL pública accesible para YCloud WhatsApp.
 */
export async function generateVictoriaVoiceNote(
  companyId: string,
  leadId: string,
  text: string,
  cacheKey?: string
): Promise<VoiceGenerationResult | null> {
  const apiKey = env.elevenlabsApiKey();
  const voiceId = env.elevenlabsVoiceId();

  if (!apiKey || !voiceId) {
    logger.warn('[ElevenLabs] No API key o Voice ID configurado');
    return null;
  }

  const cleanText = cleanTextForSpeech(text);

  if (!cleanText || cleanText.length < 5) return null;

  try {
    const bucket = storage.bucket(env.storageBucket());
    const fileName = cacheKey
      ? `voice_notes/${companyId}/cached_${cacheKey}.ogg`
      : `voice_notes/${companyId}/${leadId}/vn_${Date.now()}.ogg`;
    const file = bucket.file(fileName);

    // Si ya existe un audio cacheado reutilizable, verificar si está disponible
    if (cacheKey) {
      try {
        const [exists] = await file.exists();
        if (exists) {
          const [metadata] = await file.getMetadata();
          const token = metadata.metadata?.firebaseStorageDownloadTokens;
          if (token) {
            const cachedUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
            logger.info('[ElevenLabs] Reutilizando audio cacheado estándar', { cacheKey, cachedUrl });
            return {
              audioUrl: cachedUrl,
              mimeType: 'audio/ogg; codecs=opus',
            };
          }
        }
      } catch (checkErr) {
        logger.warn('[ElevenLabs] Error verificando caché de audio, generando nuevo', { checkErr });
      }
    }

    logger.info('[ElevenLabs] Generando nota de voz con Andrea Paisa en formato Opus nativo (PTT)', { leadId, textLength: cleanText.length });
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=opus_48000_64`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/ogg',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('[ElevenLabs] Error HTTP al generar voz', { status: response.status, error: errText });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Subir a Firebase Storage como OGG Opus (formato nativo PTT para WhatsApp)
    const downloadToken = crypto.randomUUID();

    await file.save(buffer, {
      metadata: {
        contentType: 'audio/ogg; codecs=opus',
        metadata: {
          companyId,
          leadId,
          origin: 'elevenlabs_andrea_paisa_opus',
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    await file.makePublic().catch(() => {});

    // Usar la URL pública con token de descarga estándar de Firebase Storage
    const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;
    logger.info('[ElevenLabs] Audio nativo Opus subido exitosamente', { audioUrl });

    return {
      audioUrl,
      mimeType: 'audio/ogg; codecs=opus',
    };
  } catch (error) {
    logger.error('[ElevenLabs] Error inesperado generando audio', { error: String(error) });
    return null;
  }
}
