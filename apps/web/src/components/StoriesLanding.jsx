import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import Logo from './Logo'
import { cityFlag, EVENT_ICONS } from '../cityMeta'
import { formatTime } from '../eventUtils'
import VideoHero from './VideoHero'
import { FEATURED_CITY, MIN_LIVE_COUNT } from '../config/featuredCity'

/**
 * Mobile-first vertical "stories" landing (Instagram/TikTok-native). Full-viewport
 * CSS scroll-snap, 5 screens, ONE primary action (anonymous web entry into the
 * featured city). Replaces the long-scroll LandingPage for status==='onboarding'.
 *
 * Screens: 0 hook (video) · 1 live city · 2 how it works · 3 not-a-social-network
 *          · 4 conversion (repeat CTA + store badges + create/login).
 */

const CHALLENGE_TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }
const SCREENS = ['hook', 'live', 'how', 'proof', 'convert']
const LAST = SCREENS.length - 1

// Apple wordmark isn't a reliable glyph across in-app webviews; draw it (crisp,
// currentColor). Mirrors LandingPage's badge so the store badges look identical.
function AppleIcon() {
  return (
    <svg viewBox="0 0 384 512" width="20" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

function StoreBadge({ icon, top, bottom, href, ariaLabel, onClick }) {
  return (
    <a className="lp-store-btn lp-store-btn--live" href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel} onClick={onClick}>
      <span className="lp-store-icon">{icon}</span>
      <span className="lp-store-label">
        <span className="lp-store-top">{top}</span>
        <strong className="lp-store-bottom">{bottom}</strong>
      </span>
    </a>
  )
}

function Chevron() {
  return (
    <svg className="sl-chevron" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function StoriesLanding({
  cityName, cityCountry, landingChallenge = null,
  previewChallenges = [], previewEvents = [], previewTopics = [],
  previewLiveCount = 0, previewChallengeCount = 0, previewEventCount = 0, previewTopicCount = 0,
  previewTimezone = 'UTC',
  onPrimaryCta, onChallengeRow, onSignUp, onSignIn, onStoreClick,
}) {
  const { t } = useTranslation('landing')
  const screenRefs = useRef([])
  const seenRef = useRef(new Set())
  const [active, setActive] = useState(0)

  const showLive = previewLiveCount >= MIN_LIVE_COUNT
  const headlineCity = cityName || FEATURED_CITY.displayName
  const ctaLabel = landingChallenge
    ? t('stories.enterChallenge', { city: FEATURED_CITY.displayName })
    : t('stories.enterCity', { city: FEATURED_CITY.displayName })

  // screen_viewed funnel event (once per screen) + progress bar.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const idx = Number(e.target.dataset.idx)
          setActive(idx)
          if (!seenRef.current.has(idx)) {
            seenRef.current.add(idx)
            track('screen_viewed', { index: idx, name: SCREENS[idx] })
          }
        }
      },
      { threshold: 0.6 },
    )
    screenRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  // Funnel entry: fire once when the stories landing mounts (utm super-props are
  // attached automatically by PostHog; here we add referrer + screen size).
  useEffect(() => {
    track('landing_view', {
      referrer: (typeof document !== 'undefined' && document.referrer) || null,
      screen_w: typeof window !== 'undefined' ? window.screen?.width : null,
      screen_h: typeof window !== 'undefined' ? window.screen?.height : null,
      has_challenge: !!landingChallenge,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setRef = (i) => (el) => { screenRefs.current[i] = el }

  const ctaVariant = landingChallenge ? 'challenge_join' : 'city_join'
  const primary = () => {
    track('cta_primary_clicked', { screen: active, cta_variant: ctaVariant })
    onPrimaryCta?.()
  }
  const tapChallenge = (ch) => {
    track('challenge_row_clicked', { challenge_id: ch?.id })
    onChallengeRow?.(ch)
  }
  const tapStore = (store) => () => { track('store_badge_clicked', { store }) ; onStoreClick?.(store) }

  const hint = (
    <div className="sl-hint" aria-hidden="true">
      <Chevron />
      <span className="sl-hint-text">{t('stories.swipeUp')}</span>
    </div>
  )

  return (
    <div className="sl">
      {/* Stories-style segmented progress bar (fixed top) */}
      <div className="sl-progress" aria-hidden="true">
        {SCREENS.map((s, i) => (
          <span key={s} className={`sl-progress-seg${i === active ? ' active' : ''}${i < active ? ' done' : ''}`} />
        ))}
      </div>

      {/* ── S1 Hook ─────────────────────────────────────────────── */}
      <section className="sl-screen sl-screen--hook" data-idx="0" ref={setRef(0)}>
        <div className="sl-brand">
          <Logo />
          <span className="sl-tagline">{t('stories.tagline')}</span>
        </div>
        <VideoHero onVisible={() => track('video_visible')} />
        {hint}
      </section>

      {/* ── S2 Live city ────────────────────────────────────────── */}
      <section className="sl-screen sl-screen--live" data-idx="1" ref={setRef(1)}>
        <h2 className="sl-headline">
          {t('stories.liveHeadline', { city: headlineCity })}{' '}
          <span className="sl-flag">{cityFlag(cityCountry)}</span>
        </h2>

        {/* Deep-linked challenge (/c/:id) pinned + highlighted */}
        {landingChallenge && (
          <button className="ob-event-row ob-challenge-row sl-row sl-row--hot" onClick={() => tapChallenge(landingChallenge)}>
            <span className="ob-event-title">
              {CHALLENGE_TYPE_ICONS[landingChallenge.challenge_type] ?? '🔥'} {landingChallenge.title}
            </span>
            <span className="sl-row-cta">→</span>
          </button>
        )}

        {/* Strongest true signal: people-online only when ≥ MIN_LIVE_COUNT, else lead with challenges/events */}
        <div className="ob-activity-block sl-activity">
          {showLive && <span className="ob-activity-line">{t('join.peopleLive', { count: previewLiveCount })}</span>}
          {previewChallengeCount > 0 && <span className="ob-activity-line">{t('join.challenges', { count: previewChallengeCount })}</span>}
          {previewEventCount > 0 && <span className="ob-activity-line">{t('join.events', { count: previewEventCount })}</span>}
          {previewTopicCount > 0 && <span className="ob-activity-line">{t('join.hangouts', { count: previewTopicCount })}</span>}
        </div>

        {/* Real challenge titles - tappable, each joins into that challenge */}
        {previewChallenges.length > 0 && (
          <div className="ob-events-preview ob-challenges-preview">
            {previewChallenges.filter(ch => ch.id !== landingChallenge?.id).map((ch) => (
              <button key={ch.id} className="ob-event-row ob-challenge-row sl-row" onClick={() => tapChallenge(ch)}>
                <span className="ob-event-title">{CHALLENGE_TYPE_ICONS[ch.challenge_type] ?? '🔥'} {ch.title}</span>
                <span className="sl-row-cta">→</span>
              </button>
            ))}
          </div>
        )}
        {/* Real events - tapping enters the city (anonymous join) */}
        {previewEvents.length > 0 && (
          <div className="ob-events-preview">
            {previewEvents.map((e) => (
              <button key={e.id} className="ob-event-row sl-row" onClick={primary}>
                <span className="ob-event-title">{EVENT_ICONS[e.event_type] ?? '📌'} {e.title}</span>
                <span className="ob-event-time">{formatTime(e.starts_at, previewTimezone)}</span>
              </button>
            ))}
          </div>
        )}
        {hint}
      </section>

      {/* ── S3 How it works ─────────────────────────────────────── */}
      <section className="sl-screen sl-screen--how" data-idx="2" ref={setRef(2)}>
        <h2 className="sl-headline">{t('stories.how.title')}</h2>
        <div className="sl-steps">
          <div className="sl-step"><span className="sl-step-icon">🌍</span><span className="sl-step-text">{t('stories.how.step1')}</span></div>
          <div className="sl-step"><span className="sl-step-icon">🔥</span><span className="sl-step-text">{t('stories.how.step2')}</span></div>
          <div className="sl-step"><span className="sl-step-icon">👋</span><span className="sl-step-text">{t('stories.how.step3')}</span></div>
        </div>
        {hint}
      </section>

      {/* ── S4 Not another social network ───────────────────────── */}
      <section className="sl-screen sl-screen--proof" data-idx="3" ref={setRef(3)}>
        <h2 className="sl-concept">
          <span>{t('stories.concept.line1')}</span>
          <span>{t('stories.concept.line2')}</span>
          <span>{t('stories.concept.line3')}</span>
          <strong>{t('stories.concept.line4')}</strong>
        </h2>
        <div className="sl-stats">
          {showLive && (
            <div className="sl-stat"><span className="sl-stat-num">{previewLiveCount}+</span><span className="sl-stat-label">{t('stats.peopleLive')}</span></div>
          )}
          <div className="sl-stat"><span className="sl-stat-num">20+</span><span className="sl-stat-label">{t('stats.cities')}</span></div>
          <div className="sl-stat"><span className="sl-stat-num">500+</span><span className="sl-stat-label">{t('stats.eventsCreated')}</span></div>
        </div>
        {hint}
      </section>

      {/* ── S5 Conversion ───────────────────────────────────────── */}
      <section className="sl-screen sl-screen--convert" data-idx="4" ref={setRef(4)}>
        <h2 className="sl-headline sl-headline--convert">{t('stories.liveHeadline', { city: headlineCity })}</h2>
        <div className="sl-cta-group">
          <button className="sl-cta-big" onClick={primary}>{ctaLabel}</button>
          <p className="sl-reassure">{t('stories.reassurance')}</p>
        </div>

        <div className="sl-store">
          <p className="sl-store-prompt">{t('stories.storePrompt')}</p>
          <div className="sl-stores">
            <StoreBadge icon={<AppleIcon />} top={t('hero.storeDownloadOn')} bottom="App Store"
              href="https://apps.apple.com/app/id6768905591" ariaLabel="Download Hilads on the App Store" onClick={tapStore('ios')} />
            <StoreBadge icon="▶" top={t('hero.storeGetItOn')} bottom="Google Play"
              href="https://play.google.com/store/apps/details?id=com.hilads.app" ariaLabel="Download Hilads on Google Play" onClick={tapStore('android')} />
          </div>
        </div>

        <div className="sl-tertiary">
          <button type="button" className="sl-link" onClick={onSignUp}>{t('join.createAccount')}</button>
          <span className="sl-tertiary-dot">·</span>
          <button type="button" className="sl-link" onClick={onSignIn}>{t('join.logIn')}</button>
        </div>
      </section>

      {/* Sticky CTA dock (button + reassurance line) - persists across every
          screen except the last (which has its own centered CTA group). Safe-area
          padded so the whole block stays above in-app browser chrome. */}
      {active < LAST && (
        <div className="sl-cta-dock">
          <button className="sl-cta" onClick={primary}>{ctaLabel}</button>
          <p className="sl-reassure">{t('stories.reassurance')}</p>
        </div>
      )}
    </div>
  )
}
