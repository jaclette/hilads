import { useState, useEffect, useRef } from 'react'
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, addFriend, removeFriend, fetchUserVibes, postVibe, submitReport } from '../api'
import { cityFlag } from '../cityMeta'
import { badgeLabel } from '../badgeMeta'
import BackButton from './BackButton'

// ── Avatar palette ────────────────────────────────────────────────────────────

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BADGE_MICROCOPY = {
  ghost:   'Just browsing 👀',
  fresh:   'Just landed 👶',
  regular: 'Shows up often',
  host:    'Makes it happen 🔥',
}

const MODE_META = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
}

const VIBE_META = {
  party:       { emoji: '🔥', label: 'Party'       },
  board_games: { emoji: '🎲', label: 'Board Games' },
  coffee:      { emoji: '☕', label: 'Coffee'       },
  music:       { emoji: '🎧', label: 'Music'        },
  food:        { emoji: '🍜', label: 'Food'         },
  chill:       { emoji: '🧘', label: 'Chill'        },
}

const VIBE_TAGLINES = {
  party:       'Here for the night life',
  board_games: 'Bring snacks and dice',
  coffee:      'Coffee first, everything else later',
  music:       'Always chasing a good beat',
  food:        'Eats first, questions later',
  chill:       'Low key, high vibes',
}

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}

function eventIcon(type) { return EVENT_ICONS[type] ?? '📌' }

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
  const [activeTab, setActiveTab] = useState('events')

  const profileVibeCountRef = useRef(0)

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
    setActiveTab('events')
    profileVibeCountRef.current = 0

    fetchPublicProfile(userId)
      .then(data => {
        setUser(data.user)
        setIsFriend(data.user?.isFriend ?? false)
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

  useEffect(() => {
    if (!user) return
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
    if (isFriend && !confirmUnfriend) { setConfirmUnfriend(true); return }
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
        guestId:        account ? undefined : guest?.guestId,
        targetUserId:   userId,
        targetNickname: user?.displayName,
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

  // Legend = user has ambassador picks
  const hasPicks = !!(user?.ambassadorPicks && Object.keys(user.ambassadorPicks).length > 0)

  const tabs = [
    { key: 'events',  label: 'Events'       },
    { key: 'friends', label: 'Friends'      },
    { key: 'vibes',   label: 'Vibes'        },
    ...(hasPicks ? [{ key: 'picks', label: 'City Picks 👑' }] : []),
  ]

  return (
    <div className="full-page pub-profile-page">

      {/* ── Header ── */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Profile</span>
      </div>

      {/* ── Loading / Error ── */}
      {!user && !error && <p className="pub-profile-loading">Loading…</p>}
      {error && <p className="pub-profile-error-inline">{error}</p>}

      {user && (
        <>
          {/* ── Sticky identity section ── */}
          <div className="pub-profile-sticky-identity">

            {/* Hero: avatar + name + badge + city */}
            <div className="pub-profile-hero">
              {user.avatarUrl
                ? <img
                    className="pub-profile-avatar"
                    src={user.thumbAvatarUrl ?? user.avatarUrl}
                    alt={name}
                    onClick={() => onOpenLightbox && onOpenLightbox(user.avatarUrl)}
                  />
                : <span
                    className="pub-profile-avatar pub-profile-avatar--initials"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    {name[0].toUpperCase()}
                  </span>
              }
              <h2 className="pub-profile-name">{name}</h2>
              {(user.badges ?? []).map(k => (
                <div key={k} className="pub-profile-badge-block">
                  <span className={`badge-pill badge-pill--${k}`}>{badgeLabel(k)}</span>
                  {BADGE_MICROCOPY[k] && <span className="pub-profile-badge-micro">{BADGE_MICROCOPY[k]}</span>}
                </div>
              ))}
              {cityName && (
                <div className="pub-profile-city">
                  <span>{cityFlag(cityCountry)} {cityName}</span>
                </div>
              )}

              {/* About me */}
              {user.aboutMe && (
                <p className="pub-profile-about">{user.aboutMe}</p>
              )}
            </div>

            {/* Identity cards: vibe + mode */}
            {(vibe || mode) && (
              <div className="pub-profile-identity-cards">
                {vibe && (
                  <div className="pub-profile-identity-card">
                    <span className="pub-profile-identity-card-icon">{VIBE_META[vibe].emoji}</span>
                    <span className="pub-profile-identity-card-title">{VIBE_META[vibe].label}</span>
                    <span className="pub-profile-identity-card-sub">{VIBE_TAGLINES[vibe]}</span>
                  </div>
                )}
                {mode && (
                  <div className="pub-profile-identity-card">
                    <span className="pub-profile-identity-card-icon">{MODE_META[mode].emoji}</span>
                    <span className="pub-profile-identity-card-title">{MODE_META[mode].label}</span>
                    <span className="pub-profile-identity-card-sub">
                      {mode === 'local'
                        ? `Local${user.homeCity ? ` in ${user.homeCity}` : cityName ? ` in ${cityName}` : ''}`
                        : `Exploring${cityName ? ` ${cityName}` : ''}`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Info rows: From + Age */}
            {(user.homeCity || user.age != null) && (
              <div className="pub-profile-info-rows">
                {user.homeCity && (
                  <div className="pub-profile-info-row">
                    <span className="pub-profile-info-label">From</span>
                    <span className="pub-profile-info-value">{user.homeCity}</span>
                  </div>
                )}
                {user.age != null && (
                  <div className="pub-profile-info-row">
                    <span className="pub-profile-info-label">Age</span>
                    <span className="pub-profile-info-value">{user.age}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab bar */}
            <div className="profile-tabs pub-profile-tabs-bar">
              {tabs.map(t => (
                <button
                  key={t.key}
                  className={`profile-tab-pill${activeTab === t.key ? ' profile-tab-pill--active' : ''}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab content ── */}
          <div className="pub-profile-body">

            {/* Events tab */}
            {activeTab === 'events' && (
              <div className="pub-profile-events">
                {events.length === 0
                  ? <p className="pub-profile-tab-empty">No events yet</p>
                  : events.map(ev => {
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
                    })
                }
              </div>
            )}

            {/* Friends tab */}
            {activeTab === 'friends' && (
              <div className="pub-profile-friends">
                {friends.length === 0
                  ? <p className="pub-profile-tab-empty">No friends yet</p>
                  : friends.map(f => {
                      const [fc1, fc2] = avatarColors(f.displayName || '?')
                      return (
                        <div
                          key={f.id}
                          className="pub-profile-friend-row"
                          onClick={() => onViewProfile ? onViewProfile(f.id, f.displayName) : undefined}
                          style={{ cursor: onViewProfile ? 'pointer' : 'default' }}
                        >
                          {f.avatarUrl
                            ? <img className="pub-profile-friend-avatar" src={f.thumbAvatarUrl ?? f.avatarUrl} alt={f.displayName} />
                            : <span
                                className="pub-profile-friend-avatar pub-profile-friend-avatar--initials"
                                style={{ background: `linear-gradient(135deg, ${fc1}, ${fc2})` }}
                              >
                                {(f.displayName || '?')[0].toUpperCase()}
                              </span>
                          }
                          <div className="pub-profile-friend-info">
                            <span className="pub-profile-friend-name">{f.displayName}</span>
                            {f.badges?.[0] && <span className="pub-profile-friend-badge">{badgeLabel(f.badges[0])}</span>}
                          </div>
                        </div>
                      )
                    })
                }
              </div>
            )}

            {/* Vibes tab */}
            {activeTab === 'vibes' && (
              <>
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
                          <button className="pub-profile-vibe-cancel" onClick={() => { setShowVibeForm(false); setVibeRating(myVibe?.rating ?? 0); setVibeMessage(myVibe?.message ?? '') }}>Cancel</button>
                          <button className="pub-profile-vibe-submit" onClick={handleSubmitVibe} disabled={vibeBusy || vibeRating === 0}>
                            {vibeBusy ? 'Sending…' : 'Send note ✨'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                              : <span
                                  className="pub-profile-vibe-avatar pub-profile-vibe-avatar--initials"
                                  style={{ background: `linear-gradient(135deg, ${vc1}, ${vc2})` }}
                                >
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
                  ) : (
                    <div className="pub-profile-vibes-empty">
                      <p>No notes yet</p>
                      <p>Be the first to leave a note ✨</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* City Picks tab — legend only */}
            {activeTab === 'picks' && hasPicks && (
              <div className="pub-profile-picks">
                {user.ambassadorPicks.restaurant && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">FAVORITE RESTAURANT</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.restaurant}</span>
                  </div>
                )}
                {user.ambassadorPicks.spot && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">HIDDEN GEM</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.spot}</span>
                  </div>
                )}
                {user.ambassadorPicks.tip && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">LOCAL TIP</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.tip}</span>
                  </div>
                )}
                {user.ambassadorPicks.story && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">STORY</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.story}</span>
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}

      {/* ── Sticky action bar ── */}
      {user && userId !== account?.id && (
        <div className="pub-profile-sticky-bar">
          {onSendDm && (
            <button className="pub-profile-dm-btn" onClick={handleSendDm} disabled={dmBusy}>
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
              <button className="pub-profile-unfriend-btn" onClick={handleFriendToggle} disabled={friendBusy}>
                {friendBusy ? 'Removing…' : 'Unfriend'}
              </button>
              <button className="pub-profile-unfriend-cancel" onClick={() => setConfirmUnfriend(false)} disabled={friendBusy}>
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
                <button type="submit" className="pub-profile-report-submit" disabled={reportReason.trim().length < 10 || reportBusy}>
                  {reportBusy ? 'Sending…' : 'Send report'}
                </button>
                <button type="button" className="pub-profile-report-cancel" onClick={() => setShowReportForm(false)} disabled={reportBusy}>
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
