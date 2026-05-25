import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import Logo from './Logo'
import { cityFlag, EVENT_ICONS } from '../cityMeta'
import { formatTime } from '../eventUtils'

// ── Avatar palette — same set as App.jsx ─────────────────────────────────────

const AVATAR_PALETTES = [
  ['#E14D2A', '#F7941D'],
  ['#6C63FF', '#A78BFA'],
  ['#059669', '#34D399'],
  ['#DB2777', '#F472B6'],
  ['#D97706', '#FCD34D'],
  ['#7C3AED', '#C4B5FD'],
  ['#0891B2', '#67E8F9'],
  ['#DC2626', '#FCA5A5'],
]
function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// Render a translated string that contains "\n" as <br/>-separated lines.
function nl2br(text) {
  return String(text).split('\n').map((line, i) => (
    <span key={i}>{i > 0 && <br />}{line}</span>
  ))
}

// Icon + number for the "How it works" steps — text (title/desc) comes from i18n.
const HOW_META = [
  { icon: '📍', num: '01' },
  { icon: '🎯', num: '02' },
  { icon: '✨', num: '03' },
]

// ── Join form card (shared between hero + footer CTA) ─────────────────────────

function JoinCard({ city, cityCountry, geoState, nickname, setNickname, handleJoin, previewLiveCount, previewEventCount = 0, previewTopicCount = 0, previewTopics = [], previewEvents = [], previewTimezone = 'UTC', onOpenCityPicker, retryGeo, onSignUp, onSignIn, autoFocus = false }) {
  const { t } = useTranslation('landing')
  const noGeo = geoState === 'denied' || geoState === 'error'
  const [c1, c2] = avatarColors(nickname || 'A')

  return (
    <div className="ob-card lp-join-card">
      {/* City info */}
      <div className="ob-city-block">
        {city ? (
          <>
            <span className="ob-city-name">
              {city}{' '}
              <span style={{ fontSize: '0.8em', verticalAlign: 'middle', WebkitTextFillColor: 'initial' }}>
                {cityFlag(cityCountry)}
              </span>
            </span>
            <div className="ob-activity-block">
              <span className="ob-activity-line">
                {t('join.peopleLive', { count: previewLiveCount })}
              </span>
              {previewEventCount > 0 && (
                <span className="ob-activity-line">
                  {t('join.events', { count: previewEventCount })}
                </span>
              )}
              {previewTopicCount > 0 && (
                <span className="ob-activity-line">
                  {t('join.hangouts', { count: previewTopicCount })}
                </span>
              )}
            </div>
            {previewEvents.length > 0 && (
              <div className="ob-events-preview">
                {previewEvents.map(e => (
                  <div key={e.id} className="ob-event-row">
                    <span className="ob-event-title">
                      {EVENT_ICONS[e.event_type] ?? '📌'} {e.title}
                    </span>
                    <span className="ob-event-time">
                      {formatTime(e.starts_at, previewTimezone)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {previewTopics.length > 0 && (
              <div className="ob-events-preview ob-topics-preview">
                {previewTopics.map(topic => (
                  <div key={topic.id} className="ob-event-row ob-topic-row">
                    <span className="ob-event-title">🗣️ {topic.title}</span>
                    {(topic.message_count ?? 0) > 0 && (
                      <span className="ob-event-time">{t('join.replies', { count: topic.message_count })}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : noGeo ? (
          <p className="ob-geo-headline">{nl2br(t('join.pickCity'))}</p>
        ) : (
          <span className="ob-locating">{t('join.locating')}</span>
        )}
      </div>

      <div className="ob-sep" />

      {/* Form */}
      <form
        className="ob-form"
        onSubmit={noGeo ? (e) => { e.preventDefault(); onOpenCityPicker() } : handleJoin}
      >
        {noGeo ? (
          <>
            <button type="submit" className="ob-btn">{t('join.browseCities')}</button>
            <label className="ob-label" style={{ marginTop: 4 }}>{t('join.yourName')}</label>
            <div className="ob-input-row">
              <span
                className="ob-avatar-preview"
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
              >
                {(nickname[0] || 'A').toUpperCase()}
              </span>
              <input
                className="ob-input"
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                maxLength={20}
                placeholder={t('join.namePlaceholder')}
              />
            </div>
            {typeof navigator !== 'undefined' && navigator.geolocation && (
              <button type="button" className="ob-geo-retry" onClick={retryGeo}>
                {geoState === 'error' ? t('join.tryAgain') : t('join.useLocation')}
              </button>
            )}
          </>
        ) : (
          <>
            <label className="ob-label">{t('join.yourName')}</label>
            <div className="ob-input-row">
              <span
                className="ob-avatar-preview"
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
              >
                {(nickname[0] || 'A').toUpperCase()}
              </span>
              <input
                className="ob-input"
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                maxLength={20}
                autoFocus={autoFocus}
                placeholder={t('join.namePlaceholder')}
              />
            </div>
            <button type="submit" className="ob-btn">
              {city ? t('join.joinCity', { city }) : t('join.joinChat')}
            </button>
          </>
        )}
        <p className="ob-hint">{t('join.hint')}</p>
      </form>

      {/* Auth section */}
      <div className="jc-auth">
        <div className="jc-auth-divider">
          <span className="jc-auth-divider-text">{t('join.keepIdentity')}</span>
        </div>
        <div className="jc-auth-actions">
          <button className="jc-auth-signup" onClick={onSignUp}>
            {t('join.createAccount')}
          </button>
          <button className="jc-auth-signin" onClick={onSignIn}>
            {t('join.logIn')}
          </button>
        </div>
        <p className="jc-auth-hint">{t('join.authHint')}</p>
      </div>
    </div>
  )
}

// ── Phone frame wrapper ────────────────────────────────────────────────────────

function PhoneFrame({ children }) {
  return (
    <div className="lp-phone">
      <div className="lp-phone-notch" />
      <div className="lp-phone-screen">
        {children}
      </div>
    </div>
  )
}

// ── Local mockup: "Host your spot" event creation ─────────────────────────────
// NOTE: mockup content is decorative app-preview imagery — left in English on
// purpose (it mimics user-generated data, which is never translated).

function LocalMockup() {
  return (
    <PhoneFrame>
      <div className="lp-app-header">
        <span className="lp-app-back">←</span>
        <span className="lp-app-title">Host your spot</span>
      </div>
      <div className="lp-phone-body">
        <div className="lp-mock-section-label">QUICK START</div>
        <div className="lp-mock-presets">
          <div className="lp-mock-preset lp-mock-preset--on">
            <span className="lp-mock-preset-emoji">🏠</span>
            <span className="lp-mock-preset-label">Daily spot</span>
          </div>
          <div className="lp-mock-preset">
            <span className="lp-mock-preset-emoji">🌙</span>
            <span className="lp-mock-preset-label">Every eve</span>
          </div>
          <div className="lp-mock-preset">
            <span className="lp-mock-preset-emoji">🎉</span>
            <span className="lp-mock-preset-label">Weekends</span>
          </div>
        </div>

        <div className="lp-mock-field-label">TITLE</div>
        <div className="lp-mock-field">Friday drinks @ Le Marais</div>

        <div className="lp-mock-inline-row">
          <span className="lp-mock-field-label">REPEAT</span>
          <span className="lp-mock-toggle">Every day</span>
        </div>

        <div className="lp-mock-field-label">TIME</div>
        <div className="lp-mock-time-row">
          <span className="lp-mock-time">18:00</span>
          <span className="lp-mock-time-sep">→</span>
          <span className="lp-mock-time">21:00</span>
        </div>
      </div>
      <div className="lp-mock-submit lp-mock-submit--local">Open your spot →</div>
    </PhoneFrame>
  )
}

// ── Exploring mockup: Hot / Events feed ───────────────────────────────────────
// Decorative app-preview — left in English (mimics user data). See note above.

function ExploringMockup() {
  return (
    <PhoneFrame>
      <div className="lp-app-header lp-app-header--explore">
        <span className="lp-app-city">🔥 Now · Barcelona 🇪🇸</span>
        <span className="lp-app-count">● 14 online</span>
      </div>
      <div className="lp-phone-body">

        <div className="lp-mock-card lp-mock-card--recurring">
          <div className="lp-mock-badges">
            <span className="lp-mock-badge lp-mock-badge--recur">↻ Every Fri</span>
            <span className="lp-mock-badge lp-mock-badge--live">LIVE</span>
          </div>
          <div className="lp-mock-card-title">🍻 Drinks in District 1</div>
          <div className="lp-mock-card-meta">📍 El Born · 18:00 → 22:00</div>
          <div className="lp-mock-card-footer">
            <span className="lp-mock-going">12 going</span>
            <span className="lp-mock-join lp-mock-join--live">Join</span>
          </div>
        </div>

        <div className="lp-mock-card">
          <div className="lp-mock-card-title">☕ Coffee &amp; chill</div>
          <div className="lp-mock-card-meta">📍 Poblenou · 10:00</div>
          <div className="lp-mock-card-footer">
            <span className="lp-mock-going">5 here</span>
            <span className="lp-mock-join">Join</span>
          </div>
        </div>

        <div className="lp-mock-card">
          <div className="lp-mock-card-title">🎶 Live music tonight</div>
          <div className="lp-mock-card-meta">📍 Gracia · 21:00</div>
          <div className="lp-mock-card-footer">
            <span className="lp-mock-going">20 joined</span>
            <span className="lp-mock-join">Join</span>
          </div>
        </div>

        <div className="lp-mock-activity">
          <span className="lp-mock-activity-dot" />
          jack joined the city
        </div>

      </div>
      <div className="lp-mock-submit lp-mock-submit--exploring">See what's happening →</div>
    </PhoneFrame>
  )
}

// ── Store badge button ─────────────────────────────────────────────────────────

// Apple logo as inline SVG. The U+F8FF Apple glyph only renders on Apple
// devices (tofu elsewhere), so we draw it — crisp on every platform, sized to
// match the Google Play ▶ glyph and tinted via currentColor.
function AppleIcon() {
  return (
    <svg viewBox="0 0 384 512" width="20" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
    </svg>
  )
}

function StoreBadge({ icon, top, bottom, href, ariaLabel }) {
  const inner = (
    <>
      <span className="lp-store-icon">{icon}</span>
      <span className="lp-store-label">
        <span className="lp-store-top">{top}</span>
        <strong className="lp-store-bottom">{bottom}</strong>
      </span>
    </>
  )
  if (href) {
    return (
      <a className="lp-store-btn lp-store-btn--live" href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel}>
        {inner}
      </a>
    )
  }
  return (
    <button className="lp-store-btn" disabled title="Coming soon">
      {inner}
    </button>
  )
}

// ── Landing page ──────────────────────────────────────────────────────────────

export default function LandingPage({
  city, cityCountry, geoState,
  nickname, setNickname,
  handleJoin,
  previewLiveCount,
  previewEventCount = 0,
  previewTopicCount = 0,
  previewTopics = [],
  previewEvents = [],
  previewTimezone = 'UTC',
  onSignUp, onSignIn, onOpenCityPicker, retryGeo,
}) {
  const { t } = useTranslation('landing')
  const heroJoinRef = useRef(null)

  useEffect(() => {
    track('landing_viewed')
  }, [])

  function scrollToJoin() {
    heroJoinRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function handleJoinWithTracking(e) {
    track('clicked_join_city', { city: city ?? null, entry_mode: 'guest' })
    handleJoin(e)
  }

  function handleSignUp() {
    track('clicked_sign_up')
    onSignUp()
  }

  function handleSignIn() {
    track('clicked_sign_in')
    onSignIn()
  }

  const localBullets     = t('local.bullets',     { returnObjects: true })
  const exploringBullets = t('exploring.bullets', { returnObjects: true })
  const howSteps         = t('how.steps',          { returnObjects: true })
  const conceptRules     = t('concept.rules',      { returnObjects: true })

  return (
    <div className="lp">

      {/* ── 1. HERO ─────────────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-brand">
          <Logo variant="wordmark" size="lg" />
        </div>

        {/* Brand tagline — fixed English, never translated. */}
        <h1 className="lp-hero-h1">
          Feel local.<br />Anywhere.
        </h1>

        <p className="lp-hero-sub">
          {nl2br(t('hero.sub'))}
        </p>

        <div ref={heroJoinRef} className="lp-hero-join">
          <JoinCard
            city={city}
            cityCountry={cityCountry}
            geoState={geoState}
            nickname={nickname}
            setNickname={setNickname}
            handleJoin={handleJoinWithTracking}
            previewLiveCount={previewLiveCount}
            previewEventCount={previewEventCount}
            previewTopicCount={previewTopicCount}
            previewTopics={previewTopics}
            previewEvents={previewEvents}
            previewTimezone={previewTimezone}
            onOpenCityPicker={onOpenCityPicker}
            retryGeo={retryGeo}
            onSignUp={handleSignUp}
            onSignIn={handleSignIn}
            autoFocus
          />
        </div>

        <div className="lp-hero-stores">
          <StoreBadge icon="▶" top="Get it on" bottom="Google Play" href="https://play.google.com/store/apps/details?id=com.hilads.app" ariaLabel="Download Hilads on Google Play" />
          <StoreBadge icon={<AppleIcon />} top="Download on the" bottom="App Store" href="https://apps.apple.com/app/id6768905591" ariaLabel="Download Hilads on the App Store" />
        </div>

        <div className="lp-scroll-hint" aria-hidden="true">↓</div>
      </section>

      {/* ── 2. SPLIT — Local vs Exploring ───────────────────────────────────── */}
      <section className="lp-split-section">

        {/* Local — text left, phone right */}
        <div className="lp-split-row lp-split-row--local">
          <div className="lp-split-text">
            <div className="lp-split-badge">{t('local.badge')}</div>
            <h2 className="lp-split-title">{t('local.title')}</h2>
            <p className="lp-split-tagline">{t('local.tagline')}</p>
            <ul className="lp-split-bullets">
              {localBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <button className="lp-split-cta lp-split-cta--local" onClick={scrollToJoin}>
              {t('local.cta')}
            </button>
          </div>
          <div className="lp-split-visual">
            <LocalMockup />
          </div>
        </div>

        {/* Exploring — phone left, text right */}
        <div className="lp-split-row lp-split-row--exploring">
          <div className="lp-split-visual">
            <ExploringMockup />
          </div>
          <div className="lp-split-text">
            <div className="lp-split-badge lp-split-badge--exploring">{t('exploring.badge')}</div>
            <h2 className="lp-split-title">{t('exploring.title')}</h2>
            <p className="lp-split-tagline">{t('exploring.tagline')}</p>
            <ul className="lp-split-bullets lp-split-bullets--exploring">
              {exploringBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <button className="lp-split-cta lp-split-cta--exploring" onClick={scrollToJoin}>
              {t('exploring.cta')}
            </button>
          </div>
        </div>

      </section>

      {/* ── 3. HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="lp-section lp-how">
        <p className="lp-section-eyebrow">{t('how.eyebrow')}</p>
        <h2 className="lp-section-title">{t('how.title')}</h2>

        <div className="lp-steps">
          {HOW_META.map((m, i) => (
            <div key={m.num} className="lp-step">
              <span className="lp-step-icon">{m.icon}</span>
              <span className="lp-step-num">{m.num}</span>
              <h3 className="lp-step-title">{howSteps[i]?.title}</h3>
              <p className="lp-step-desc">{nl2br(howSteps[i]?.desc ?? '')}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. STATS ────────────────────────────────────────────────────────── */}
      <section className="lp-section lp-stats">
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <span className="lp-stat-value lp-stat-live">
              <span className="lp-stat-pulse" />
              {previewLiveCount}+
            </span>
            <span className="lp-stat-label">{t('stats.peopleLive')}</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">20+</span>
            <span className="lp-stat-label">{t('stats.cities')}</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">500+</span>
            <span className="lp-stat-label">{t('stats.eventsCreated')}</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">0</span>
            <span className="lp-stat-label">{t('stats.signupsNeeded')}</span>
          </div>
        </div>
      </section>

      {/* ── 5. CONCEPT ──────────────────────────────────────────────────────── */}
      <section className="lp-section lp-concept">
        <div className="lp-concept-inner">
          <h2 className="lp-concept-h2">
            {nl2br(t('concept.title'))}
          </h2>
          <div className="lp-concept-rules">
            {conceptRules.map((r, i) => <p key={i}>{r}</p>)}
          </div>
        </div>
      </section>

      {/* ── 6. SEO ──────────────────────────────────────────────────────────── */}
      <section className="lp-section lp-seo" aria-label="About Hilads">
        <p className="lp-seo-body">
          {t('seo')}
        </p>
      </section>

      {/* ── 7. DOWNLOAD ─────────────────────────────────────────────────────── */}
      <section className="lp-section lp-download">
        <p className="lp-section-eyebrow">{t('download.eyebrow')}</p>
        <h2 className="lp-section-title">{t('download.title')}</h2>
        <p className="lp-download-sub">{t('download.sub')}</p>
        <div className="lp-store-badges">
          <StoreBadge icon="▶" top="Get it on" bottom="Google Play" href="https://play.google.com/store/apps/details?id=com.hilads.app" ariaLabel="Download Hilads on Google Play" />
          <StoreBadge icon={<AppleIcon />} top="Download on the" bottom="App Store" href="https://apps.apple.com/app/id6768905591" ariaLabel="Download Hilads on the App Store" />
        </div>
      </section>

      {/* ── 7. REPEAT CTA ───────────────────────────────────────────────────── */}
      <section className="lp-section lp-cta">
        <p className="lp-section-eyebrow">{t('repeat.eyebrow')}</p>
        <h2 className="lp-section-title">
          {city ? t('repeat.titleCity', { city }) : t('repeat.titleGeneric')}
        </h2>
        <JoinCard
          city={city}
          cityCountry={cityCountry}
          geoState={geoState}
          nickname={nickname}
          setNickname={setNickname}
          handleJoin={handleJoinWithTracking}
          previewLiveCount={previewLiveCount}
          previewEventCount={previewEventCount}
          previewTopicCount={previewTopicCount}
          previewTopics={previewTopics}
          previewEvents={previewEvents}
          previewTimezone={previewTimezone}
          onOpenCityPicker={onOpenCityPicker}
          retryGeo={retryGeo}
          onSignUp={handleSignUp}
          onSignIn={handleSignIn}
        />
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <Logo variant="icon" size="sm" />
        {/* Brand tagline — fixed English. */}
        <span className="lp-footer-tagline">Feel local. Anywhere.</span>
      </footer>

    </div>
  )
}
