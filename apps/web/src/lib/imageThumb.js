const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

// Thumbnail URL for an uploaded image, via the backend resize proxy
// (`/img-thumb?f=…`). Works for EVERY uploaded image - the proxy lazily generates
// + caches a ≤400px JPEG, so feeds never load the full original. Non-uploads
// return unchanged; callers fall back to the full URL on error.
export function thumbUrl(url) {
  if (!url) return url
  const m = String(url).match(/\/([a-f0-9]{32}\.(?:jpe?g|png|webp))$/i)
  return m ? `${BASE}/img-thumb?f=${m[1].toLowerCase()}` : url
}

/**
 * A hero cover's <img> props: an uploaded photo through the same proxy at a
 * cover size (shorter side 600 px at 1x, 1000 px from 2x, cached on R2)
 * instead of the multi-MB original; anything else (the bundled theme covers)
 * as is. Pair with thumbFallback(url) so a proxy failure still shows the photo.
 */
export function coverImage(url) {
  if (!url) return null
  const m = String(url).match(/\/([a-f0-9]{32}\.(?:jpe?g|png|webp))$/i)
  if (!m) return { src: url }
  const at = (c) => `${BASE}/img-thumb?f=${m[1].toLowerCase()}&c=${c}`
  return { src: at(600), srcSet: `${at(600)} 1x, ${at(1000)} 2x` }
}
