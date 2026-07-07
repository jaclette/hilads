import { useEffect, useRef, useState } from 'react'

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

export default function VideoHero({ source = 'iframe', onVisible, onPlay }) {
  const wrapRef = useRef(null)
  const firedRef = useRef(false)
  // Click-to-play: the heavy autoplaying iframe is NOT loaded on mount (on slow
  // connections that left a black rectangle while it buffered). Show a light
  // thumbnail + play button first; load the iframe only when the user taps.
  const [playing, setPlaying] = useState(false)

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
          muted
          loop
          playsInline
          controls
          preload="none"
          // src={MP4_SRC}   // TODO: self-host, then source="video"
        />
      ) : playing ? (
        <iframe
          className="sl-video-el"
          src={YT_SRC}
          title="Hilads"
          loading="eager"
          frameBorder="0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        // Lightweight poster - the thumbnail (~10-20 KB) paints instantly even on
        // slow connections; tapping loads the autoplaying iframe (user gesture).
        <button
          type="button"
          className="sl-video-play-btn"
          onClick={() => { setPlaying(true); onPlay?.() }}
          aria-label="Play video"
        >
          <img className="sl-video-el" src={`https://i.ytimg.com/vi/${YT_ID}/hqdefault.jpg`} alt="" loading="eager" />
          <span className="sl-video-play" aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  )
}
