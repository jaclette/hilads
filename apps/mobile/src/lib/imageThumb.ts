import { PixelRatio } from 'react-native';
import { API_URL } from '@/constants';

/**
 * Thumbnail URL for an uploaded image, via the backend on-the-fly resize proxy
 * (`/img-thumb?f=…`). Works for EVERY uploaded image - the proxy lazily generates
 * + caches a ≤400px JPEG, so feeds never load the full original. Non-uploads
 * (avatars, external URLs) are returned unchanged. Callers should still fall back
 * to the full URL on error (the proxy 302s to the original if it can't resize).
 */
export function thumbUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/([a-f0-9]{32}\.(?:jpe?g|png|webp))$/i);
  return m ? `${API_URL}/img-thumb?f=${m[1].toLowerCase()}` : url;
}

/**
 * A hero cover through the same proxy at a cover size: the shorter side 1000 px
 * on 2x+ screens, else 600 (generated once, cached on R2), instead of the
 * multi-MB original. Non-uploads are returned unchanged.
 */
export function coverThumbUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/([a-f0-9]{32}\.(?:jpe?g|png|webp))$/i);
  return m ? `${API_URL}/img-thumb?f=${m[1].toLowerCase()}&c=${PixelRatio.get() >= 2 ? 1000 : 600}` : url;
}
