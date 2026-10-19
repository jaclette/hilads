/**
 * onError for a thumbnail <img>: switch to the full photo once, so a card never
 * stays empty when the thumbnail proxy fails.
 */
export function thumbFallback(full) {
  return (e) => {
    const img = e.currentTarget
    if (full && img.dataset.fallback !== '1' && img.src !== full) {
      img.dataset.fallback = '1'
      img.src = full
    }
  }
}
