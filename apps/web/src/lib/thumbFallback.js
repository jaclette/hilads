import { originalUrl, proxyFor } from './imageThumb'

/**
 * onError for a sized <img>: a size missing on the image CDN first retries
 * through the resize proxy (it makes it), then the full photo, once each, so
 * a card never stays empty.
 */
export function thumbFallback(full) {
  return (e) => {
    const img = e.currentTarget
    const step = img.dataset.fallback
    if (!step) {
      const proxy = proxyFor(img.currentSrc || img.src)
      if (proxy) {
        img.dataset.fallback = 'proxy'
        img.removeAttribute('srcset')
        img.src = proxy
        return
      }
    }
    if (full && step !== '1' && img.src !== full) {
      img.dataset.fallback = '1'
      img.removeAttribute('srcset')   // a cover's sizes would win over src
      img.src = originalUrl(full)
    }
  }
}
