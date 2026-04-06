import { useState, useRef } from 'react'
import { updateProfile, uploadImage } from '../api'
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
  { key: 'local',     emoji: '🌍', label: 'Local'     },
  { key: 'exploring', emoji: '🧭', label: 'Exploring' },
]

// Must match AuthService allowed list on the backend
const VIBES = [
  { key: 'party',       emoji: '🔥', label: 'Party'       },
  { key: 'board_games', emoji: '🎲', label: 'Board Games' },
  { key: 'coffee',      emoji: '☕', label: 'Coffee'       },
  { key: 'music',       emoji: '🎧', label: 'Music'        },
  { key: 'food',        emoji: '🍜', label: 'Food'         },
  { key: 'chill',       emoji: '🧘', label: 'Chill'        },
]

// Must match AuthService::ALLOWED_INTERESTS on the backend
const INTERESTS = [
  'drinks', 'party', 'nightlife', 'music', 'live music',
  'culture', 'art', 'food', 'coffee', 'sport',
  'fitness', 'hiking', 'beach', 'wellness', 'travel',
  'hangout', 'socializing', 'gaming', 'tech', 'dating',
]

export default function ProfileScreen({ account, myEvents, myFriends, cityTimezone, onSave, onBack, onViewFriend, onSelectEvent, onDeleteEvent, onSignOut }) {
  const [photoUrl, setPhotoUrl]   = useState(account.profile_photo_url ?? null)
  const [name, setName]           = useState(account.display_name ?? '')
  const [homeCity, setHomeCity]   = useState(account.home_city ?? '')
  const [age, setAge]             = useState(account.age != null ? String(account.age) : '')
  const [vibe, setVibe]           = useState(account.vibe ?? 'chill')
  const [mode, setMode]           = useState(account.mode ?? null)
  const [interests, setInterests] = useState(new Set(account.interests ?? []))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState(null)
  // Ambassador picks (only visible when account.isAmbassador)
  const [pickRestaurant, setPickRestaurant] = useState(account.ambassadorPicks?.restaurant ?? '')
  const [pickSpot, setPickSpot]             = useState(account.ambassadorPicks?.spot ?? '')
  const [pickTip, setPickTip]               = useState(account.ambassadorPicks?.tip ?? '')
  const [pickStory, setPickStory]           = useState(account.ambassadorPicks?.story ?? '')
  const fileRef = useRef(null)

  function toggleInterest(i) {
    setInterests(prev => {
      const next = new Set(prev)
      if (next.has(i)) {
        next.delete(i)
      } else if (next.size < 5) {
        next.add(i)
      }
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
      // Immediately persist the new photo URL to the DB so it survives a page
      // reload without requiring the user to click "Save profile".
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

  const [c1, c2] = avatarColors(name || account.display_name)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">My Profile</span>
      </div>

      <div className="page-body profile-body">
        <div className="profile-card profile-hero-card">
          <div className="profile-photo-section">
            <button
              className="profile-photo-btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              type="button"
              aria-label="Change profile photo"
            >
              {photoUrl
                ? <img className="online-avatar profile-avatar-xl" src={photoUrl} alt={name} />
                : <span className="online-avatar profile-avatar-xl" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(name || '?')[0].toUpperCase()}
                  </span>
              }
              <span className="profile-photo-badge">
                {uploading ? '…' : '📷'}
              </span>
            </button>
            <div className="profile-hero-copy">
              <h2 className="profile-hero-name">{name || 'Your profile'}</h2>
              {account.primaryBadge && (
                <span className={`badge-pill badge-pill--${account.primaryBadge.key}`}>{account.primaryBadge.label}</span>
              )}
              <p className="profile-hero-sub">Update how people see you in Hilads.</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
        </div>

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
            <label className="modal-label">Your vibe</label>
            <div className="vibe-grid">
              {MODES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  className={`vibe-chip${mode === m.key ? ' vibe-chip--on' : ''}`}
                  onClick={() => setMode(mode === m.key ? null : m.key)}
                >
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
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

        {myEvents !== null && myEvents.length > 0 && (
          <div className="profile-card">
            <p className="me-section-label">My events</p>
            {myEvents.map(ev => {
              const now = Date.now() / 1000
              const isLive = ev.starts_at <= now && ev.expires_at > now
              const tz = cityTimezone || 'UTC'
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
        )}

        {myFriends !== null && myFriends.length > 0 && (
          <div className="profile-card">
            <p className="me-section-label">My friends</p>
            {myFriends.map(f => {
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
            })}
          </div>
        )}

      </div>

      {/* ── Sticky CTA bar ─────────────────────────────────────────────── */}
      <div className="profile-sticky-cta">
        {error && <p className="profile-sticky-error">{error}</p>}
        <button
          className="modal-submit profile-sticky-save"
          onClick={handleSave}
          disabled={saving || uploading || !name.trim()}
        >
          {uploading ? 'Uploading…' : saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
        </button>
        <button
          className="profile-sticky-signout"
          onClick={onSignOut}
          type="button"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
