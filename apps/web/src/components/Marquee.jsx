/**
 * Marquee - single-line text that auto-scrolls ONLY when it overflows.
 *
 * Web port of the native MarqueeText (apps/mobile/src/components/MarqueeText.tsx).
 *   - Overflow-gated: a hidden measuring copy reports the text's natural width;
 *     if it fits the clip window it renders static (with ellipsis when the
 *     caller's container would clip), so short tips never scroll.
 *   - SINGLE-COPY scroll with snap-back. ONE text element translates from 0 to
 *     -(textW - clipW + LEAD), holds at the end so the trailing words are
 *     fully readable, then snaps invisibly back to the start. NO duplicate
 *     copy and NO seamless loop - the duplicate-copy mechanism (previous
 *     impl) made both copies of the text visible mid-scroll on narrow
 *     clips, which read as a constant flash. The snap-back is hidden by
 *     the edge fade.
 *   - Re-measures on resize (ResizeObserver) and whenever `text` changes.
 *   - prefers-reduced-motion: never animates - static + ellipsis + title tooltip.
 *
 * Timing constants below mirror the native defaults so the platforms stay in sync.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

const SPEED = 25           // px/sec - duration is derived so speed stays constant
const FADE_WIDTH = 14      // px edge fade (native: fadeWidth)
const EPSILON = 1          // px - measurement noise threshold for re-renders
const LEAD = 12            // px past the end so the last glyph fully clears the right fade
// Marginal overflows (a few px) hit ellipsis instead of triggering a constant
// scroll - without this threshold every locale whose translation crept ~1 px
// over the clip would marquee forever, which read as "flashing".
const OVERFLOW_FACTOR = 1.15
// Per-iteration phase percentages: hold-at-start (0→18%), scroll (18→78%),
// hold-at-end (78→100%). The two dwell stretches let the eye actually read
// the start and end of the text; the snap from 100% back to 0% happens
// while the start is held so the reset is invisible-ish (the very first
// frame after snap shows the start position again).
const SCROLL_PCT_START = 18
const SCROLL_PCT_END   = 78

export function Marquee({ text, className = '', fadeColor = '#1a1a1a' }) {
  const clipRef = useRef(null)
  const measureRef = useRef(null)
  const [textW, setTextW] = useState(0)
  const [clipW, setClipW] = useState(0)
  const reduceMotion = usePrefersReducedMotion()

  useLayoutEffect(() => {
    const clip = clipRef.current
    const measure = measureRef.current
    if (!clip || !measure) return
    const read = () => {
      const tw = measure.offsetWidth
      const cw = clip.clientWidth
      setTextW(prev => (Math.abs(tw - prev) > EPSILON ? tw : prev))
      setClipW(prev => (Math.abs(cw - prev) > EPSILON ? cw : prev))
    }
    read()
    // Observe the clip (row reflow / window resize) AND the measuring copy
    // (late web-font load changes the natural text width).
    const ro = new ResizeObserver(read)
    ro.observe(clip)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [text])

  const overflows = textW > 0 && clipW > 0 && textW > clipW * OVERFLOW_FACTOR
  const animate = overflows && !reduceMotion
  // Distance = how far we need to push the single copy so its end clears the
  // right edge. Subtract clipW so the right edge of the text rests exactly at
  // the right edge of the clip, then add LEAD so the fade doesn't clip the
  // last glyph.
  const distance = Math.max(0, textW - clipW + LEAD)
  // Total iteration = scroll time / scroll-portion.
  const scrollDuration = distance / SPEED
  const duration = scrollDuration / ((SCROLL_PCT_END - SCROLL_PCT_START) / 100)

  return (
    <span
      ref={clipRef}
      className={`marquee ${className}`.trim()}
      title={overflows ? text : undefined}
      style={{ '--marquee-fade': fadeColor, '--marquee-fade-w': `${FADE_WIDTH}px` }}
    >
      {/* Hidden, unconstrained copy → reports the natural text width. */}
      <span ref={measureRef} className="marquee-measure" aria-hidden="true">{text}</span>

      {animate ? (
        <>
          <span
            className="marquee-track marquee-track--animate"
            style={{
              '--marquee-distance': `${distance}px`,
              '--marquee-duration': `${duration}s`,
            }}
          >
            <span className="marquee-text">{text}</span>
          </span>
          <span className="marquee-fade marquee-fade--left" aria-hidden="true" />
          <span className="marquee-fade marquee-fade--right" aria-hidden="true" />
        </>
      ) : (
        <span className="marquee-static">{text}</span>
      )}
    </span>
  )
}
