import { PixelRatio } from 'react-native';
import { API_URL } from '@/constants';

// An uploaded image's file name (<32hex>.<ext>), from its R2 URL or from a
// resize proxy URL (img-thumb?f=…, as the API hands out thumbUrl), else null.
function uploadName(url: string): string | null {
  const m = url.match(/(?:\/|[?&]f=)([a-f0-9]{32}\.(?:jpe?g|png|webp))(?=$|[&#])/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The sizes of an uploaded image, all through the backend resize proxy
 * (`/img-thumb?f=…`), generated once and cached on R2, as WebP:
 * - thumbUrl: ≤400px, for cards, tiles, avatars and insets;
 * - mediumUrl: ≤1080px, for a full-screen photo (the original only as its fallback);
 * - coverThumbUrl: a hero cover cropped to fill its frame.
 * Anything else (local files, external avatars, older thumb_ files) comes back
 * unchanged. Callers still fall back to the original on error (the proxy 302s
 * to the original when it can't resize).
 */
export function thumbUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const f = uploadName(url);
  return f ? `${API_URL}/img-thumb?f=${f}&fmt=webp` : url;
}

export function mediumUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const f = uploadName(url);
  return f ? `${API_URL}/img-thumb?f=${f}&w=1080&fmt=webp` : url;
}

/** The resize proxy's JPEG (the API's thumbUrl) as WebP, a third lighter; any other URL as is. */
export function webpUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return /\/img-thumb\?/.test(url) && !/[?&]fmt=/.test(url) ? `${url}&fmt=webp` : url;
}

/** A hero cover at a cover size: the shorter side 800 px on 2x+ screens, else 600. */
export function coverThumbUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const f = uploadName(url);
  return f ? `${API_URL}/img-thumb?f=${f}&c=${PixelRatio.get() >= 2 ? 800 : 600}&fmt=webp` : url;
}
