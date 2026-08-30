import { useEffect, useRef } from 'react'

/**
 * Screen 1 hook video for the stories landing.
 *
 * Self-hosted, ffmpeg-optimized MP4 (H.264, 720x1280, 39s, +faststart, low-bitrate
 * AAC) with a static poster so the first frame paints instantly on slow Instagram
 * in-app webviews. muted + playsInline + preload="auto" = reliable autoplay in
 * in-app browsers. Nothing is overlaid on the <video> (all copy/CTAs live outside
 * this component), and the .sl-video wrapper carries a fixed 9:16 aspect-ratio +
 * dark background so the layout never jumps while the clip loads.
 */

// Hashed-in-name assets: a new clip gets a NEW filename so CDN/browser caches
// can never serve the previous hero (public/ files are not content-hashed).
const MP4_SRC = '/landing/hero-comtam.mp4'
const POSTER  = '/landing/hero-comtam-poster.jpg'

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
      {/* Decorative, muted, no audio track → no captions to provide. (Was an
          eslint-disable for jsx-a11y/media-has-caption; that plugin isn't part
          of the lint setup, so the directive only resolved to an unknown rule.) */}
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
