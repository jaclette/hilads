import { useState, useEffect, useRef } from 'react'
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, addFriend, removeFriend, fetchUserVibes, postVibe, submitReport } from '../api'
import { cityFlag } from '../cityMeta'
import { badgeLabel, BADGE_META } from '../badgeMeta'
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
  ghost:   'Just browsing 👀',
  fresh:   'Just landed 👶',
  regular: 'Shows up often',
  host:    'Makes it happen 🔥',
}

// ── Vibe display ──────────────────────────────────────────────────────────────

const MODE_META = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
}

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

export default function PublicProfileScreen({ userId, cityName, cityCountry, account, guest, onBack, onSendDm, onViewProfile, onOpenLightbox }) {
  const [user,       setUser]       = useState(null)
  const [events,     setEvents]     = useState([])
  const [friends,    setFriends]    = useState([])
  const [error,      setError]      = useState(null)
  const [dmBusy,       setDmBusy]       = useState(false)
  const [isFriend,        setIsFriend]        = useState(false)
  const [friendBusy,      setFriendBusy]      = useState(false)
  const [confirmUnfriend, setConfirmUnfriend] = useState(false)
  const [vibes,        setVibes]        = useState([])
  const [vibeScore,    setVibeScore]    = useState(null)
  const [vibeCount,    setVibeCount]    = useState(0)
  const [myVibe,       setMyVibe]       = useState(null)
  const [vibeBusy,     setVibeBusy]     = useState(false)
  const [vibeRating,   setVibeRating]   = useState(0)
  const [vibeMessage,  setVibeMessage]  = useState('')
  const [showVibeForm, setShowVibeForm] = useState(false)
  const [showReportForm,  setShowReportForm]  = useState(false)
  const [reportReason,    setReportReason]    = useState('')
  const [reportBusy,      setReportBusy]      = useState(false)
  const [reportSent,      setReportSent]      = useState(false)
  const [reportError,     setReportError]     = useState(null)

  // vibeCount from the profile response — used to skip fetchUserVibes when 0
  const profileVibeCountRef = useRef(0)

  // Phase 1: profile + events — controls the loading state, needed for first paint
  useEffect(() => {
    setUser(null)
    setEvents([])
    setFriends([])
    setError(null)
    setIsFriend(false)
    setConfirmUnfriend(false)
    setVibes([])
    setVibeScore(null)
    setVibeCount(0)
    setMyVibe(null)
    setVibeRating(0)
    setVibeMessage('')
    setShowVibeForm(false)
    profileVibeCountRef.current = 0

    fetchPublicProfile(userId)
      .then(data => {
        setUser(data.user)
        setIsFriend(data.user?.isFriend ?? false)
        // Seed score/count immediately from profile — vibes request will overwrite with full detail
        const vc = data.user?.vibeCount ?? 0
        profileVibeCountRef.current = vc
        if (data.user?.vibeScore != null) setVibeScore(data.user.vibeScore)
        if (vc != null) setVibeCount(vc)
      })
      .catch(() => setError('Could not load profile.'))

    fetchUserEvents(userId)
      .then(data => setEvents(data.events ?? []))
      .catch(() => {})
  }, [userId])

  // Phase 2: secondary data — fires after profile renders (user is non-null).
  // Friends and vibes detail are below-fold and not needed for first paint.
  // vibeCount === 0 from profile → skip fetchUserVibes entirely (no detail to show).
  useEffect(() => {
    if (!user) return // wait for phase 1 to complete
    const id = userId

    fetchUserFriends(id)
      .then(data => { if (userId === id) setFriends(data.friends ?? []) })
      .catch(() => {})

    if (profileVibeCountRef.current > 0) {
      fetchUserVibes(id)
        .then(data => {
          if (userId !== id) return
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
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSendDm() {
    if (!onSendDm || dmBusy) return
    setDmBusy(true)
    try { await onSendDm(userId) } finally { setDmBusy(false) }
  }

  async function handleFriendToggle() {
    if (!account || friendBusy) return
    if (isFriend && !confirmUnfriend) {
      setConfirmUnfriend(true)
      return
    }
    setFriendBusy(true)
    try {
      if (isFriend) {
        await removeFriend(userId)
        setIsFriend(false)
        setConfirmUnfriend(false)
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

  async function handleSubmitReport(e) {
    e.preventDefault()
    const reason = reportReason.trim()
    if (reason.length < 10 || reportBusy) return
    setReportBusy(true)
    setReportError(null)
    try {
      await submitReport({
        reason,
        guestId:         account ? undefined : guest?.guestId,
        targetUserId:    userId,
        targetNickname:  user?.displayName,
      })
      setReportSent(true)
      setReportReason('')
      setTimeout(() => { setShowReportForm(false); setReportSent(false) }, 2500)
    } catch (err) {
      setReportError(err?.message ?? 'Could not send report. Try again.')
    } finally {
      setReportBusy(false)
    }
  }

  const name     = user?.displayName ?? '?'
  const [c1, c2] = avatarColors(name)
  const vibe     = user?.vibe && VIBE_META[user.vibe] ? user.vibe : null
  const mode     = user?.mode && MODE_META[user.mode] ? user.mode : null
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
              {user.avatarUrl
                ? <img
                    className="pub-profile-avatar"
                    src={user.avatarUrl}
                    alt={name}
                    onClick={() => onOpenLightbox && onOpenLightbox(user.avatarUrl)}
                  />
                : <span className="pub-profile-avatar pub-profile-avatar--initials" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {name[0].toUpperCase()}
                  </span>
              }

              <h2 className="pub-profile-name">{name}</h2>

              {/* Badges + microcopy */}
              {(user.badges ?? []).map(k => (
                <div key={k} className="pub-profile-badge-block">
                  <span className={`badge-pill badge-pill--${k}`}>{badgeLabel(k)}</span>
                  {BADGE_MICROCOPY[k] && (
                    <span className="pub-profile-badge-micro">{BADGE_MICROCOPY[k]}</span>
                  )}
                </div>
              ))}

              {/* City pill — the channel this profile is being viewed from */}
              {cityName && (
                <div className="pub-profile-city">
                  <span>{cityFlag(cityCountry)} {cityName}</span>
                </div>
              )}
            </div>

            {/* ── Detail rows ── */}
            <div className="pub-profile-details">
              {mode && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">Here as</span>
                  <span className="pub-profile-detail-value">
                    {MODE_META[mode].emoji}{' '}
                    {mode === 'local'
                      ? `Local${user.homeCity ? ` in ${user.homeCity}` : ''}`
                      : `Exploring${cityName ? ` ${cityName}` : ''}`}
                  </span>
                </div>
              )}
              {vibe && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">Vibe</span>
                  <span className="pub-profile-detail-value">
                    {VIBE_META[vibe].emoji} {VIBE_META[vibe].label}
                  </span>
                </div>
              )}
              {user.homeCity && (
                <div className="pub-profile-detail-row">
                  <span className="pub-profile-detail-label">From</span>
                  <span className="pub-profile-detail-value">{user.homeCity}</span>
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

            {/* ── Ambassador city picks ── */}
            {user.ambassadorPicks && Object.keys(user.ambassadorPicks).length > 0 && (
              <div className="pub-profile-picks">
                <p className="pub-profile-section-label">City picks 👑</p>
                {user.ambassadorPicks.restaurant && (
                  <div className="pub-profile-pick-row">
                    <span className="pub-profile-pick-icon">🍜</span>
                    <div className="pub-profile-pick-body">
                      <span className="pub-profile-pick-label">Favorite restaurant</span>
                      <span className="pub-profile-pick-value">{user.ambassadorPicks.restaurant}</span>
                    </div>
                  </div>
                )}
                {user.ambassadorPicks.spot && (
                  <div className="pub-profile-pick-row">
                    <span className="pub-profile-pick-icon">🗺️</span>
                    <div className="pub-profile-pick-body">
                      <span className="pub-profile-pick-label">Best spot</span>
                      <span className="pub-profile-pick-value">{user.ambassadorPicks.spot}</span>
                    </div>
                  </div>
                )}
                {user.ambassadorPicks.tip && (
                  <div className="pub-profile-pick-row">
                    <span className="pub-profile-pick-icon">💡</span>
                    <div className="pub-profile-pick-body">
                      <span className="pub-profile-pick-label">Pro tip</span>
                      <span className="pub-profile-pick-value">{user.ambassadorPicks.tip}</span>
                    </div>
                  </div>
                )}
                {user.ambassadorPicks.story && (
                  <div className="pub-profile-pick-row">
                    <span className="pub-profile-pick-icon">🎭</span>
                    <div className="pub-profile-pick-body">
                      <span className="pub-profile-pick-label">Story</span>
                      <span className="pub-profile-pick-value">{user.ambassadorPicks.story}</span>
                    </div>
                  </div>
                )}
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
                  const [fc1, fc2] = avatarColors(f.displayName || '?')
                  return (
                    <div
                      key={f.id}
                      className="pub-profile-friend-row"
                      onClick={() => onViewProfile ? onViewProfile(f.id, f.displayName) : undefined}
                      style={{ cursor: onViewProfile ? 'pointer' : 'default' }}
                    >
                      {f.avatarUrl
                        ? <img className="pub-profile-friend-avatar" src={f.avatarUrl} alt={f.displayName} />
                        : <span className="pub-profile-friend-avatar pub-profile-friend-avatar--initials" style={{ background: `linear-gradient(135deg, ${fc1}, ${fc2})` }}>
                            {(f.displayName || '?')[0].toUpperCase()}
                          </span>
                      }
                      <div className="pub-profile-friend-info">
                        <span className="pub-profile-friend-name">{f.displayName}</span>
                        {f.badges?.[0] && (
                          <span className="pub-profile-friend-badge">{badgeLabel(f.badges[0])}</span>
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
                    {myVibe ? `✏️ Update your note (${myVibe.rating}★)` : '⭐ Leave a note'}
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
                        {vibeBusy ? 'Sending…' : 'Send note ✨'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Vibes list ── (scrollable — CTAs are in sticky bar below) */}
            <div className="pub-profile-vibes">
              {vibes.length > 0 ? (
                <>
                  <p className="pub-profile-section-label">Notes · {vibeCount}</p>
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
                  <p>No notes yet</p>
                  <p>Be the first to leave a note ✨</p>
                </div>
              )}
            </div>

          </>
        )}
      </div>

      {/* ── Sticky action bar ── */}
      {user && userId !== account?.id && (
        <div className="pub-profile-sticky-bar">
          {onSendDm && (
            <button
              className="pub-profile-dm-btn"
              onClick={handleSendDm}
              disabled={dmBusy}
            >
              {dmBusy ? 'Opening…' : '💬 Message'}
            </button>
          )}
          {account && !confirmUnfriend && (
            <button
              className={`pub-profile-friend-btn${isFriend ? ' pub-profile-friend-btn--active' : ''}`}
              onClick={handleFriendToggle}
              disabled={friendBusy}
            >
              {friendBusy ? '…' : isFriend ? '✓ Friend' : '+ Friend'}
            </button>
          )}
          {account && confirmUnfriend && (
            <div className="pub-profile-unfriend-confirm">
              <button
                className="pub-profile-unfriend-btn"
                onClick={handleFriendToggle}
                disabled={friendBusy}
              >
                {friendBusy ? 'Removing…' : 'Unfriend'}
              </button>
              <button
                className="pub-profile-unfriend-cancel"
                onClick={() => setConfirmUnfriend(false)}
                disabled={friendBusy}
              >
                Cancel
              </button>
            </div>
          )}
          <button
            className="pub-profile-report-btn"
            onClick={() => { setShowReportForm(f => !f); setReportSent(false); setReportError(null) }}
            title="Report user"
          >
            🚩
          </button>
        </div>
      )}

      {/* ── Inline report form ── */}
      {user && userId !== account?.id && showReportForm && (
        <div className="pub-profile-report-form-wrap">
          {reportSent ? (
            <p className="pub-profile-report-sent">Report sent. Thanks for letting us know.</p>
          ) : (
            <form className="pub-profile-report-form" onSubmit={handleSubmitReport}>
              <textarea
                className="pub-profile-report-textarea"
                placeholder="Describe the issue (min 10 characters)…"
                value={reportReason}
                onChange={e => setReportReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={reportBusy}
              />
              {reportError && <p className="pub-profile-report-error">{reportError}</p>}
              <div className="pub-profile-report-actions">
                <button
                  type="submit"
                  className="pub-profile-report-submit"
                  disabled={reportReason.trim().length < 10 || reportBusy}
                >
                  {reportBusy ? 'Sending…' : 'Send report'}
                </button>
                <button
                  type="button"
                  className="pub-profile-report-cancel"
                  onClick={() => setShowReportForm(false)}
                  disabled={reportBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
