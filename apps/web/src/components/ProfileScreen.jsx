import { useState, useEffect, useRef } from 'react'
import { updateProfile, uploadImage, fetchUserVibes, deleteAccount } from '../api'
import BackButton from './BackButton'
import { EVENT_ICONS } from '../cityMeta'
import { getTimeLabel, formatTime } from '../eventUtils'
import { badgeLabel } from '../badgeMeta'

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

const MODES = [
  { key: 'local',     emoji: '🌍', label: 'Local',     desc: 'You know this city'    },
  { key: 'exploring', emoji: '🧭', label: 'Exploring', desc: "You're discovering it" },
]

const VIBES = [
  { key: 'party',       emoji: '🔥', label: 'Party'       },
  { key: 'board_games', emoji: '🎲', label: 'Board Games' },
  { key: 'coffee',      emoji: '☕', label: 'Coffee'       },
  { key: 'music',       emoji: '🎧', label: 'Music'        },
  { key: 'food',        emoji: '🍜', label: 'Food'         },
  { key: 'chill',       emoji: '🧘', label: 'Chill'        },
]

const INTERESTS = [
  'drinks', 'party', 'nightlife', 'music', 'live music',
  'culture', 'art', 'food', 'coffee', 'sport',
  'fitness', 'hiking', 'beach', 'wellness', 'travel',
  'hangout', 'socializing', 'gaming', 'tech', 'dating',
]

const PROFILE_TABS = [
  { key: 'interests', label: 'Interests' },
  { key: 'going',     label: 'Going To'  },
  { key: 'hosting',   label: 'Hosting'   },
  { key: 'friends',   label: 'Friends'   },
  { key: 'vibes',     label: 'Vibes'     },
]

export default function ProfileScreen({ account, myEvents, myFriends, cityTimezone, onSave, onBack, onViewFriend, onSelectEvent, onDeleteEvent, onSignOut, onDeleteAccount }) {
  const [photoUrl,        setPhotoUrl]        = useState(account.profile_photo_url ?? null)
  const [name,            setName]            = useState(account.display_name ?? '')
  const [homeCity,        setHomeCity]        = useState(account.home_city ?? '')
  const [age,             setAge]             = useState(account.age != null ? String(account.age) : '')
  const [vibe,            setVibe]            = useState(account.vibe ?? 'chill')
  const [mode,            setMode]            = useState(account.mode ?? null)
  const [interests,       setInterests]       = useState(new Set(account.interests ?? []))
  const [uploading,       setUploading]       = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [error,           setError]           = useState(null)
  const [activeTab,       setActiveTab]       = useState('interests')
  const [pickRestaurant,  setPickRestaurant]  = useState(account.ambassadorPicks?.restaurant ?? '')
  const [pickSpot,        setPickSpot]        = useState(account.ambassadorPicks?.spot ?? '')
  const [pickTip,         setPickTip]         = useState(account.ambassadorPicks?.tip ?? '')
  const [pickStory,       setPickStory]       = useState(account.ambassadorPicks?.story ?? '')
  const fileRef = useRef(null)

  const [myReceivedVibes, setMyReceivedVibes] = useState([])
  const [myVibeScore,     setMyVibeScore]     = useState(null)
  const [myVibeCount,     setMyVibeCount]     = useState(0)
  const [vibesLoading,    setVibesLoading]    = useState(true)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError,       setDeleteError]       = useState(null)
  const [deleteLoading,     setDeleteLoading]     = useState(false)

  useEffect(() => {
    if (!account?.id) { setVibesLoading(false); return }
    fetchUserVibes(account.id)
      .then(data => {
        setMyReceivedVibes(data.vibes ?? [])
        setMyVibeScore(data.score)
        setMyVibeCount(data.count ?? 0)
      })
      .catch(() => {})
      .finally(() => setVibesLoading(false))
  }, [account?.id])

  function toggleInterest(i) {
    setInterests(prev => {
      const next = new Set(prev)
      if (next.has(i)) { next.delete(i) }
      else if (next.size < 5) { next.add(i) }
      return next
    })
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      const { user } = await updateProfile({ profile_photo_url: url })
      setPhotoUrl(url)
      onSave(user)
    } catch {
      setError('Photo upload failed. Try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setError(null)
    try {
      const fields = {
        display_name:      trimmedName,
        home_city:         homeCity.trim() || null,
        interests:         [...interests],
        vibe,
        mode,
        profile_photo_url: photoUrl,
      }
      if (account.isAmbassador) {
        fields.ambassador_restaurant = pickRestaurant.trim() || null
        fields.ambassador_spot       = pickSpot.trim() || null
        fields.ambassador_tip        = pickTip.trim() || null
        fields.ambassador_story      = pickStory.trim() || null
      }
      if (age !== '') {
        const n = parseInt(age, 10)
        if (!isNaN(n) && n >= 18 && n <= 100) {
          fields.birth_year = new Date().getFullYear() - n
        }
      } else {
        fields.birth_year = null
      }
      const { user } = await updateProfile(fields)
      onSave(user)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.message || 'Save failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteAccount()
      onDeleteAccount?.()
    } catch (err) {
      setDeleteError(err.message ?? 'Something went wrong. Try again.')
    } finally {
      setDeleteLoading(false)
    }
  }

  const [c1, c2] = avatarColors(name || account.display_name)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">My Profile</span>
      </div>

      {/* ══ STICKY: Identity + Mode + Filter pills ══════════════════════════ */}
      <div className="profile-sticky-identity">

        {/* Identity row — avatar + name + badge + description */}
        <div className="profile-identity-row">
          <button
            className="profile-photo-btn"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            type="button"
            aria-label="Change profile photo"
          >
            {photoUrl
              ? <img className="online-avatar profile-avatar-identity" src={photoUrl} alt={name} />
              : <span className="online-avatar profile-avatar-identity" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                  {(name || '?')[0].toUpperCase()}
                </span>
            }
            <span className="profile-photo-badge">{uploading ? '…' : '📷'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
          <div className="profile-identity-info">
            <h2 className="profile-identity-name">{name || 'Your profile'}</h2>
            <div className="profile-identity-badges">
              {account.primaryBadge && (
                <span className={`badge-pill badge-pill--${account.primaryBadge.key}`}>{account.primaryBadge.label}</span>
              )}
              {homeCity && (
                <span className="profile-identity-city">📍 {homeCity}</span>
              )}
            </div>
            {vibe && VIBES.find(v => v.key === vibe) && (
              <p className="profile-identity-vibe">
                {VIBES.find(v => v.key === vibe).emoji} {VIBES.find(v => v.key === vibe).label}
              </p>
            )}
          </div>
        </div>

        {/* Mode selector */}
        <div className="profile-mode-section">
          <span className="profile-mode-label">Mode</span>
          <div className="profile-mode-btns">
            {MODES.map(m => (
              <button
                key={m.key}
                type="button"
                className={`profile-mode-btn${mode === m.key ? ' profile-mode-btn--on' : ''}`}
                onClick={() => setMode(mode === m.key ? null : m.key)}
              >
                <span className="profile-mode-btn-emoji">{m.emoji}</span>
                <span className="profile-mode-btn-name">{m.label}</span>
                <span className="profile-mode-btn-desc">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Filter pills */}
        <div className="profile-tabs">
          {PROFILE_TABS.map(({ key, label }) => (
            <button
              key={key}
              className={`profile-tab-pill${activeTab === key ? ' profile-tab-pill--active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ SCROLLABLE CONTENT ══════════════════════════════════════════════ */}
      <div className="page-body profile-body">

        {/* ── Tab: Interests ── */}
        {activeTab === 'interests' && (
          <>
            <div className="profile-card profile-fields">
              <div className="modal-field">
                <label className="modal-label">Display name</label>
                <input
                  className="modal-input"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={30}
                  placeholder="How you'll appear"
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">Email <span className="modal-label-muted">— read only</span></label>
                <input
                  className="modal-input modal-input--muted"
                  type="email"
                  value={account.email ?? ''}
                  readOnly
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">Home city</label>
                <input
                  className="modal-input"
                  type="text"
                  value={homeCity}
                  onChange={e => setHomeCity(e.target.value)}
                  maxLength={60}
                  placeholder="Where you live"
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">Age</label>
                <input
                  className="modal-input"
                  type="number"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  min={18}
                  max={100}
                  placeholder="Your age"
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">My vibe</label>
                <div className="vibe-grid">
                  {VIBES.map(v => (
                    <button
                      key={v.key}
                      type="button"
                      className={`vibe-chip${vibe === v.key ? ' vibe-chip--on' : ''}`}
                      onClick={() => setVibe(v.key)}
                    >
                      {v.emoji} {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-field">
                <label className="modal-label">
                  Interests
                  <span className="modal-label-muted"> — pick up to 5</span>
                </label>
                <div className="interest-grid">
                  {INTERESTS.map(i => (
                    <button
                      key={i}
                      type="button"
                      className={`interest-chip${interests.has(i) ? ' interest-chip--on' : ''}`}
                      onClick={() => toggleInterest(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {account.isAmbassador && (
              <div className="profile-card profile-fields">
                <p className="me-section-label">City picks 👑</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '-4px 0 8px' }}>
                  Shown on your profile as a local legend.
                </p>
                {[
                  { key: 'restaurant', label: 'Favorite restaurant', emoji: '🍜', val: pickRestaurant, set: setPickRestaurant, maxLen: 200, placeholder: 'A place you always bring people to' },
                  { key: 'spot',       label: 'Hidden gem / spot',   emoji: '🗺️', val: pickSpot,       set: setPickSpot,       maxLen: 200, placeholder: 'Somewhere most tourists miss' },
                  { key: 'tip',        label: 'Local tip',           emoji: '💡', val: pickTip,        set: setPickTip,        maxLen: 300, placeholder: 'Best piece of advice for newcomers' },
                  { key: 'story',      label: 'City story',          emoji: '🎭', val: pickStory,      set: setPickStory,      maxLen: 400, placeholder: 'Something you love about this city' },
                ].map(({ key, label, emoji, val, set, maxLen, placeholder }) => (
                  <div key={key} className="modal-field">
                    <label className="modal-label">{emoji} {label}</label>
                    <textarea
                      className="modal-input"
                      value={val}
                      onChange={e => set(e.target.value)}
                      maxLength={maxLen}
                      placeholder={placeholder}
                      rows={2}
                      style={{ resize: 'none' }}
                    />
                  </div>
                ))}
              </div>
            )}

          </>
        )}

        {/* ── Tab: Going To ── */}
        {activeTab === 'going' && (() => {
          const gid = account.guest_id
          const goingEvts = (myEvents ?? []).filter(ev => ev.guest_id !== gid)
          return (
            <div className="profile-card">
              <p className="me-section-label">Going to</p>
              {goingEvts.length === 0 ? (
                <p className="profile-tab-empty">Not going to any events yet. Browse events to find one.</p>
              ) : goingEvts.map(ev => {
                const now    = Date.now() / 1000
                const isLive = ev.starts_at <= now && ev.expires_at > now
                const tz     = cityTimezone || 'UTC'
                return (
                  <div key={ev.id} className="my-event-row">
                    <button className="my-event-row-body" onClick={() => onSelectEvent?.(ev)}>
                      <span className="my-event-title">{EVENT_ICONS[ev.type] ?? '📌'} {ev.title}</span>
                      <span className="my-event-meta">
                        {ev.recurrence_label
                          ? ev.recurrence_label
                          : getTimeLabel(ev.starts_at, tz) + (ev.ends_at ? ` → ${formatTime(ev.ends_at, tz)}` : '')}
                      </span>
                      <span className={`my-event-badge${isLive ? ' my-event-badge--live' : ''}`}>
                        {isLive ? 'Live' : 'Upcoming'}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── Tab: Hosting ── */}
        {activeTab === 'hosting' && (() => {
          const gid = account.guest_id
          const hostingEvts = (myEvents ?? []).filter(ev => ev.guest_id === gid)
          return (
            <div className="profile-card">
              <p className="me-section-label">Hosting</p>
              {hostingEvts.length === 0 ? (
                <p className="profile-tab-empty">No events hosted yet. Create one from the city chat.</p>
              ) : hostingEvts.map(ev => {
                const now    = Date.now() / 1000
                const isLive = ev.starts_at <= now && ev.expires_at > now
                const tz     = cityTimezone || 'UTC'
                return (
                  <div key={ev.id} className="my-event-row">
                    <button className="my-event-row-body" onClick={() => onSelectEvent?.(ev)}>
                      <span className="my-event-title">{EVENT_ICONS[ev.type] ?? '📌'} {ev.title}</span>
                      <span className="my-event-meta">
                        {ev.recurrence_label
                          ? ev.recurrence_label
                          : getTimeLabel(ev.starts_at, tz) + (ev.ends_at ? ` → ${formatTime(ev.ends_at, tz)}` : '')}
                      </span>
                      <span className={`my-event-badge${isLive ? ' my-event-badge--live' : (ev.recurrence_label ? ' my-event-badge--recurring' : '')}`}>
                        {isLive ? 'Live' : (ev.recurrence_label ? '↻ Recurring' : 'Upcoming')}
                      </span>
                    </button>
                    <button className="my-event-delete" onClick={() => onDeleteEvent?.(ev)} aria-label="Delete event">✕</button>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── Tab: Friends ── */}
        {activeTab === 'friends' && (
          <div className="profile-card">
            <p className="me-section-label">My friends</p>
            {myFriends === null || myFriends.length === 0 ? (
              <p className="profile-tab-empty">No friends yet. Add some from profiles.</p>
            ) : (
              myFriends.map(f => {
                const [fc1, fc2] = avatarColors(f.displayName || '?')
                return (
                  <div
                    key={f.id}
                    className="my-friend-row"
                    onClick={() => onViewFriend?.(f.id, f.displayName)}
                    style={{ cursor: onViewFriend ? 'pointer' : 'default' }}
                  >
                    {f.avatarUrl
                      ? <img className="my-friend-avatar" src={f.avatarUrl} alt={f.displayName} />
                      : <span className="my-friend-avatar my-friend-avatar--initials" style={{ background: `linear-gradient(135deg, ${fc1}, ${fc2})` }}>
                          {(f.displayName || '?')[0].toUpperCase()}
                        </span>
                    }
                    <div className="my-friend-info">
                      <span className="my-friend-name">{f.displayName}</span>
                      {f.badges?.[0] && <span className="my-friend-badge">{badgeLabel(f.badges[0])}</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ── Tab: Vibes ── */}
        {activeTab === 'vibes' && !vibesLoading && (
          <div className="profile-card">
            <p className="me-section-label">Vibes received</p>
            {myVibeCount > 0 && (
              <div className="pub-profile-vibe-score">
                <div className="pub-profile-vibe-stars">
                  {[1,2,3,4,5].map(s => (
                    <span key={s} className={s <= Math.round(myVibeScore) ? 'vibe-star vibe-star--on' : 'vibe-star'}>★</span>
                  ))}
                </div>
                <span className="pub-profile-vibe-avg">{myVibeScore?.toFixed(1)} vibe score</span>
                <span className="pub-profile-vibe-count">based on {myVibeCount} vibe{myVibeCount !== 1 ? 's' : ''}</span>
              </div>
            )}
            {myReceivedVibes.length > 0 ? (
              <div className="pub-profile-vibes">
                {myReceivedVibes.map(v => {
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
              </div>
            ) : (
              <div className="pub-profile-vibes-empty">
                <p>No vibes yet</p>
                <p>Your score will appear here once people leave you a note ✨</p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'vibes' && vibesLoading && (
          <p className="conv-loading">Loading…</p>
        )}

      </div>

      {/* ══ STICKY: Save CTA ════════════════════════════════════════════════ */}
      <div className="profile-sticky-cta">
        {error && <p className="profile-sticky-error">{error}</p>}
        <button
          className="modal-submit profile-sticky-save"
          onClick={handleSave}
          disabled={saving || uploading || !name.trim()}
        >
          {uploading ? 'Uploading…' : saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
        </button>
        <div className="profile-sticky-bottom-row">
          <button className="profile-sticky-signout" onClick={onSignOut} type="button">Sign out</button>
          <button className="profile-sticky-delete" onClick={() => { setShowDeleteConfirm(true); setDeleteError(null) }} type="button">
            Delete account
          </button>
        </div>
      </div>

      {/* ══ Delete account confirmation overlay ═════════════════════════════ */}
      {showDeleteConfirm && (
        <div className="delete-account-overlay" onClick={() => !deleteLoading && setShowDeleteConfirm(false)}>
          <div className="delete-account-sheet" onClick={e => e.stopPropagation()}>
            <p className="delete-account-icon">⚠️</p>
            <h3 className="delete-account-title">Delete account?</h3>
            <p className="delete-account-body">
              Your profile, friends, and settings will be permanently removed.
              Your messages and events will remain in city chats anonymously.
              <br /><br />
              <strong>This cannot be undone.</strong>
            </p>
            {deleteError && <p className="delete-account-error">{deleteError}</p>}
            <button className="delete-account-confirm" onClick={handleDeleteAccount} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting…' : 'Yes, delete my account'}
            </button>
            <button className="delete-account-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleteLoading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
