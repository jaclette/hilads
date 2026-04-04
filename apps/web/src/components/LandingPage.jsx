import { useRef, useEffect } from 'react'
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

// ── Static content ────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  {
    icon: '👀',
    num: '01',
    title: 'See who\'s around',
    desc: 'Your city is live. Find out who\'s hanging out right now.',
  },
  {
    icon: '👋',
    num: '02',
    title: 'Say hi instantly',
    desc: 'Jump into the city chat. No account needed. Just a name.',
  },
  {
    icon: '🔥',
    num: '03',
    title: 'Join the vibe',
    desc: 'Discover events, meet locals, make something happen.',
  },
]

// ── Join form card (shared between hero + footer CTA) ─────────────────────────

function JoinCard({ city, cityCountry, geoState, nickname, setNickname, handleJoin, previewLiveCount, previewEventCount = 0, previewTopicCount = 0, previewTopics = [], previewEvents = [], previewTimezone = 'UTC', onOpenCityPicker, retryGeo, onSignUp, onSignIn, autoFocus = false }) {
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
                🔥 {previewLiveCount} {previewLiveCount === 1 ? 'person' : 'people'} hanging out right now
              </span>
              {previewEventCount > 0 && (
                <span className="ob-activity-line">
                  🔥 {previewEventCount} event{previewEventCount === 1 ? '' : 's'} happening today
                </span>
              )}
              {previewTopicCount > 0 && (
                <span className="ob-activity-line">
                  💬 {previewTopicCount} conversation{previewTopicCount === 1 ? '' : 's'} active
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
                {previewTopics.map(t => (
                  <div key={t.id} className="ob-event-row ob-topic-row">
                    <span className="ob-event-title">💬 {t.title}</span>
                    {(t.message_count ?? 0) > 0 && (
                      <span className="ob-event-time">{t.message_count} {t.message_count === 1 ? 'reply' : 'replies'}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : noGeo ? (
          <p className="ob-geo-headline">Pick a city<br />and jump in</p>
        ) : (
          <span className="ob-locating">› locating your city...</span>
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
            <button type="submit" className="ob-btn">Browse cities →</button>
            <label className="ob-label" style={{ marginTop: 4 }}>Your name</label>
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
                placeholder="Say hi as..."
              />
            </div>
            {typeof navigator !== 'undefined' && navigator.geolocation && (
              <button type="button" className="ob-geo-retry" onClick={retryGeo}>
                {geoState === 'error' ? 'Try again' : 'Use my location instead'}
              </button>
            )}
          </>
        ) : (
          <>
            <label className="ob-label">Your name</label>
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
                placeholder="Say hi as..."
              />
            </div>
            <button type="submit" className="ob-btn">
              {city ? `Join ${city}` : 'Join Chat'} →
            </button>
          </>
        )}
        <p className="ob-hint">// anonymous · instant access</p>
      </form>

      {/* Auth section */}
      <div className="jc-auth">
        <div className="jc-auth-divider">
          <span className="jc-auth-divider-text">or keep your identity</span>
        </div>
        <div className="jc-auth-actions">
          <button className="jc-auth-signup" onClick={onSignUp}>
            ✨ Create account
          </button>
          <button className="jc-auth-signin" onClick={onSignIn}>
            Log in
          </button>
        </div>
        <p className="jc-auth-hint">Save your name · unlock profiles · add friends</p>
      </div>
    </div>
  )
}

// ── Store badge button ─────────────────────────────────────────────────────────

function StoreBadge({ icon, top, bottom }) {
  return (
    <button className="lp-store-btn" disabled title="Coming soon">
      <span className="lp-store-icon">{icon}</span>
      <span className="lp-store-label">
        <span className="lp-store-top">{top}</span>
        <strong className="lp-store-bottom">{bottom}</strong>
      </span>
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

  return (
    <div className="lp">

      {/* ── 1. HERO ─────────────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-brand">
          <Logo variant="wordmark" size="lg" />
        </div>

        <h1 className="lp-hero-h1">
          Stop scrolling<br />Join the vibe
        </h1>

        <p className="lp-hero-sub">
          See who's around and what's happening in your city right now.
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
          <StoreBadge icon="🍎" top="Download on the" bottom="App Store" />
          <StoreBadge icon="▶" top="Get it on" bottom="Google Play" />
        </div>

        <div className="lp-scroll-hint" aria-hidden="true">↓</div>
      </section>

      {/* ── 2. HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="lp-section lp-how">
        <p className="lp-section-eyebrow">How it works</p>
        <h2 className="lp-section-title">Three seconds to feel the energy.</h2>

        <div className="lp-steps">
          {HOW_IT_WORKS.map(s => (
            <div key={s.num} className="lp-step">
              <span className="lp-step-icon">{s.icon}</span>
              <span className="lp-step-num">{s.num}</span>
              <h3 className="lp-step-title">{s.title}</h3>
              <p className="lp-step-desc">{s.desc}</p>
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
            <span className="lp-stat-label">people live now</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">20+</span>
            <span className="lp-stat-label">cities</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">500+</span>
            <span className="lp-stat-label">events created</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-value">0</span>
            <span className="lp-stat-label">sign-ups needed</span>
          </div>
        </div>
      </section>

      {/* ── 4. CONCEPT ──────────────────────────────────────────────────────── */}
      <section className="lp-section lp-concept">
        <div className="lp-concept-inner">
          <h2 className="lp-concept-h2">
            Cities are alive.<br />We just show you where.
          </h2>
          <div className="lp-concept-rules">
            <p>Not a social network.</p>
            <p>No followers. No feeds. No algorithms.</p>
            <p>Real people, in real cities, right now.</p>
          </div>
        </div>
      </section>

      {/* ── 5. DOWNLOAD ─────────────────────────────────────────────────────── */}
      <section className="lp-section lp-download">
        <p className="lp-section-eyebrow">Mobile apps</p>
        <h2 className="lp-section-title">Take the vibe everywhere.</h2>
        <p className="lp-download-sub">Native apps coming soon.</p>
        <div className="lp-store-badges">
          <StoreBadge icon="🍎" top="Download on the" bottom="App Store" />
          <StoreBadge icon="▶" top="Get it on" bottom="Google Play" />
        </div>
      </section>

      {/* ── 6. REPEAT CTA ───────────────────────────────────────────────────── */}
      <section className="lp-section lp-cta">
        <p className="lp-section-eyebrow">Jump in</p>
        <h2 className="lp-section-title">
          {city ? `${city} is live right now.` : 'Your city is live right now.'}
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
        <span className="lp-footer-tagline">Stop scrolling Join the vibe</span>
      </footer>

    </div>
  )
}
