import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { localizeCityName } from '../i18n/cityName'
import { fetchPublicProfile, fetchUserEvents, fetchUserHangouts, fetchUserChallenges, fetchUserFriends, sendFriendRequest, acceptFriendRequest, cancelFriendRequest, removeFriend, fetchUserVibes, postVibe, submitReport, fetchReportStatus, DuplicateReportError } from '../api'

const HANGOUT_ICONS = { general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }
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

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}

function eventIcon(type) { return EVENT_ICONS[type] ?? '📌' }

// ── Component ─────────────────────────────────────────────────────────────────

// Type emoji for challenge cards — mirrors the rest of the app.
const CHALLENGE_TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }

export default function PublicProfileScreen({ userId, cityName, cityCountry, account, guest, onBack, onSendDm, onViewProfile, onOpenLightbox, onOpenHangout, onOpenChallenge }) {
  const { t } = useTranslation('publicProfile')
  const [user,       setUser]       = useState(null)
  const [events,     setEvents]     = useState([])
  const [hangouts,   setHangouts]   = useState([])
  const [challenges,      setChallenges]      = useState([])
  const [challengeSubTab, setChallengeSubTab] = useState('all') // 'all' | 'local' | 'international'
  const [friends,    setFriends]    = useState([])
  const [error,      setError]      = useState(null)
  const [dmBusy,       setDmBusy]       = useState(false)
  // 4-state machine: none | pending_out | pending_in | friend.
  // Driven by isFriend + pendingFriendRequest from the profile payload, plus
  // WS events that flip the state when the other user acts.
  const [friendState,     setFriendState]     = useState('none')
  const [pendingReqId,    setPendingReqId]    = useState(null)
  const [friendBusy,      setFriendBusy]      = useState(false)
  const [confirmUnfriend, setConfirmUnfriend] = useState(false)
  const [confirmCancelReq, setConfirmCancelReq] = useState(false)
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
  const [existingReport,  setExistingReport]  = useState(null) // { id, created_at, status } | null
  const [activeTab, setActiveTab] = useState('hangouts')

  const profileVibeCountRef = useRef(0)

  useEffect(() => {
    setUser(null)
    setEvents([])
    setFriends([])
    setError(null)
    setFriendState('none')
    setPendingReqId(null)
    setConfirmUnfriend(false)
    setConfirmCancelReq(false)
    setVibes([])
    setVibeScore(null)
    setVibeCount(0)
    setMyVibe(null)
    setVibeRating(0)
    setVibeMessage('')
    setShowVibeForm(false)
    setChallenges([])
    setActiveTab('challenges')
    setExistingReport(null)
    setShowReportForm(false)
    profileVibeCountRef.current = 0

    // Preflight: has the viewer already reported this user?
    if (userId !== account?.id) {
      fetchReportStatus({
        guestId: account ? undefined : guest?.guestId,
        targetUserId: userId,
      })
        .then(r => setExistingReport(r?.reported ? (r.existing_report ?? null) : null))
        .catch(() => {})
    }

    fetchPublicProfile(userId)
      .then(data => {
        setUser(data.user)
        // Derive friend state from the payload — see /apps/mobile/app/user/[id].tsx
        // for the same logic on native.
        if (data.user?.isFriend) {
          setFriendState('friend')
          setPendingReqId(null)
        } else if (data.user?.pendingFriendRequest) {
          setFriendState(data.user.pendingFriendRequest.direction === 'outgoing' ? 'pending_out' : 'pending_in')
          setPendingReqId(data.user.pendingFriendRequest.id)
        } else {
          setFriendState('none')
          setPendingReqId(null)
        }
        const vc = data.user?.vibeCount ?? 0
        profileVibeCountRef.current = vc
        if (data.user?.vibeScore != null) setVibeScore(data.user.vibeScore)
        if (vc != null) setVibeCount(vc)
      })
      .catch(() => setError(t('loadError')))

    fetchUserEvents(userId)
      .then(data => setEvents(data.events ?? []))
      .catch(() => {})

    fetchUserHangouts(userId)
      .then(data => setHangouts(data.hangouts ?? []))
      .catch(() => {})

    fetchUserChallenges(userId)
      .then(data => setChallenges(data.challenges ?? []))
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

    if (friendState === 'friend') {
      // Two-step unfriend (existing UX)
      if (!confirmUnfriend) { setConfirmUnfriend(true); return }
      setFriendBusy(true)
      try {
        await removeFriend(userId)
        setFriendState('none')
        setConfirmUnfriend(false)
      } catch { /* ignore */ }
      finally { setFriendBusy(false) }
      return
    }

    if (friendState === 'pending_out') {
      // Two-step cancel for the pending outgoing request
      if (!confirmCancelReq) { setConfirmCancelReq(true); return }
      if (!pendingReqId) return
      setFriendBusy(true)
      try {
        await cancelFriendRequest(pendingReqId)
        setFriendState('none')
        setPendingReqId(null)
        setConfirmCancelReq(false)
      } catch { /* ignore */ }
      finally { setFriendBusy(false) }
      return
    }

    if (friendState === 'pending_in') {
      if (!pendingReqId) return
      setFriendBusy(true)
      try {
        await acceptFriendRequest(pendingReqId)
        setFriendState('friend')
        setPendingReqId(null)
      } catch { /* ignore */ }
      finally { setFriendBusy(false) }
      return
    }

    // friendState === 'none' — send a fresh request. Server may auto-accept
    // on mutual add (returns friend: true), in which case we skip the
    // "Request sent" intermediate state.
    setFriendBusy(true)
    try {
      const result = await sendFriendRequest(userId)
      if (result.friend) {
        setFriendState('friend')
        setPendingReqId(null)
      } else if (result.request) {
        setFriendState('pending_out')
        setPendingReqId(result.request.id)
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
      if (err instanceof DuplicateReportError) {
        setExistingReport(err.existing)
        setReportReason('')
      } else {
        setReportError(err?.message ?? t('report.error'))
      }
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

  // Challenges placed before Hangouts/Events to mirror the NOW filter rhythm
  // — the primary entity sits first.
  const tabs = [
    { key: 'challenges' },
    { key: 'hangouts' },
    { key: 'events'   },
    { key: 'friends'  },
    { key: 'vibes'    },
    ...(hasPicks ? [{ key: 'picks' }] : []),
  ]

  return (
    <div className="full-page pub-profile-page">

      {/* ── Header ── */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('title')}</span>
      </div>

      {/* ── Loading / Error ── */}
      {!user && !error && <p className="pub-profile-loading">{t('loading')}</p>}
      {error && <p className="pub-profile-error-inline">{error}</p>}

      {user && (
        <>
          {/* Identity + tab bar now live INSIDE the body so they scroll away
              with the rest of the content; only the top header and the
              bottom action bar stay pinned. Classes kept for minimal CSS
              churn (the word 'sticky' in the class is now a misnomer). */}
          <div className="pub-profile-body">

          {/* Identity section */}
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
                  {BADGE_MICROCOPY[k] && <span className="pub-profile-badge-micro">{t(`badgeMicro.${k}`)}</span>}
                </div>
              ))}
              {cityName && (
                <div className="pub-profile-city">
                  <span>{cityFlag(cityCountry)} {localizeCityName(cityName)}</span>
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
                    <span className="pub-profile-identity-card-title">{t(`vibes.${vibe}`)}</span>
                    <span className="pub-profile-identity-card-sub">{t(`vibeTaglines.${vibe}`)}</span>
                  </div>
                )}
                {mode && (
                  <div className="pub-profile-identity-card">
                    <span className="pub-profile-identity-card-icon">{MODE_META[mode].emoji}</span>
                    <span className="pub-profile-identity-card-title">{t(`modes.${mode}`)}</span>
                    <span className="pub-profile-identity-card-sub">
                      {mode === 'local'
                        ? ((user.homeCity || cityName) ? t('modeSub.localIn', { city: localizeCityName(user.homeCity || cityName) }) : t('modeSub.local'))
                        : (cityName ? t('modeSub.exploringIn', { city: localizeCityName(cityName) }) : t('modeSub.exploring'))}
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
                    <span className="pub-profile-info-label">{t('from')}</span>
                    <span className="pub-profile-info-value">{user.homeCity}</span>
                  </div>
                )}
                {user.age != null && (
                  <div className="pub-profile-info-row">
                    <span className="pub-profile-info-label">{t('age')}</span>
                    <span className="pub-profile-info-value">{user.age}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tab bar */}
            <div className="profile-tabs pub-profile-tabs-bar">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  className={`profile-tab-pill${activeTab === tab.key ? ' profile-tab-pill--active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {t(`tabs.${tab.key}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content — continues inside pub-profile-body below */}

            {/* Challenges tab */}
            {activeTab === 'challenges' && (() => {
              const filteredChallenges = challengeSubTab === 'all'
                ? challenges
                : challenges.filter(c => (c.mode ?? 'local') === challengeSubTab)
              return (
                <div className="pub-profile-events">
                  {/* Mode sub-tabs — All / Local / International. */}
                  <div className="challenge-type-chips" role="tablist" aria-label={t('modeFilter.label', { ns: 'challenge' })} style={{ padding: '0 0 8px' }}>
                    {[
                      { key: 'all',           emoji: '✨' },
                      { key: 'local',         emoji: '🏙️' },
                      { key: 'international', emoji: '🌐' },
                    ].map(({ key, emoji }) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={challengeSubTab === key}
                        className={`challenge-type-chip${challengeSubTab === key ? ' challenge-type-chip--active' : ''}`}
                        onClick={() => setChallengeSubTab(key)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span>{key === 'all'
                          ? t('modeFilter.all', { ns: 'challenge' })
                          : t(`mode.${key}`,    { ns: 'challenge' })}</span>
                      </button>
                    ))}
                  </div>

                  {filteredChallenges.length === 0
                    ? <p className="pub-profile-tab-empty">{t('empty.challenges')}</p>
                    : filteredChallenges.map(c => (
                        <div
                          key={c.id}
                          className="pub-profile-event-row"
                          onClick={() => onOpenChallenge ? onOpenChallenge(c) : undefined}
                          style={{ cursor: onOpenChallenge ? 'pointer' : 'default' }}
                        >
                          <span className="pub-profile-event-icon">{CHALLENGE_TYPE_ICONS[c.challenge_type] ?? '🔥'}</span>
                          <div className="pub-profile-event-info">
                            <span className="pub-profile-event-title">
                              {(c.mode ?? 'local') === 'international' ? '🌐 ' : ''}{c.title}
                            </span>
                            {c.status === 'validated' && (
                              <span className="pub-profile-event-live">{t('validatedBadge', { ns: 'challenge' })}</span>
                            )}
                            {c.is_owner && <span className="profile-host-tag">{t('host')}</span>}
                          </div>
                        </div>
                      ))
                  }
                </div>
              )
            })()}

            {/* Events tab */}
            {activeTab === 'hangouts' && (
              <div className="pub-profile-events">
                {hangouts.length === 0
                  ? <p className="pub-profile-tab-empty">{t('empty.hangouts')}</p>
                  : hangouts.map(h => (
                      <div
                        key={h.id}
                        className="pub-profile-event-row"
                        onClick={() => onOpenHangout ? onOpenHangout(h) : undefined}
                        style={{ cursor: onOpenHangout ? 'pointer' : 'default' }}
                      >
                        <span className="pub-profile-event-icon">{HANGOUT_ICONS[h.category] ?? '💬'}</span>
                        <div className="pub-profile-event-info">
                          <span className="pub-profile-event-title">{h.title}</span>
                          {h.is_owner && <span className="profile-host-tag">{t('host')}</span>}
                        </div>
                      </div>
                    ))
                }
              </div>
            )}

            {activeTab === 'events' && (
              <div className="pub-profile-events">
                {events.length === 0
                  ? <p className="pub-profile-tab-empty">{t('empty.events')}</p>
                  : events.map(ev => {
                      const isLive = ev.starts_at <= now && ev.expires_at > now
                      return (
                        <div key={ev.id} className="pub-profile-event-row">
                          <span className="pub-profile-event-icon">{eventIcon(ev.event_type)}</span>
                          <div className="pub-profile-event-info">
                            <span className="pub-profile-event-title">{ev.title}</span>
                            {isLive && <span className="pub-profile-event-live">{t('live')}</span>}
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
                  ? <p className="pub-profile-tab-empty">{t('empty.friends')}</p>
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
                            ? <img className="pub-profile-friend-avatar" src={f.avatarUrl} alt={f.displayName} />
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
                    <span className="pub-profile-vibe-avg">{t('vibesTab.score', { score: vibeScore?.toFixed(1) })}</span>
                    <span className="pub-profile-vibe-count">{t('vibesTab.basedOn', { count: vibeCount })}</span>
                  </div>
                )}

                {account && userId !== account?.id && (
                  <div className="pub-profile-vibe-cta">
                    {!showVibeForm ? (
                      <button className="pub-profile-vibe-btn" onClick={() => setShowVibeForm(true)}>
                        {myVibe ? t('vibesTab.updateNote', { rating: myVibe.rating }) : t('vibesTab.leaveNote')}
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
                          placeholder={t('vibesTab.placeholder')}
                          value={vibeMessage}
                          onChange={e => setVibeMessage(e.target.value)}
                          maxLength={300}
                          rows={2}
                        />
                        <div className="pub-profile-vibe-form-actions">
                          <button className="pub-profile-vibe-cancel" onClick={() => { setShowVibeForm(false); setVibeRating(myVibe?.rating ?? 0); setVibeMessage(myVibe?.message ?? '') }}>{t('vibesTab.cancel')}</button>
                          <button className="pub-profile-vibe-submit" onClick={handleSubmitVibe} disabled={vibeBusy || vibeRating === 0}>
                            {vibeBusy ? t('vibesTab.sending') : t('vibesTab.sendNote')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="pub-profile-vibes">
                  {vibes.length > 0 ? (
                    <>
                      <p className="pub-profile-section-label">{t('vibesTab.notesLabel', { count: vibeCount })}</p>
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
                      <p>{t('vibesTab.emptyTitle')}</p>
                      <p>{t('vibesTab.emptySub')}</p>
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
                    <span className="pub-profile-pick-card-title">{t('picks.restaurant')}</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.restaurant}</span>
                  </div>
                )}
                {user.ambassadorPicks.spot && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">{t('picks.spot')}</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.spot}</span>
                  </div>
                )}
                {user.ambassadorPicks.tip && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">{t('picks.tip')}</span>
                    <span className="pub-profile-pick-card-content">{user.ambassadorPicks.tip}</span>
                  </div>
                )}
                {user.ambassadorPicks.story && (
                  <div className="pub-profile-pick-card">
                    <span className="pub-profile-pick-card-title">{t('picks.story')}</span>
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
              {dmBusy ? t('actions.opening') : t('actions.message')}
            </button>
          )}
          {account && !confirmUnfriend && !confirmCancelReq && (
            <button
              className={`pub-profile-friend-btn${(friendState === 'friend' || friendState === 'pending_out') ? ' pub-profile-friend-btn--active' : ''}`}
              onClick={handleFriendToggle}
              disabled={friendBusy}
            >
              {friendBusy ? '…' :
               friendState === 'friend'      ? t('actions.friend')        :
               friendState === 'pending_out' ? t('actions.requestSent')   :
               friendState === 'pending_in'  ? t('actions.acceptRequest') :
                                                t('actions.addFriend')}
            </button>
          )}
          {account && confirmUnfriend && (
            <div className="pub-profile-unfriend-confirm">
              <button className="pub-profile-unfriend-btn" onClick={handleFriendToggle} disabled={friendBusy}>
                {friendBusy ? t('actions.removing') : t('actions.unfriend')}
              </button>
              <button className="pub-profile-unfriend-cancel" onClick={() => setConfirmUnfriend(false)} disabled={friendBusy}>
                {t('actions.cancel')}
              </button>
            </div>
          )}
          {account && confirmCancelReq && (
            <div className="pub-profile-unfriend-confirm">
              <button className="pub-profile-unfriend-btn" onClick={handleFriendToggle} disabled={friendBusy}>
                {friendBusy ? t('actions.cancelling') : t('actions.cancelRequest')}
              </button>
              <button className="pub-profile-unfriend-cancel" onClick={() => setConfirmCancelReq(false)} disabled={friendBusy}>
                {t('actions.keep')}
              </button>
            </div>
          )}
          <button
            className="pub-profile-report-btn"
            onClick={() => { setShowReportForm(f => !f); setReportSent(false); setReportError(null) }}
            title={t('actions.reportTitle')}
          >
            🚩
          </button>
        </div>
      )}

      {/* ── Inline report form ── */}
      {user && userId !== account?.id && showReportForm && (
        <div className="pub-profile-report-form-wrap">
          {existingReport ? (
            <p className="pub-profile-report-sent">
              {t('report.existing', { date: new Date(existingReport.created_at).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' }) })}
            </p>
          ) : reportSent ? (
            <p className="pub-profile-report-sent">{t('report.sent')}</p>
          ) : (
            <form className="pub-profile-report-form" onSubmit={handleSubmitReport}>
              <textarea
                className="pub-profile-report-textarea"
                placeholder={t('report.placeholder')}
                value={reportReason}
                onChange={e => setReportReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={reportBusy}
              />
              {reportError && <p className="pub-profile-report-error">{reportError}</p>}
              <div className="pub-profile-report-actions">
                <button type="submit" className="pub-profile-report-submit" disabled={reportReason.trim().length < 10 || reportBusy}>
                  {reportBusy ? t('report.sending') : t('report.submit')}
                </button>
                <button type="button" className="pub-profile-report-cancel" onClick={() => setShowReportForm(false)} disabled={reportBusy}>
                  {t('report.cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
