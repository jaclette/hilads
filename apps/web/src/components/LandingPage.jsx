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
    icon: '📍',
    num: '01',
    title: 'Open the app',
    desc: 'See your city live — who\'s around, what\'s happening right now.',
  },
  {
    icon: '🎯',
    num: '02',
    title: 'Choose your mode',
    desc: 'Local — you know the city.\nExploring — you want to feel it.',
  },
  {
    icon: '✨',
    num: '03',
    title: 'Join or host',
    desc: 'Jump into a hangout or open your own spot. Real life starts here.',
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
                  🔥 {previewEventCount} event{previewEventCount === 1 ? '' : 's'} happening
                </span>
              )}
              {previewTopicCount > 0 && (
                <span className="ob-activity-line">
                  💬 {previewTopicCount} pulse{previewTopicCount === 1 ? '' : 's'} active
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

function ExploringMockup() {
  return (
    <PhoneFrame>
      <div className="lp-app-header lp-app-header--explore">
        <span className="lp-app-city">🔥 Now — Barcelona 🇪🇸</span>
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
          Feel local.<br />Anywhere.
        </h1>

        <p className="lp-hero-sub">
          Meet people around you. Join what's happening now — or open your own spot.
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

      {/* ── 2. SPLIT — Local vs Exploring ───────────────────────────────────── */}
      <section className="lp-split-section">

        {/* Local — text left, phone right */}
        <div className="lp-split-row lp-split-row--local">
          <div className="lp-split-text">
            <div className="lp-split-badge">🌍 Local</div>
            <h2 className="lp-split-title">Open your city</h2>
            <p className="lp-split-tagline">Your city is yours to shape.</p>
            <ul className="lp-split-bullets">
              <li>Host recurring hangouts at bars, cafes, chill spots</li>
              <li>Bring people to places you love</li>
              <li>Become the one who makes things happen</li>
            </ul>
            <button className="lp-split-cta lp-split-cta--local" onClick={scrollToJoin}>
              Host your spot
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
            <div className="lp-split-badge lp-split-badge--exploring">🧭 Exploring</div>
            <h2 className="lp-split-title">Feel local instantly</h2>
            <p className="lp-split-tagline">Wherever you land, find your people.</p>
            <ul className="lp-split-bullets lp-split-bullets--exploring">
              <li>Discover real-time hangouts</li>
              <li>Meet locals and other explorers</li>
              <li>Skip tourist traps — go where the city actually lives</li>
            </ul>
            <button className="lp-split-cta lp-split-cta--exploring" onClick={scrollToJoin}>
              See what's happening
            </button>
          </div>
        </div>

      </section>

      {/* ── 3. HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="lp-section lp-how">
        <p className="lp-section-eyebrow">How it works</p>
        <h2 className="lp-section-title">Three steps to feel the city.</h2>

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

      {/* ── 5. CONCEPT ──────────────────────────────────────────────────────── */}
      <section className="lp-section lp-concept">
        <div className="lp-concept-inner">
          <h2 className="lp-concept-h2">
            Not a social network.<br />A city, live.
          </h2>
          <div className="lp-concept-rules">
            <p>No followers. No feeds. No algorithms.</p>
            <p>See who's around. Join what's happening.</p>
            <p>Real people. Real places. Right now.</p>
          </div>
        </div>
      </section>

      {/* ── 6. DOWNLOAD ─────────────────────────────────────────────────────── */}
      <section className="lp-section lp-download">
        <p className="lp-section-eyebrow">Mobile apps</p>
        <h2 className="lp-section-title">Your city in your pocket.</h2>
        <p className="lp-download-sub">Native apps coming soon.</p>
        <div className="lp-store-badges">
          <StoreBadge icon="🍎" top="Download on the" bottom="App Store" />
          <StoreBadge icon="▶" top="Get it on" bottom="Google Play" />
        </div>
      </section>

      {/* ── 7. REPEAT CTA ───────────────────────────────────────────────────── */}
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
        <span className="lp-footer-tagline">Feel local. Anywhere.</span>
      </footer>

    </div>
  )
}
