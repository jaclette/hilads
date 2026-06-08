import { useEffect, useRef, useState } from 'react'

/**
 * Web mirror of apps/mobile/src/components/OpenChallengeSlot.tsx.
 *
 * Dashed orange ring + centered `+`, breathing on a 2.4s loop via a
 * CSS keyframe (see .open-challenge-slot in index.css). The component
 * uses an IntersectionObserver to set `animation-play-state` to
 * `paused` when the slot leaves the viewport — long feeds don't burn
 * CPU repainting off-screen pulses.
 *
 * Tap fires the optional onClick (the open-slot shortcut to the
 * accept flow); the card around it stays tappable too.
 */
export default function OpenChallengeSlot({
  size = 72,
  onClick,
  ariaLabel,
}) {
  const elRef = useRef(null)
  const [paused, setPaused] = useState(false)

  // IntersectionObserver pauses the pulse when the slot leaves the
  // viewport. threshold:0 fires as soon as a single pixel intersects
  // (or doesn't), which is what we want: the moment any of the slot
  // is visible, the pulse resumes; once it's fully off-screen, it
  // stops on the current frame. Cheap — no rAF, no scroll listener.
  useEffect(() => {
    const el = elRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      setPaused(!entry.isIntersecting)
    }, { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const style = {
    width:        size,
    height:       size,
    borderRadius: size / 2,
    animationPlayState: paused ? 'paused' : 'running',
  }
  const plusStyle = {
    fontSize:   Math.round(size * 0.42),
    lineHeight: 1,
  }

  // Render as a button when onClick is provided so keyboard + screen
  // reader users get a real tap target. Otherwise a plain span keeps
  // the slot purely decorative (e.g. on past archive cards).
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      ref={elRef}
      type={onClick ? 'button' : undefined}
      className="open-challenge-slot"
      style={style}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="open-challenge-slot-plus" style={plusStyle}>+</span>
    </Tag>
  )
}
