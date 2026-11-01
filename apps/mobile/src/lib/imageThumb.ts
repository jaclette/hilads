import { PixelRatio } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '@/constants';

// The image CDN (R2 behind a cached domain, e.g. https://media.hilads.live), from
// GET /app/config's mediaUrl (setMediaUrl), kept for the next launch. Set: the
// stored sizes load from it directly; unset: through the resize proxy.
const MEDIA_KEY = 'hilads_media_url_v1';
let media = '';
AsyncStorage.getItem(MEDIA_KEY).then(v => { if (v && !media) media = v; }).catch(() => {});

/** The server's image CDN (null: none), from GET /app/config. */
export function setMediaUrl(url?: string | null): void {
  const next = (url ?? '').replace(/\/+$/, '');
  if (next === media) return;
  media = next;
  (next ? AsyncStorage.setItem(MEDIA_KEY, next) : AsyncStorage.removeItem(MEDIA_KEY)).catch(() => {});
}

// An uploaded image's file name (<32hex>.<ext>), from its R2 URL or from a
// resize proxy URL (img-thumb?f=…, as the API hands out thumbUrl), else null.
function uploadName(url: string): string | null {
  const m = url.match(/(?:\/|[?&]f=)([a-f0-9]{32}\.(?:jpe?g|png|webp))(?=$|[&#])/i);
  return m ? m[1].toLowerCase() : null;
}

// The sizes (backend ImageProcessor::VARIANTS): the CDN file, and the proxy query that makes it.
const SIZES = {
  thumb:  { prefix: 'thumb_',       query: '' },
  medium: { prefix: 'thumb_w1080_', query: '&w=1080' },
  c600:   { prefix: 'thumb_c600_',  query: '&c=600' },
  c800:   { prefix: 'thumb_c800_',  query: '&c=800' },
} as const;
type Size = keyof typeof SIZES;

function sized(url: string | null | undefined, key: Size): string | undefined {
  if (!url) return undefined;
  const f = uploadName(url);
  if (!f) return url;
  return media ? `${media}/${SIZES[key].prefix}${f.split('.')[0]}.webp` : `${API_URL}/img-thumb?f=${f}${SIZES[key].query}&fmt=webp`;
}

/**
 * The sizes of an uploaded image, as WebP:
 * - thumbUrl: ≤400px, for cards, tiles, avatars and insets;
 * - mediumUrl: ≤1080px, for a full-screen photo (the original only as its fallback);
 * - coverThumbUrl: a hero cover cropped to fill its frame.
 * Anything else (local files, external avatars, older thumb_ files) comes back
 * unchanged. Callers fall back with proxyFor, then the original.
 */
export const thumbUrl = (url?: string | null) => sized(url, 'thumb');
export const mediumUrl = (url?: string | null) => sized(url, 'medium');

/** The API's thumbUrl (the proxy's JPEG) as the WebP thumbnail; any other URL as is. */
export function webpUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return /\/img-thumb\?/.test(url) && !/[?&](fmt|w|c)=/.test(url) ? sized(url, 'thumb') : url;
}

/** A hero cover at a cover size: the shorter side 800 px on 2x+ screens, else 600. */
export const coverThumbUrl = (url?: string | null) => sized(url, PixelRatio.get() >= 2 ? 'c800' : 'c600');

/**
 * A size missing on the CDN: the same size through the resize proxy, which
 * makes and stores it (the proxy finds the file's type). Undefined for any other URL.
 */
export function proxyFor(uri?: string | null): string | undefined {
  if (!media || !uri || !uri.startsWith(media + '/')) return undefined;
  const m = uri.match(/\/(thumb_(?:w1080_|c600_|c800_)?)([a-f0-9]{32})\.webp$/);
  const key = m ? (Object.keys(SIZES) as Size[]).find(k => SIZES[k].prefix === m[1]) : undefined;
  return key ? `${API_URL}/img-thumb?f=${m![2]}${SIZES[key].query}&fmt=webp` : undefined;
}
