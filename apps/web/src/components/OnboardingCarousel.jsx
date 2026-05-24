import { useRef, useState, useCallback } from 'react'

// First-time onboarding carousel for GUESTS. Shown once on first city-channel
// arrival and re-openable via the header "?" button. Registered users never
// see it (the caller only mounts it for guests). Lightweight: a CSS
// scroll-snap track + dots, no animation libraries.

function slides(city) {
  const where = city || 'your city'
  return [
    {
      emoji: '👋',
      title: `You're in ${where}`,
      body: <>This is your city's live chat. See what's buzzing and say hi.</>,
    },
    {
      emoji: '🔥',
      title: 'Tap NOW',
      body: <>Spontaneous <strong>hangouts</strong> to jump into right now, plus <strong>events</strong> planned around you.</>,
    },
    {
      emoji: '👀',
      title: 'See who’s around',
      body: <>Locals and travelers in your city, live this minute.</>,
    },
    {
      emoji: '✨',
      title: 'Make it yours',
      body: <>A free account lets you join hangouts, keep your name, add friends &amp; get notified.</>,
    },
  ]
}

export default function OnboardingCarousel({ city, onSignup, onClose }) {
  const SLIDES = slides(city)
  const lastIndex = SLIDES.length - 1
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)

  const onScroll = useCallback(() => {
    const el = trackRef.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setIndex((prev) => (i !== prev ? i : prev))
  }, [])

  const goTo = (i) => {
    const el = trackRef.current
    if (!el) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  // Primary button: advance, then dismiss on the last slide (swiping there +
  // tapping "Explore first" both close it without signing up).
  const handlePrimary = () => (index >= lastIndex ? onClose() : goTo(index + 1))

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Hilads">
      <button className="onboarding-skip" onClick={onClose} aria-label="Skip intro">Skip ✕</button>

      <div className="onboarding-track" ref={trackRef} onScroll={onScroll}>
        {SLIDES.map((s, i) => (
          <div className="onboarding-slide" key={i}>
            <div className="onboarding-emoji">{s.emoji}</div>
            <h2 className="onboarding-title">{s.title}</h2>
            <p className="onboarding-body">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="onboarding-footer">
        <div className="onboarding-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`onboarding-dot${i === index ? ' is-active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        <button className="onboarding-next" onClick={handlePrimary}>
          {index >= lastIndex ? 'Explore first' : 'Next'}
        </button>

        {/* Discreet, low-emphasis signup — present on every screen. */}
        <button className="onboarding-signup-link" onClick={onSignup}>
          Create an account
        </button>
      </div>
    </div>
  )
}
