/**
 * Convierte un Blob de audio (WebM/OGG) a MP3 usando @breezystack/lamejs + Web Audio API.
 *
 * Chrome graba en audio/webm;codecs=opus que WhatsApp no acepta.
 * Esta función decodifica el audio a PCM y lo re-codifica como MP3 (audio/mpeg),
 * que WhatsApp soporta en todos los dispositivos.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

export async function convertBlobToMp3(audioBlob: Blob): Promise<Blob> {
  // Si ya es un formato compatible con WhatsApp, devolver tal cual
  const type = audioBlob.type;
  if (
    type.startsWith('audio/mpeg') ||
    type.startsWith('audio/mp4')  ||
    type.startsWith('audio/aac')  ||
    type.startsWith('audio/amr')
  ) {
    return audioBlob;
  }

  // 1. Decodificar el audio a PCM usando Web Audio API
  const arrayBuffer  = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext();
  let audioBuffer: AudioBuffer;

  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    await audioContext.close();
  }

  const sampleRate   = audioBuffer.sampleRate;
  const numChannels  = Math.min(audioBuffer.numberOfChannels, 2);
  const leftChannel  = audioBuffer.getChannelData(0);
  const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

  // 2. Codificar a MP3 con lamejs (128 kbps)
  const mp3Encoder  = new Mp3Encoder(numChannels, sampleRate, 128);
  const sampleBlock = 1152; // tamaño de bloque requerido por LAME
  const mp3Chunks: Uint8Array[] = [];

  for (let offset = 0; offset < leftChannel.length; offset += sampleBlock) {
    const left  = float32ToInt16(leftChannel.subarray(offset, offset + sampleBlock));
    const right = float32ToInt16(rightChannel.subarray(offset, offset + sampleBlock));

    const chunk = numChannels === 2
      ? mp3Encoder.encodeBuffer(left, right)
      : mp3Encoder.encodeBuffer(left);

    if (chunk.length > 0) mp3Chunks.push(new Uint8Array(chunk));
  }

  // Flush del encoder (bytes finales)
  const finalChunk = mp3Encoder.flush();
  if (finalChunk.length > 0) mp3Chunks.push(new Uint8Array(finalChunk));

  return new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' });
}

/** Convierte muestras Float32 [-1, 1] a Int16 [-32768, 32767] */
function float32ToInt16(buffer: Float32Array): Int16Array {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    out[i]  = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
