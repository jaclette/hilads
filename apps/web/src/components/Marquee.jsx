/**
 * Marquee - single-line text that auto-scrolls ONLY when it overflows.
 *
 * Web port of the native MarqueeText (apps/mobile/src/components/MarqueeText.tsx).
 *   - Overflow-gated: a hidden measuring copy reports the text's natural width;
 *     if it fits the clip window it renders static (with ellipsis when the
 *     caller's container would clip), so short tips never scroll.
 *   - SINGLE-COPY ping-pong. ONE text element translates from 0 to
 *     -(textW - clipW + LEAD) to reveal the end, holds, then scrolls smoothly
 *     back to 0 to reveal the start, holds, repeat. NO duplicate copy and NO
 *     seamless loop - the duplicate-copy mechanism (older impl) made both
 *     copies visible mid-scroll on narrow clips, which read as a constant
 *     flash. The smooth reverse replaces the old snap-back, which read as the
 *     marquee "stopping" before it jumped back to the start.
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
// Tiny jitter buffer so 1-2 px measurement noise doesn't toggle marquee
// on/off across re-renders. Previously 1.15 (15%) to suppress the OLD
// seamless-duplicate flash - but the single-copy snap-back mechanism now
// in use handles small overflows gracefully (long start/end holds dominate
// the cycle), so a 15% buffer just blocks real overflows like the weather
// pill from scrolling at all. 2% catches jitter without false negatives.
const OVERFLOW_FACTOR = 1.02
// Ping-pong: ONE copy scrolls left to reveal the end, holds, then scrolls
// back to reveal the start, holds, repeat (see the @keyframes). Each scroll
// leg is SCROLL_LEG_PCT of the cycle; the rest is split across the two dwell
// holds. Smooth in both directions - no snap-back. The duration is derived so
// the px/sec speed stays constant regardless of title length.
const SCROLL_LEG_PCT = 30

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
  // Total iteration = one-leg scroll time / leg-portion. (Two scroll legs per
  // cycle, but each leg covers the same distance in the same SCROLL_LEG_PCT.)
  const scrollDuration = distance / SPEED
  const duration = scrollDuration / (SCROLL_LEG_PCT / 100)

  return (
    <span
      ref={clipRef}
      className={`marquee ${className}`.trim()}
      title={overflows ? text : undefined}
      style={{
        '--marquee-fade': fadeColor,
        '--marquee-fade-w': `${FADE_WIDTH}px`,
        // Exposed on the container (not just the track) so the edge-fade
        // overlays can run their opacity keyframes on the same timeline.
        '--marquee-duration': `${duration}s`,
      }}
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
