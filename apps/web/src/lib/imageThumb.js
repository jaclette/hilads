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
