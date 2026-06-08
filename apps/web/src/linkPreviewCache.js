// Per-session cache for /api/v1/link-preview responses. The backend has a 24h
// DB cache; this avoids re-fetching the same URL across many messages within
// one page session and gives us an immediate Promise share so the same URL
// rendered N times only triggers one network request.

import { fetchLinkPreview } from './api'

const cache = new Map() // url -> Promise<Preview|null>

export function getLinkPreview(url) {
  if (!url) return Promise.resolve(null)
  let p = cache.get(url)
  if (p) return p
  p = (async () => {
    try {
      const preview = await fetchLinkPreview(url)
      if (!preview) return null
      // Hide cards that carry no usable content (no title AND no image) -
      // showing an empty card is worse than no card.
      if (!preview.title && !preview.image) return null
      return preview
    } catch {
      return null
    }
  })()
  cache.set(url, p)
  return p
}
