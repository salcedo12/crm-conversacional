import { safeDownload } from './safeDownload';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { uploadMediaBuffer } from './storageUpload';
import { logger } from './logger';

if (ffmpegInstaller && ffmpegInstaller.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

/**
 * Transcodifica un audio (WebM, MP3, etc.) a formato OGG Opus nativo (mono, 48000Hz, 32kbps).
 * Este formato es el estándar ESTRICTAMENTE EXIGIDO por Meta WhatsApp Cloud API
 * para renderizar como nota de voz PTT oficial (con foto de perfil, micrófono verde y forma de onda interactiva).
 */
export async function convertToWhatsAppVoiceNote(
  sourceUrl: string,
  companyId: string,
  leadId: string
): Promise<{ downloadUrl: string; mimeType: string; fileName: string }> {
  const tmpDir = os.tmpdir();
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const inputPath = path.join(tmpDir, `in_${id}`);
  const outputPath = path.join(tmpDir, `out_${id}.ogg`);

  try {
    // 1. Descargar el archivo fuente
    // Seguridad (R11): la URL la manda el cliente → destino público, con tope de tamaño.
    const { buffer: audioBuf } = await safeDownload(sourceUrl, { maxBytes: 25 * 1024 * 1024 });
    await fs.promises.writeFile(inputPath, audioBuf);

    // 2. Transcodificar a OGG Opus nativo WhatsApp (mono, 48000 Hz, 32k)
    // - asetpts=N/SR/TB: Reconstruye marcas de tiempo (PTS) continuas para evitar error 131053 de Meta.
    // - map_metadata -1: Elimina metadatos de Android/MP4 que confunden al validador de WhatsApp Cloud API.
    // - application voip: Calibración específica de Opus para notas de voz / habla.
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioFilters('asetpts=N/SR/TB')
        .toFormat('ogg')
        .audioCodec('libopus')
        .audioChannels(1)
        .audioFrequency(48000)
        .audioBitrate('32k')
        .outputOptions([
          '-application', 'voip',
          '-map_metadata', '-1',
        ])
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outputPath);
    });

    // 3. Leer OGG resultante y subir a Firebase Storage
    const oggBuffer = await fs.promises.readFile(outputPath);
    const fileName = `voz_${Date.now()}.ogg`;
    const storagePath = `companies/${companyId}/media/${leadId}/${fileName}`;
    const { downloadUrl } = await uploadMediaBuffer(
      oggBuffer,
      'audio/ogg; codecs=opus',
      storagePath
    );

    logger.info('[VoiceTranscoder] Transcodificado exitosamente a OGG Opus nativo para WhatsApp', {
      leadId,
      bytes: oggBuffer.length,
      downloadUrl,
    });

    return {
      downloadUrl,
      mimeType: 'audio/ogg; codecs=opus',
      fileName,
    };
  } catch (err) {
    logger.error('[VoiceTranscoder] Falló la transcodificación de voz, manteniendo audio original', {
      error: err instanceof Error ? err.message : String(err),
      sourceUrl,
    });
    return {
      downloadUrl: sourceUrl,
      mimeType: 'audio/mpeg',
      fileName: `voz_${Date.now()}.mp3`,
    };
  } finally {
    fs.promises.unlink(inputPath).catch(() => {});
    fs.promises.unlink(outputPath).catch(() => {});
  }
}
