import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Stand-alone "How challenges work" carousel. Triggered from a city-chat
 * feed prompt and re-openable from anywhere that wants to onboard users on
 * the challenge feature. Smaller and more focused than OnboardingCarousel —
 * just the 5-step challenge loop, no signup flow, no city onboarding.
 *
 * Reuses the existing .onboarding-* CSS skeleton (overlay / track / slide /
 * dots / next button) so this carousel inherits the same look-and-feel
 * without a new style layer.
 */

function buildSlides(t) {
  return [
    { emoji: '🔥', title: t('challengeIntro.slide1.title'), body: t('challengeIntro.slide1.body') },
    { emoji: '🎯', title: t('challengeIntro.slide2.title'), body: t('challengeIntro.slide2.body') },
    { emoji: '🤝', title: t('challengeIntro.slide3.title'), body: t('challengeIntro.slide3.body') },
    { emoji: '👋', title: t('challengeIntro.slide4.title'), body: t('challengeIntro.slide4.body') },
    { emoji: '✨', title: t('challengeIntro.slide5.title'), body: t('challengeIntro.slide5.body') },
  ]
}

export default function ChallengeIntroCarousel({ onClose }) {
  const { t } = useTranslation('common')
  const SLIDES = buildSlides(t)
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

  const handlePrimary = () => (index >= lastIndex ? onClose() : goTo(index + 1))

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label={t('challengeIntro.title')}>
      <button className="onboarding-skip" onClick={onClose} aria-label={t('challengeIntro.skip')}>
        {t('challengeIntro.skip')}
      </button>

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
          {index >= lastIndex ? t('challengeIntro.done') : t('challengeIntro.next')}
        </button>
      </div>
    </div>
  )
}
