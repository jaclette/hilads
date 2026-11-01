const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'
// The image CDN (R2 behind a cached domain, e.g. https://media.hilads.live). Set:
// the stored sizes load from it directly; unset: through the resize proxy.
const MEDIA = String(import.meta.env.VITE_MEDIA_URL ?? '').replace(/\/+$/, '')

// An uploaded image's file name (<32hex>.<ext>), from its R2 URL or from a
// resize proxy URL (img-thumb?f=…, as the API hands out thumbUrl), else null.
function uploadName(url) {
  const m = String(url).match(/(?:\/|[?&]f=)([a-f0-9]{32}\.(?:jpe?g|png|webp))(?=$|[&#])/i)
  return m ? m[1].toLowerCase() : null
}

// The sizes (backend ImageProcessor::VARIANTS): the CDN file, and the proxy query that makes it.
const SIZES = {
  thumb:  { prefix: 'thumb_',       query: '' },
  medium: { prefix: 'thumb_w1080_', query: '&w=1080' },
  c600:   { prefix: 'thumb_c600_',  query: '&c=600' },
  c800:   { prefix: 'thumb_c800_',  query: '&c=800' },
}
const proxied = (f, key) => `${BASE}/img-thumb?f=${f}${SIZES[key].query}&fmt=webp`
function sized(url, key) {
  if (!url) return url
  const f = uploadName(url)
  if (!f) return url
  return MEDIA ? `${MEDIA}/${SIZES[key].prefix}${f.split('.')[0]}.webp` : proxied(f, key)
}

// The sizes of an uploaded image, as WebP:
// - thumbUrl: ≤400px, for cards, tiles, avatars and insets;
// - mediumUrl: ≤1080px, for a full-screen photo (the original only as its fallback);
// - coverImage: a hero cover cropped to fill its frame.
// Anything else (bundled images, external avatars, older thumb_ files) comes
// back unchanged. Callers fall back to the original on error (thumbFallback).
export const thumbUrl = (url) => sized(url, 'thumb')
export const mediumUrl = (url) => sized(url, 'medium')

/**
 * A hero cover's <img> props: an uploaded photo at a cover size (shorter side
 * 600 px at 1x, 800 px from 2x) instead of the multi-MB original; anything
 * else (the bundled theme covers) as is. Pair with thumbFallback(url) so a
 * failure still shows the photo.
 */
export function coverImage(url) {
  if (!url) return null
  if (!uploadName(url)) return { src: url }
  return { src: sized(url, 'c600'), srcSet: `${sized(url, 'c600')} 1x, ${sized(url, 'c800')} 2x` }
}

/**
 * A size missing on the CDN: the same size through the resize proxy, which
 * makes and stores it (the file's type unknown here: the proxy finds it).
 * Null for any other URL.
 */
export function proxyFor(src) {
  if (!MEDIA || !src || !String(src).startsWith(MEDIA + '/')) return null
  const m = String(src).match(/\/(thumb_(?:w1080_|c600_|c800_)?)([a-f0-9]{32})\.webp$/)
  if (!m) return null
  const key = Object.keys(SIZES).find(k => SIZES[k].prefix === m[1])
  return key ? `${BASE}/img-thumb?f=${m[2]}${SIZES[key].query}&fmt=webp` : null
}

/** An original on r2.dev, at the CDN once there is one. */
export function originalUrl(url) {
  return MEDIA && url ? String(url).replace(/^https:\/\/pub-[a-z0-9]+\.r2\.dev(?=\/)/, MEDIA) : url
}

// Any <img> whose CDN size is missing retries through the proxy, once: on the whole
// document (error doesn't bubble), a tick later so an <img>'s own onError
// (thumbFallback) goes first and this only catches the ones without it.
if (MEDIA && typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target
    if (!(img instanceof HTMLImageElement)) return
    const failed = img.currentSrc || img.src
    setTimeout(() => {
      if (img.dataset.fallback || (img.currentSrc || img.src) !== failed) return
      const next = proxyFor(failed)
      if (!next) return
      img.dataset.fallback = 'proxy'
      img.removeAttribute('srcset')
      img.src = next
    }, 0)
  }, true)
}
