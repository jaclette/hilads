/**
 * Marquee - single-line text that auto-scrolls ONLY when it overflows.
 *
 * Web port of the native MarqueeText (apps/mobile/src/components/MarqueeText.tsx).
 * Same behaviour so the two platforms feel identical:
 *   - Overflow-gated: a hidden measuring copy reports the text's natural width;
 *     if it fits the clip window it renders static (with ellipsis when the
 *     caller's container would clip), so short tips never scroll.
 *   - Seamless one-way loop: two copies separated by `gap`; the track scrolls
 *     translateX 0 -> -(textWidth + gap) at a constant speed, then wraps
 *     invisibly (copy 2 lands exactly where copy 1 began). NOT a ping-pong.
 *   - Re-measures on resize (ResizeObserver) and whenever `text` changes.
 *   - prefers-reduced-motion: never animates - static + ellipsis + title tooltip.
 *
 * Timing constants below mirror the native defaults so the platforms stay in sync.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

const GAP = 40             // px between the two looping copies (native: gap)
const SPEED = 40           // px/sec - duration is derived so speed stays constant
const INITIAL_DELAY = 1500 // ms before the first scroll (native: initialDelay)
const FADE_WIDTH = 14      // px edge fade (native: fadeWidth)
const EPSILON = 1

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

  const overflows = textW > 0 && clipW > 0 && textW > clipW + EPSILON
  const animate = overflows && !reduceMotion
  const distance = textW + GAP
  const duration = distance / SPEED // seconds

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
              '--marquee-delay': `${INITIAL_DELAY}ms`,
            }}
          >
            <span className="marquee-text">{text}</span>
            <span className="marquee-gap" aria-hidden="true" style={{ width: GAP }} />
            <span className="marquee-text" aria-hidden="true">{text}</span>
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
