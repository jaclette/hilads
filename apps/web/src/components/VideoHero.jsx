import { useEffect, useRef } from 'react'

/**
 * Screen 1 hook video for the stories landing.
 *
 * Self-hosted, ffmpeg-optimized MP4 (H.264, 576x1024, 15s, +faststart, no audio)
 * with a static poster so the first frame paints instantly on slow Instagram
 * in-app webviews. muted + playsInline + preload="auto" = reliable autoplay in
 * in-app browsers. Nothing is overlaid on the <video> (all copy/CTAs live outside
 * this component), and the .sl-video wrapper carries a fixed 9:16 aspect-ratio +
 * dark background so the layout never jumps while the clip loads.
 */

const MP4_SRC = '/landing/hero.mp4'
const POSTER  = '/landing/hero-poster.jpg'

export default function VideoHero({ onVisible, onPlay }) {
  const wrapRef   = useRef(null)
  const firedRef  = useRef(false)
  const playedRef = useRef(false)

  // Fire once when the video is ≥50% on screen (funnel: video_visible).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !onVisible || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !firedRef.current) {
            firedRef.current = true
            onVisible()
            io.disconnect()
          }
        }
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onVisible])

  return (
    <div ref={wrapRef} className="sl-video">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="sl-video-el"
        src={MP4_SRC}
        poster={POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onPlay={() => { if (!playedRef.current) { playedRef.current = true; onPlay?.() } }}
      />
    </div>
  )
}
