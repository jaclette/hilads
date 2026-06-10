import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * OnboardingCarousel — 4-screen first-launch flow.
 *
 *   1. Promise          — "Become local. Anywhere." brand tagline
 *   2. Three tools      — Challenges / Hangouts / Local Events
 *   3. Earn your place  — points = how local you've become
 *   4. Invitation       — three CTAs (challenge / Most Local / look around)
 *
 * Web mirror of apps/mobile/src/features/onboarding/OnboardingCarousel.tsx.
 * Same content, same brand-locked English phrases ("Become local.
 * Anywhere.", "Most Local", "Local Events", "Challenges", "Hangouts")
 * carried through every locale via t().
 *
 * The 3 final CTAs are wired through callbacks (onTakeChallenge /
 * onMostLocal / onLookAround) so App.jsx owns the navigation primitives
 * — there's no router on web, just state setters (setNowFilter,
 * setShowLeaderboard + setLeaderboardScope).
 *
 * Scroll mechanics: CSS scroll-snap on .onboarding-track + smooth
 * scrollTo. No animation library.
 */

export default function OnboardingCarousel({
  city,
  onClose,
  onTakeChallenge,
  onMostLocal,
  onLookAround,
}) {
  const { t } = useTranslation('common')
  const where = city || t('onboarding.fallbackCity', { defaultValue: 'your city' })
  const SLIDES = 4
  const lastIndex = SLIDES - 1
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
  const handleAdvance = () => goTo(Math.min(index + 1, lastIndex))

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Hilads">
      <button className="onboarding-skip" onClick={onClose} aria-label="Skip intro">{t('onboarding.skip')}</button>

      <div className="onboarding-track" ref={trackRef} onScroll={onScroll}>
        {/* Screen 1 — promise */}
        <div className="onboarding-slide">
          <div className="onboarding-emoji">🌍</div>
          <h2 className="onboarding-title">{t('onboarding.slide1.title')}</h2>
          <p className="onboarding-body">{t('onboarding.slide1.body')}</p>
        </div>

        {/* Screen 2 — three tools */}
        <div className="onboarding-slide">
          <h2 className="onboarding-title">{t('onboarding.slide2.title')}</h2>
          <ul className="onboarding-tool-list">
            <li>{t('onboarding.slide2.itemChallenges')}</li>
            <li>{t('onboarding.slide2.itemHangouts')}</li>
            <li>{t('onboarding.slide2.itemEvents')}</li>
          </ul>
        </div>

        {/* Screen 3 — earn your place */}
        <div className="onboarding-slide">
          <div className="onboarding-emoji">✨</div>
          <h2 className="onboarding-title">{t('onboarding.slide3.title')}</h2>
          <p className="onboarding-body">{t('onboarding.slide3.body', { city: where })}</p>
        </div>

        {/* Screen 4 — invitation */}
        <div className="onboarding-slide">
          <h2 className="onboarding-title">{t('onboarding.slide4.title')}</h2>
          <div className="onboarding-cta-stack">
            <button type="button" className="onboarding-cta-primary" onClick={onTakeChallenge}>
              {t('onboarding.slide4.ctaChallenge', { city: where })}
            </button>
            <button type="button" className="onboarding-cta-primary" onClick={onMostLocal}>
              {t('onboarding.slide4.ctaMostLocal', { city: where })}
            </button>
            <button type="button" className="onboarding-cta-tertiary" onClick={onLookAround}>
              {t('onboarding.slide4.ctaLookAround')}
            </button>
          </div>
        </div>
      </div>

      <div className="onboarding-footer">
        <div className="onboarding-dots">
          {Array.from({ length: SLIDES }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`onboarding-dot${i === index ? ' is-active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Advance button only on screens 1-3. Screen 4's three CTAs
            replace it — showing a fourth button would clutter the
            invitation surface. */}
        {index < lastIndex && (
          <button type="button" className="onboarding-next" onClick={handleAdvance}>
            {t('onboarding.next', { defaultValue: 'Next' })}
          </button>
        )}
      </div>
    </div>
  )
}
