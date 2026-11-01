const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

// An uploaded image's file name (<32hex>.<ext>), from its R2 URL or from a
// resize proxy URL (img-thumb?f=…, as the API hands out thumbUrl), else null.
function uploadName(url) {
  const m = String(url).match(/(?:\/|[?&]f=)([a-f0-9]{32}\.(?:jpe?g|png|webp))(?=$|[&#])/i)
  return m ? m[1].toLowerCase() : null
}

// The sizes of an uploaded image, all through the backend resize proxy
// (`/img-thumb?f=…`), generated once and cached on R2, as WebP:
// - thumbUrl: ≤400px, for cards, tiles, avatars and insets;
// - mediumUrl: ≤1080px, for a full-screen photo (the original only as its fallback);
// - coverImage: a hero cover cropped to fill its frame.
// Anything else (bundled images, external avatars, older thumb_ files) comes
// back unchanged. Callers fall back to the original on error (thumbFallback).
export function thumbUrl(url) {
  if (!url) return url
  const f = uploadName(url)
  return f ? `${BASE}/img-thumb?f=${f}&fmt=webp` : url
}

export function mediumUrl(url) {
  if (!url) return url
  const f = uploadName(url)
  return f ? `${BASE}/img-thumb?f=${f}&w=1080&fmt=webp` : url
}

/**
 * A hero cover's <img> props: an uploaded photo at a cover size (shorter side
 * 600 px at 1x, 800 px from 2x) instead of the multi-MB original; anything
 * else (the bundled theme covers) as is. Pair with thumbFallback(url) so a
 * proxy failure still shows the photo.
 */
export function coverImage(url) {
  if (!url) return null
  const f = uploadName(url)
  if (!f) return { src: url }
  const at = (c) => `${BASE}/img-thumb?f=${f}&c=${c}&fmt=webp`
  return { src: at(600), srcSet: `${at(600)} 1x, ${at(800)} 2x` }
}
