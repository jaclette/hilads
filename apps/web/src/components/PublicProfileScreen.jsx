import { useState, useEffect } from 'react'
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, addFriend, removeFriend, fetchUserVibes, postVibe } from '../api'
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

export default function PublicProfileScreen({ userId, cityName, cityCountry, account, onBack, onSendDm, onViewProfile }) {
  const [user,       setUser]       = useState(null)
  const [events,     setEvents]     = useState([])
  const [friends,    setFriends]    = useState([])
  const [error,      setError]      = useState(null)
  const [dmBusy,       setDmBusy]       = useState(false)
  const [isFriend,     setIsFriend]     = useState(false)
  const [friendBusy,   setFriendBusy]   = useState(false)
  const [vibes,        setVibes]        = useState([])
  const [vibeScore,    setVibeScore]    = useState(null)
  const [vibeCount,    setVibeCount]    = useState(0)
  const [myVibe,       setMyVibe]       = useState(null)
  const [vibeBusy,     setVibeBusy]     = useState(false)
  const [vibeRating,   setVibeRating]   = useState(0)
  const [vibeMessage,  setVibeMessage]  = useState('')
  const [showVibeForm, setShowVibeForm] = useState(false)

  useEffect(() => {
    setUser(null)
    setEvents([])
    setFriends([])
    setError(null)
    setIsFriend(false)
    setVibes([])
    setVibeScore(null)
    setVibeCount(0)
    setMyVibe(null)
    setVibeRating(0)
    setVibeMessage('')
    setShowVibeForm(false)

    fetchPublicProfile(userId)
      .then(data => { setUser(data.user); setIsFriend(data.user?.isFriend ?? false) })
      .catch(() => setError('Could not load profile.'))

    fetchUserEvents(userId)
      .then(data => setEvents(data.events ?? []))
      .catch(() => {})

    fetchUserFriends(userId)
      .then(data => setFriends(data.friends ?? []))
      .catch(() => {})

    fetchUserVibes(userId)
      .then(data => {
        setVibes(data.vibes ?? [])
        setVibeScore(data.score)
        setVibeCount(data.count ?? 0)
        setMyVibe(data.myVibe ?? null)
        if (data.myVibe) {
          setVibeRating(data.myVibe.rating)
          setVibeMessage(data.myVibe.message ?? '')
        }
      })
      .catch(() => {})
  }, [userId])

  async function handleSendDm() {
    if (!onSendDm || dmBusy) return
    setDmBusy(true)
    try { await onSendDm(userId) } finally { setDmBusy(false) }
  }

  async function handleFriendToggle() {
    if (!account || friendBusy) return
    setFriendBusy(true)
    try {
      if (isFriend) {
        await removeFriend(userId)
        setIsFriend(false)
      } else {
        await addFriend(userId)
        setIsFriend(true)
      }
    } catch { /* ignore */ }
    finally { setFriendBusy(false) }
  }

  async function handleSubmitVibe() {
    if (vibeBusy || vibeRating === 0) return
    setVibeBusy(true)
    try {
      await postVibe(userId, { rating: vibeRating, message: vibeMessage.trim() || undefined })
      const fresh = await fetchUserVibes(userId)
      setVibes(fresh.vibes ?? [])
      setVibeScore(fresh.score)
      setVibeCount(fresh.count ?? 0)
      setMyVibe(fresh.myVibe ?? null)
      setShowVibeForm(false)
    } catch { /* ignore */ }
    finally { setVibeBusy(false) }
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

            {/* ── Friends ── */}
            {friends.length > 0 && (
              <div className="pub-profile-friends">
                <p className="pub-profile-section-label">Friends · {friends.length}</p>
                {friends.map(f => {
                  const [fc1, fc2] = avatarColors(f.display_name || '?')
                  return (
                    <div
                      key={f.id}
                      className="pub-profile-friend-row"
                      onClick={() => onViewProfile ? onViewProfile(f.id, f.display_name) : undefined}
                      style={{ cursor: onViewProfile ? 'pointer' : 'default' }}
                    >
                      {f.profile_photo_url
                        ? <img className="pub-profile-friend-avatar" src={f.profile_photo_url} alt={f.display_name} />
                        : <span className="pub-profile-friend-avatar pub-profile-friend-avatar--initials" style={{ background: `linear-gradient(135deg, ${fc1}, ${fc2})` }}>
                            {(f.display_name || '?')[0].toUpperCase()}
                          </span>
                      }
                      <div className="pub-profile-friend-info">
                        <span className="pub-profile-friend-name">{f.display_name}</span>
                        {f.primaryBadge && (
                          <span className="pub-profile-friend-badge">{f.primaryBadge.label}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Vibe score ── */}
            {vibeCount > 0 && (
              <div className="pub-profile-vibe-score">
                <div className="pub-profile-vibe-stars">
                  {[1,2,3,4,5].map(s => (
                    <span key={s} className={s <= Math.round(vibeScore) ? 'vibe-star vibe-star--on' : 'vibe-star'}>★</span>
                  ))}
                </div>
                <span className="pub-profile-vibe-avg">{vibeScore?.toFixed(1)} vibe score</span>
                <span className="pub-profile-vibe-count">based on {vibeCount} vibe{vibeCount !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* ── Leave a vibe form ── */}
            {account && userId !== account?.id && (
              <div className="pub-profile-vibe-cta">
                {!showVibeForm ? (
                  <button className="pub-profile-vibe-btn" onClick={() => setShowVibeForm(true)}>
                    {myVibe ? `✏️ Update your vibe (${myVibe.rating}★)` : '⭐ Leave a vibe'}
                  </button>
                ) : (
                  <div className="pub-profile-vibe-form">
                    <div className="pub-profile-vibe-form-stars">
                      {[1,2,3,4,5].map(s => (
                        <button key={s} className={`vibe-star-btn${vibeRating >= s ? ' on' : ''}`} onClick={() => setVibeRating(s)}>★</button>
                      ))}
                    </div>
                    <textarea
                      className="pub-profile-vibe-input"
                      placeholder="Say something nice… (optional)"
                      value={vibeMessage}
                      onChange={e => setVibeMessage(e.target.value)}
                      maxLength={300}
                      rows={2}
                    />
                    <div className="pub-profile-vibe-form-actions">
                      <button className="pub-profile-vibe-cancel" onClick={() => { setShowVibeForm(false); setVibeRating(myVibe?.rating ?? 0); setVibeMessage(myVibe?.message ?? ''); }}>Cancel</button>
                      <button className="pub-profile-vibe-submit" onClick={handleSubmitVibe} disabled={vibeBusy || vibeRating === 0}>
                        {vibeBusy ? 'Sending…' : 'Send vibe ✨'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Vibes list ── */}
            <div className="pub-profile-vibes">
              {vibes.length > 0 ? (
                <>
                  <p className="pub-profile-section-label">Vibes · {vibeCount}</p>
                  {vibes.map(v => {
                    const [vc1, vc2] = avatarColors(v.authorName || '?')
                    return (
                      <div key={v.id} className="pub-profile-vibe-row">
                        {v.authorPhoto
                          ? <img className="pub-profile-vibe-avatar" src={v.authorPhoto} alt={v.authorName} />
                          : <span className="pub-profile-vibe-avatar pub-profile-vibe-avatar--initials" style={{ background: `linear-gradient(135deg, ${vc1}, ${vc2})` }}>
                              {(v.authorName || '?')[0].toUpperCase()}
                            </span>
                        }
                        <div className="pub-profile-vibe-content">
                          <div className="pub-profile-vibe-header">
                            <span className="pub-profile-vibe-author">{v.authorName}</span>
                            <span className="pub-profile-vibe-rating">{'★'.repeat(v.rating)}</span>
                          </div>
                          {v.message && <p className="pub-profile-vibe-msg">{v.message}</p>}
                        </div>
                      </div>
                    )
                  })}
                </>
              ) : vibeCount === 0 && (
                <div className="pub-profile-vibes-empty">
                  <p>No vibes yet</p>
                  <p>Be the first to leave a vibe ✨</p>
                </div>
              )}
            </div>

            {/* ── CTAs ── */}
            {userId !== account?.id && (
              <div className="pub-profile-cta">
                {account && (
                  <button
                    className={`pub-profile-friend-btn${isFriend ? ' pub-profile-friend-btn--active' : ''}`}
                    onClick={handleFriendToggle}
                    disabled={friendBusy}
                  >
                    {isFriend ? '✓ Friend' : '+ Add friend'}
                  </button>
                )}
                {onSendDm && (
                  <button
                    className="pub-profile-dm-btn"
                    onClick={handleSendDm}
                    disabled={dmBusy}
                  >
                    {dmBusy ? 'Opening…' : '💬 Message'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
