import { useState, useEffect } from 'react'
import { fetchPublicProfile, fetchUserEvents } from '../api'
import { cityFlag } from '../cityMeta'
import BackButton from './BackButton'

// ── Avatar palette — mirrors App.jsx / DirectMessageScreen ────────────────────

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── Badge microcopy — short, playful, 1-line ──────────────────────────────────

const BADGE_MICROCOPY = {
  ghost: 'Just browsing 👀',
  fresh: 'Just landed 👶',
  regular: 'Shows up often',
  local: 'Knows the city',
  host:  'Makes it happen 🔥',
}

// ── Vibe display ──────────────────────────────────────────────────────────────

const VIBE_META = {
  party:       { emoji: '🔥', label: 'Party' },
  board_games: { emoji: '🎲', label: 'Board Games' },
  coffee:      { emoji: '☕', label: 'Coffee' },
  music:       { emoji: '🎧', label: 'Music' },
  food:        { emoji: '🍜', label: 'Food' },
  chill:       { emoji: '🧘', label: 'Chill' },
}

// ── Event type icons ──────────────────────────────────────────────────────────

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}

function eventIcon(type) {
  return EVENT_ICONS[type] ?? '📌'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublicProfileScreen({ userId, cityName, cityCountry, account, onBack, onSendDm }) {
  const [user,   setUser]   = useState(null)
  const [events, setEvents] = useState([])
  const [error,  setError]  = useState(null)
  const [dmBusy, setDmBusy] = useState(false)

  useEffect(() => {
    setUser(null)
    setEvents([])
    setError(null)

    fetchPublicProfile(userId)
      .then(data => setUser(data.user))
      .catch(() => setError('Could not load profile.'))

    fetchUserEvents(userId)
      .then(data => setEvents(data.events ?? []))
      .catch(() => { /* events are optional — fail silently */ })
  }, [userId])

  async function handleSendDm() {
    if (!onSendDm || dmBusy) return
    setDmBusy(true)
    try { await onSendDm(userId) } finally { setDmBusy(false) }
  }

  const name     = user?.display_name ?? '?'
  const [c1, c2] = avatarColors(name)
  const badge    = user?.primaryBadge
  const vibe     = user?.vibe && VIBE_META[user.vibe] ? user.vibe : null
  const now      = Date.now() / 1000

  return (
    <div className="full-page pub-profile-page">

      {/* ── Header ── */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Profile</span>
      </div>

      <div className="pub-profile-scroll">
        {error && <p className="profile-error" style={{ margin: '20px 18px' }}>{error}</p>}

        {!user && !error && (
          <p className="pub-profile-loading">Loading…</p>
        )}

        {user && (
          <>
            {/* ── Hero ── */}
            <div className="pub-profile-hero">
              {user.profile_photo_url
                ? <img className="pub-profile-avatar" src={user.profile_photo_url} alt={name} />
                : <span className="pub-profile-avatar pub-profile-avatar--initials" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {name[0].toUpperCase()}
                  </span>
              }

              <h2 className="pub-profile-name">{name}</h2>

              {/* Badge + microcopy */}
              {badge && (
                <div className="pub-profile-badge-block">
                  <span className={`badge-pill badge-pill--${badge.key}`}>{badge.label}</span>
                  {BADGE_MICROCOPY[badge.key] && (
                    <span className="pub-profile-badge-micro">{BADGE_MICROCOPY[badge.key]}</span>
                  )}
                </div>
              )}

              {/* City pill — the channel this profile is being viewed from */}
              {cityName && (
                <div className="pub-profile-city">
                  <span>{cityFlag(cityCountry)} {cityName}</span>
                </div>
              )}
            </div>

            {/* ── Detail rows ── */}
            <div className="pub-profile-details">
              {vibe && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">Vibe</span>
                  <span className="pub-profile-detail-value">
                    {VIBE_META[vibe].emoji} {VIBE_META[vibe].label}
                  </span>
                </div>
              )}
              {user.home_city && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">From</span>
                  <span className="pub-profile-detail-value">{user.home_city}</span>
                </div>
              )}
              {user.age != null && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">Age</span>
                  <span className="pub-profile-detail-value">{user.age}</span>
                </div>
              )}
            </div>

            {/* ── Interests ── */}
            {user.interests?.length > 0 && (
              <div className="pub-profile-interests">
                {user.interests.map(i => (
                  <span key={i} className="interest-chip interest-chip--on interest-chip--readonly">{i}</span>
                ))}
              </div>
            )}

            {/* ── Events ── */}
            {events.length > 0 && (
              <div className="pub-profile-events">
                <p className="pub-profile-section-label">Events</p>
                {events.map(ev => {
                  const isLive = ev.starts_at <= now && ev.expires_at > now
                  return (
                    <div key={ev.id} className="pub-profile-event-row">
                      <span className="pub-profile-event-icon">{eventIcon(ev.event_type)}</span>
                      <div className="pub-profile-event-info">
                        <span className="pub-profile-event-title">{ev.title}</span>
                        {isLive && <span className="pub-profile-event-live">LIVE</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── DM CTA ── */}
            {onSendDm && userId !== account?.id && (
              <div className="pub-profile-cta">
                <button
                  className="pub-profile-dm-btn"
                  onClick={handleSendDm}
                  disabled={dmBusy}
                >
                  {dmBusy ? 'Opening…' : '💬 Send a message'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
