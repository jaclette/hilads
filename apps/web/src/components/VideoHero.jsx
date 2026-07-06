import { useEffect, useRef } from 'react'

/**
 * The hook video for Screen 1 of the stories landing.
 *
 * Structured so swapping the YouTube iframe for a self-hosted MP4 is trivial:
 * pass source="video" once the MP4 exists - nothing else changes.
 *   TODO: replace the YouTube iframe with a self-hosted <video> (MP4) for LCP /
 *   no third-party JS. Then default `source` to 'video' and set MP4_SRC.
 *
 * IMPORTANT: nothing is overlaid on top of the iframe - a YouTube iframe swallows
 * taps, so all copy/CTAs live OUTSIDE this component (above/below it). The wrapper
 * carries a dark "poster" background + fixed 9:16 aspect-ratio so the layout never
 * jumps while the player loads. If the in-app webview blocks autoplay, YouTube's
 * own thumbnail + play button is the acceptable fallback (no custom handling).
 */

const YT_ID  = 'Y-Avbeamdv0'
const YT_SRC =
  `https://www.youtube.com/embed/${YT_ID}` +
  `?autoplay=1&mute=1&loop=1&playlist=${YT_ID}` +
  `&controls=0&playsinline=1&rel=0&modestbranding=1`

// const MP4_SRC = '/landing/hero.mp4'   // TODO: self-host, then source="video"

export default function VideoHero({ source = 'iframe', onVisible }) {
  const wrapRef = useRef(null)
  const firedRef = useRef(false)

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
      {source === 'video' ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          className="sl-video-el"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          // src={MP4_SRC}
        />
      ) : (
        <iframe
          className="sl-video-el"
          src={YT_SRC}
          title="Hilads"
          loading="eager"
          frameBorder="0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
    </div>
  )
}
