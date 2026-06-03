import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ChallengePipeline from './ChallengePipeline'

// First-time onboarding carousel for GUESTS. Shown once on first city-channel
// arrival and re-openable via the header "?" button. Registered users never
// see it (the caller only mounts it for guests). Lightweight: a CSS
// scroll-snap track + dots, no animation libraries.
//
// Slide 3 swaps the emoji for an embedded <ChallengePipeline> in muted /
// educational mode — same visual newcomers see on the challenge detail page,
// so the onboarding doesn't sell something different from what ships.

function slides(t, city) {
  const where = city || t('onboarding.fallbackCity', { defaultValue: 'your city' })
  return [
    { emoji: '🌍', title: t('onboarding.slide1Title', { city: where }), body: t('onboarding.slide1Body') },
    { emoji: '🤝', title: t('onboarding.slide2Title'),                  body: t('onboarding.slide2Body') },
    { kind: 'pipeline', title: t('onboarding.slide3Title'),             body: t('onboarding.slide3Body') },
    { emoji: '✨', title: t('onboarding.slide4Title'),                  body: t('onboarding.slide4Body') },
  ]
}

export default function OnboardingCarousel({ city, onSignup, onClose }) {
  const { t } = useTranslation('common')
  const SLIDES = slides(t, city)
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
      <button className="onboarding-skip" onClick={onClose} aria-label="Skip intro">{t('onboarding.skip')}</button>

      <div className="onboarding-track" ref={trackRef} onScroll={onScroll}>
        {SLIDES.map((s, i) => (
          <div className="onboarding-slide" key={i}>
            {s.kind === 'pipeline' ? (
              <div className="onboarding-pipeline-wrap" style={{ width: '100%', maxWidth: 360, marginBottom: 8 }}>
                <ChallengePipeline acceptance={null} iAmCreator={false} />
              </div>
            ) : (
              <div className="onboarding-emoji">{s.emoji}</div>
            )}
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
          {index >= lastIndex ? t('onboarding.explore') : t('onboarding.next')}
        </button>

        {/* Discreet, low-emphasis signup — present on every screen. */}
        <button className="onboarding-signup-link" onClick={onSignup}>
          {t('onboarding.createAccount')}
        </button>
      </div>
    </div>
  )
}
