const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  pdf: 100 * MB,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function mediaLimitFor(contentType: string): number | null {
  if (contentType.startsWith('image/')) return MEDIA_LIMITS.image;
  if (contentType.startsWith('video/')) return MEDIA_LIMITS.video;
  if (contentType.startsWith('audio/')) return MEDIA_LIMITS.audio;
  if (contentType === 'application/pdf') return MEDIA_LIMITS.pdf;
  return null;
}

export function mediaLimitMessage(contentType: string, size: number): string | null {
  const limit = mediaLimitFor(contentType);
  if (!limit || size <= limit) return null;
  const kind = contentType.startsWith('image/')
    ? 'imagen'
    : contentType.startsWith('video/')
      ? 'video'
      : contentType.startsWith('audio/')
        ? 'audio'
        : 'PDF';
  return `El ${kind} pesa ${formatBytes(size)}. Maximo permitido: ${formatBytes(limit)}.`;
}
