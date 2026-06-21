import { API_URL } from '@/constants';

/**
 * Thumbnail URL for an uploaded image, via the backend on-the-fly resize proxy
 * (`/img-thumb?f=…`). Works for EVERY uploaded image - the proxy lazily generates
 * + caches a ≤400px JPEG, so feeds never load the full original. Non-uploads
 * (avatars, external URLs) are returned unchanged. Callers should still fall back
 * to the full URL on error (the proxy 302s to the original if it can't resize).
 */
export function thumbUrl(url?: string | null): string | null {
  if (!url) return url ?? null;
  const m = url.match(/\/([a-f0-9]{32}\.(?:jpe?g|png|webp))$/i);
  return m ? `${API_URL}/img-thumb?f=${m[1].toLowerCase()}` : url;
}
