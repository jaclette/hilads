import { thumbUrl } from '../lib/imageThumb'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { updateProfile, uploadImage, fetchUserVibes, fetchUserHangouts, fetchUserChallenges, deleteAccount, checkUsernameAvailability } from '../api'
import { setLocale } from '../i18n'

const HANGOUT_ICONS = { general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }
import BackButton from './BackButton'
import { EVENT_ICONS } from '../cityMeta'
import { getTimeLabel, formatTime } from '../eventUtils'
import { badgeLabel } from '../badgeMeta'
import LeaderboardCityPickerModal from './LeaderboardCityPickerModal'
import { isLegend as accountIsLegend } from '../lib/canCreateEvent'
import { localizeCityName } from '../i18n/cityName'
import ProfileRankRow from './ProfileRankRow'

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// Labels resolved via i18n at render - these arrays hold only stable keys + emoji.
const MODES = [
  { key: 'local',     emoji: '🌍' },
  { key: 'exploring', emoji: '🧭' },
]

const VIBES = [
  { key: 'party',       emoji: '🔥' },
  { key: 'board_games', emoji: '🎲' },
  { key: 'coffee',      emoji: '☕' },
  { key: 'music',       emoji: '🎧' },
  { key: 'food',        emoji: '🍜' },
  { key: 'chill',       emoji: '🧘' },
]

const INTERESTS = [
  'drinks', 'party', 'nightlife', 'music', 'live music',
  'culture', 'art', 'food', 'coffee', 'sport',
  'fitness', 'hiking', 'beach', 'wellness', 'travel',
  'hangout', 'socializing', 'gaming', 'tech', 'dating',
]

// Challenges placed before Hangouts/Events to mirror the NOW filter ordering
// - challenges are the primary entity now.
const PROFILE_TABS = ['interests', 'challenges', 'hangouts', 'events', 'friends', 'vibes']

const CHALLENGE_TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }

const AMBASSADOR_PICKS = [
  { key: 'restaurant', emoji: '🍜', maxLen: 200 },
  { key: 'spot',       emoji: '🗺️', maxLen: 200 },
  { key: 'tip',        emoji: '💡', maxLen: 300 },
  { key: 'story',      emoji: '🎭', maxLen: 400 },
]

// Endonyms - language names are shown in their OWN language, never translated.
const LANGS = [
  { code: 'en', flag: '🇬🇧', name: 'English'    },
  { code: 'fr', flag: '🇫🇷', name: 'Français'   },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
  { code: 'es', flag: '🇪🇸', name: 'Español'    },
  { code: 'it', flag: '🇮🇹', name: 'Italiano'   },
  { code: 'pt-br', flag: '🇧🇷', name: 'Português (Brasil)'   },
  { code: 'pt-pt', flag: '🇵🇹', name: 'Português (Portugal)' },
  { code: 'de',    flag: '🇩🇪', name: 'Deutsch'    },
  { code: 'nl',    flag: '🇳🇱', name: 'Nederlands' },
  { code: 'zh-hans', flag: '🇨🇳', name: '简体中文' },
  { code: 'zh-hant', flag: '🇹🇼', name: '繁體中文' },
  { code: 'ja',    flag: '🇯🇵', name: '日本語' },
  { code: 'ko',    flag: '🇰🇷', name: '한국어' },
  { code: 'fil',   flag: '🇵🇭', name: 'Filipino' },
  { code: 'th',    flag: '🇹🇭', name: 'ไทย' },
  { code: 'id',    flag: '🇮🇩', name: 'Bahasa Indonesia' },
  { code: 'hi',    flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'ru',    flag: '🇷🇺', name: 'Русский' },
  { code: 'ar',    flag: '🇸🇦', name: 'العربية' },
]

export default function ProfileScreen({ account, myEvents, myFriends, cityTimezone, friendRequestCount = 0, onOpenFriendRequests, onSave, onBack, onViewFriend, onSelectEvent, onDeleteEvent, onOpenHangout, onOpenChallenge, onOpenThreads, onSignOut, onDeleteAccount, tabMode = false, renderAppHeader, city, cityChannelId, onCityChange, onOpenLeaderboard }) {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const [photoUrl,        setPhotoUrl]        = useState(account.profile_photo_url ?? null)
  const [thumbPhotoUrl,   setThumbPhotoUrl]   = useState(account.thumbAvatarUrl ?? account.profile_photo_url ?? null)
  const [username,        setUsername]        = useState(account.username ?? '')
  const [uStatus,         setUStatus]         = useState('idle') // idle|checking|available|taken|invalid
  const [uReason,         setUReason]         = useState(null)
  const uTimer = useRef(null)
  const [aboutMe,         setAboutMe]         = useState(account.about_me ?? '')
  const [homeCity,        setHomeCity]        = useState(account.home_city ?? '')
  // Legend-only city picker. The "Home city" row is the ONLY surface
  // where /me/city gets called now - switch-city is purely a browse view.
  // Global Legend check via account.badges so a Legend who currently
  // lives in a city they aren't ambassador in still sees the affordance
  // (contextBadge is city-context-scoped, not global).
  const isLegend = accountIsLegend(account)
  const [cityPickerOpen, setCityPickerOpen] = useState(false)
  const currentCityName = city?.name ?? null
  const currentCityChannelId = cityChannelId ? String(cityChannelId) : null
  const [age,             setAge]             = useState(account.age != null ? String(account.age) : '')
  const [vibe,            setVibe]            = useState(account.vibe ?? 'chill')
  const [mode,            setMode]            = useState(account.mode ?? null)
  const [interests,       setInterests]       = useState(new Set(account.interests ?? []))
  const [langOpen,        setLangOpen]        = useState(false)
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

  // Ambassador pick state wired to the AMBASSADOR_PICKS key list.
  const pickState = {
    restaurant: [pickRestaurant, setPickRestaurant],
    spot:       [pickSpot,       setPickSpot],
    tip:        [pickTip,        setPickTip],
    story:      [pickStory,      setPickStory],
  }

  const [myReceivedVibes, setMyReceivedVibes] = useState([])
  const [myVibeScore,     setMyVibeScore]     = useState(null)
  const [myVibeCount,     setMyVibeCount]     = useState(0)
  const [vibesLoading,    setVibesLoading]    = useState(true)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError,       setDeleteError]       = useState(null)
  const [deleteLoading,     setDeleteLoading]     = useState(false)
  const [myHangouts,        setMyHangouts]        = useState([])
  const [myChallenges,      setMyChallenges]      = useState([])
  const [challengeSubTab,   setChallengeSubTab]   = useState('all') // 'all' | 'local' | 'international'

  useEffect(() => {
    if (!account?.id) { setMyHangouts([]); return }
    fetchUserHangouts(account.id).then(data => setMyHangouts(data.hangouts ?? [])).catch(() => {})
  }, [account?.id])

  useEffect(() => {
    if (!account?.id) { setMyChallenges([]); return }
    fetchUserChallenges(account.id).then(data => setMyChallenges(data.challenges ?? [])).catch(() => {})
  }, [account?.id])

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
      const { url, thumbUrl } = await uploadImage(file)
      const { user } = await updateProfile({
        profile_photo_url:       url,
        profile_thumb_photo_url: thumbUrl ?? null,
      })
      setPhotoUrl(url)
      setThumbPhotoUrl(thumbUrl ?? url)
      onSave(user)
    } catch {
      setError(t('errors.photoUpload'))
    } finally {
      setUploading(false)
    }
  }

  async function handleUsernameChange(val) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setUsername(cleaned)
    setUReason(null)
    clearTimeout(uTimer.current)
    if (cleaned === (account.username ?? '')) { setUStatus('idle'); return } // unchanged
    if (cleaned.length < 3) { setUStatus(cleaned.length === 0 ? 'idle' : 'invalid'); return }
    setUStatus('checking')
    uTimer.current = setTimeout(async () => {
      try {
        const r = await checkUsernameAvailability(cleaned)
        if (!r.valid)         { setUStatus('invalid');   setUReason(r.reason) }
        else if (r.available) { setUStatus('available') }
        else                  { setUStatus('taken');     setUReason(r.reason) }
      } catch { setUStatus('idle') }
    }, 450)
  }

  async function handleSave() {
    // Username is the single identity field - it doubles as the display name.
    const handle        = username.trim().toLowerCase()
    const handleChanged = handle !== (account.username ?? '')
    if (handle.length < 3)     { setError(t('errors.usernameTooShort')); return }
    if (handleChanged) {
      if (uStatus === 'taken')   { setError(t('errors.usernameTaken')); return }
      if (uStatus === 'invalid') { setError(uReason || t('errors.usernameInvalid')); return }
    }
    setSaving(true)
    setError(null)
    try {
      const fields = {
        // display_name == username (single identity field).
        username:          handle,
        display_name:      handle,
        about_me:          aboutMe.trim() || null,
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
      setError(err.message || t('errors.saveFailed'))
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
      setDeleteError(err.message ?? t('errors.generic'))
    } finally {
      setDeleteLoading(false)
    }
  }

  const [c1, c2] = avatarColors(username || account.username || account.display_name)

  return (
    <div className={`full-page${tabMode ? ' full-page--tab' : ''}`}>
      {renderAppHeader && (
        <div className="tab-app-header">
          {renderAppHeader()}
        </div>
      )}
      <div className="page-header">
        {onBack && <BackButton onClick={onBack} />}
        <span className="page-title">{t('pageTitle')}</span>
      </div>

      {/* ══ SCROLLABLE CONTENT ══════════════════════════════════════════════ */}
      <div className="page-body profile-body">

        {/* Identity + Mode + Filter pills */}
        <div className="profile-sticky-identity">

          {/* Identity row - avatar + name + badge + description */}
          <div className="profile-identity-row">
            <button
              className="profile-photo-btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              type="button"
              aria-label={t('changePhoto')}
            >
              {photoUrl
                ? <img className="online-avatar profile-avatar-identity" src={thumbPhotoUrl ?? photoUrl} alt={username} />
                : <span className="online-avatar profile-avatar-identity" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(username || account.username || account.display_name || '?')[0].toUpperCase()}
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
              <h2 className="profile-identity-name">{username ? `@${username}` : t('yourProfile')}</h2>
              <div className="profile-identity-badges">
                {account.primaryBadge && (
                  <span className={`badge-pill badge-pill--${account.primaryBadge.key}`}>{badgeLabel(account.primaryBadge.key)}</span>
                )}
                {homeCity && (
                  <span className="profile-identity-city">📍 {homeCity}</span>
                )}
              </div>
              {vibe && VIBES.find(v => v.key === vibe) && (
                <p className="profile-identity-vibe">
                  {VIBES.find(v => v.key === vibe).emoji} {t(`vibes.${vibe}`)}
                </p>
              )}
            </div>
          </div>

          {/* Monthly rank - between identity header and mode selector so
              it sits in the visible top area without crowding the
              identity row itself. Hides when there's nothing to show. */}
          <ProfileRankRow
            rank={account.monthly_rank ?? null}
            cityName={account.current_city?.name ?? null}
            cityCountry={account.current_city?.country ?? null}
            onOpenLeaderboard={onOpenLeaderboard}
          />

          {/* Mode selector */}
          <div className="profile-mode-section">
            <span className="profile-mode-label">{t('mode')}</span>
            <div className="profile-mode-btns">
              {MODES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  className={`profile-mode-btn${mode === m.key ? ' profile-mode-btn--on' : ''}`}
                  onClick={() => setMode(mode === m.key ? null : m.key)}
                >
                  <span className="profile-mode-btn-emoji">{m.emoji}</span>
                  <span className="profile-mode-btn-name">{t(`modes.${m.key}`)}</span>
                  <span className="profile-mode-btn-desc">{t(`modes.${m.key}Desc`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Language switcher - collapsed to the current language; tap to pick
              from the full list (kept compact now that there are 19 locales). */}
          <div className="profile-mode-section">
            <span className="profile-mode-label">{t('common:language')}</span>
            {(() => {
              const cur = LANGS.find(l => l.code === i18n.language) || LANGS[0]
              return (
                <>
                  <button
                    type="button"
                    className="profile-lang-trigger"
                    onClick={() => setLangOpen(o => !o)}
                    aria-expanded={langOpen}
                  >
                    <span className="profile-lang-trigger-flag">{cur.flag}</span>
                    <span className="profile-lang-trigger-name">{cur.name}</span>
                    <span className={`profile-lang-chevron${langOpen ? ' profile-lang-chevron--open' : ''}`} aria-hidden="true">▾</span>
                  </button>
                  {langOpen && (
                    <div className="profile-lang-list" role="listbox">
                      {LANGS.map(l => (
                        <button
                          key={l.code}
                          type="button"
                          role="option"
                          aria-selected={i18n.language === l.code}
                          className={`profile-lang-item${i18n.language === l.code ? ' profile-lang-item--on' : ''}`}
                          onClick={() => { setLocale(l.code); setLangOpen(false) }}
                        >
                          <span className="profile-lang-item-flag">{l.flag}</span>
                          <span className="profile-lang-item-name">{l.name}</span>
                          {i18n.language === l.code && <span className="profile-lang-item-check" aria-hidden="true">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {/* Filter pills */}
          <div className="profile-tabs">
            {PROFILE_TABS.map(key => (
              <button
                key={key}
                className={`profile-tab-pill${activeTab === key ? ' profile-tab-pill--active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab: Interests ── */}
        {activeTab === 'interests' && (
          <>
            <div className="profile-card profile-fields">
              <div className="modal-field">
                <label className="modal-label">{t('fields.username')}</label>
                <div className="username-input-row">
                  <span className="username-at">@</span>
                  <input
                    className="modal-input username-input"
                    type="text"
                    value={username}
                    onChange={e => handleUsernameChange(e.target.value)}
                    maxLength={20}
                    placeholder={t('fields.usernamePlaceholder')}
                    autoComplete="off"
                    autoCapitalize="none"
                  />
                </div>
                {uStatus === 'checking'  && <span className="username-hint username-hint--muted">{t('fields.checking')}</span>}
                {uStatus === 'available' && <span className="username-hint username-hint--ok">{t('fields.available', { username })}</span>}
                {(uStatus === 'taken' || uStatus === 'invalid') && uReason && (
                  <span className="username-hint username-hint--bad">{uReason}</span>
                )}
              </div>

              <div className="modal-field">
                <label className="modal-label">{t('fields.aboutMe')} <span className="modal-label-muted">{t('fields.charsLeft', { count: 150 - aboutMe.length })}</span></label>
                <textarea
                  className="modal-input modal-textarea"
                  value={aboutMe}
                  onChange={e => setAboutMe(e.target.value)}
                  maxLength={150}
                  rows={2}
                  placeholder={t('fields.aboutPlaceholder')}
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">{t('fields.email')} <span className="modal-label-muted">{t('fields.readOnly')}</span></label>
                <input
                  className="modal-input modal-input--muted"
                  type="email"
                  value={account.email ?? ''}
                  readOnly
                />
              </div>

              {/* PR48 - Home city is the GEO-resolved current city
                  (not a free-text field). Read-only for the regular
                  tier; Legend (host badge) can tap to open the picker
                  and switch. */}
              <div className="modal-field">
                <label className="modal-label">{t('fields.homeCity')}</label>
                {isLegend ? (
                  <button
                    type="button"
                    className="modal-input modal-input--tappable"
                    onClick={() => setCityPickerOpen(true)}
                    style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                  >
                    <span>{currentCityName ? localizeCityName(currentCityName) : t('fields.homeCityPlaceholder')}</span>
                    <span aria-hidden="true" style={{ color: 'var(--muted2)' }}>▾</span>
                  </button>
                ) : (
                  <input
                    className="modal-input"
                    type="text"
                    value={currentCityName ? localizeCityName(currentCityName) : ''}
                    placeholder={t('fields.homeCityPlaceholder')}
                    readOnly
                    aria-readonly="true"
                  />
                )}
              </div>

              <div className="modal-field">
                <label className="modal-label">{t('fields.age')}</label>
                <input
                  className="modal-input"
                  type="number"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  min={18}
                  max={100}
                  placeholder={t('fields.agePlaceholder')}
                />
              </div>

              <div className="modal-field">
                <label className="modal-label">{t('fields.myVibe')}</label>
                <div className="vibe-grid">
                  {VIBES.map(v => (
                    <button
                      key={v.key}
                      type="button"
                      className={`vibe-chip${vibe === v.key ? ' vibe-chip--on' : ''}`}
                      onClick={() => setVibe(v.key)}
                    >
                      {v.emoji} {t(`vibes.${v.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-field">
                <label className="modal-label">
                  {t('fields.interests')}
                  <span className="modal-label-muted"> {t('fields.interestsHint')}</span>
                </label>
                <div className="interest-grid">
                  {INTERESTS.map(i => (
                    <button
                      key={i}
                      type="button"
                      className={`interest-chip${interests.has(i) ? ' interest-chip--on' : ''}`}
                      onClick={() => toggleInterest(i)}
                    >
                      {t(`interests.${i}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {account.isAmbassador && (
              <div className="profile-card profile-fields">
                <p className="me-section-label">{t('ambassador.title')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '-4px 0 8px' }}>
                  {t('ambassador.subtitle')}
                </p>
                {AMBASSADOR_PICKS.map(({ key, emoji, maxLen }) => {
                  const [val, set] = pickState[key]
                  return (
                    <div key={key} className="modal-field">
                      <label className="modal-label">{emoji} {t(`ambassador.${key}`)}</label>
                      <textarea
                        className="modal-input"
                        value={val}
                        onChange={e => set(e.target.value)}
                        maxLength={maxLen}
                        placeholder={t(`ambassador.${key}Placeholder`)}
                        rows={2}
                        style={{ resize: 'none' }}
                      />
                    </div>
                  )
                })}
              </div>
            )}

          </>
        )}

        {/* ── Tab: Challenges (created + accepted) ── */}
        {activeTab === 'challenges' && (() => {
          const filteredChallenges = challengeSubTab === 'all'
            ? myChallenges
            : myChallenges.filter(c => (c.mode ?? 'local') === challengeSubTab)
          return (
            <div className="profile-card">
              {/* PR2 - entry-point to per-acceptance threads */}
              {/* PR52 - explicit text color (var(--text)); the inherited
                  user-agent <button> color rendered as solid black on
                  the dark surface, making the title invisible. */}
              {onOpenThreads && (
                <button
                  type="button"
                  className="my-event-row-body"
                  onClick={onOpenThreads}
                  style={{ width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, padding: '12px 0', marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--text)' }}
                >
                  <span style={{ fontSize: 18 }}>💬</span>
                  <span style={{ flex: 1, textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>{t('threads.title', { ns: 'challenge' })}</span>
                  <span style={{ color: 'var(--muted, #b3b3b3)' }}>›</span>
                </button>
              )}

              {/* Mode sub-tabs - All / Local / International. */}
              <div className="challenge-type-chips" role="tablist" aria-label={t('modeFilter.label', { ns: 'challenge' })} style={{ padding: '4px 0 8px' }}>
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
                ? <p className="profile-tab-empty">{t('challenges.empty')}</p>
                : filteredChallenges.map(c => (
                    <div key={c.id} className="my-event-row">
                      <button className="my-event-row-body" onClick={() => onOpenChallenge?.(c)}>
                        <span className="my-event-title">
                          {CHALLENGE_TYPE_ICONS[c.challenge_type] ?? '🔥'} {c.title}
                        </span>
                        <span className="my-event-meta">
                          {(c.mode ?? 'local') === 'international'
                            ? `🌐 ${t('mode.international', { ns: 'challenge' })}`
                            : (c.audience === 'locals'
                                ? t('forLocals',    { ns: 'challenge' })
                                : t('forExplorers', { ns: 'challenge' }))}
                        </span>
                        <span className={`my-event-badge ${c.status === 'validated' ? 'my-event-badge--recurring' : 'my-event-badge--open'}`}>
                          {c.status === 'validated'
                            ? t('validatedBadge', { ns: 'challenge' })
                            : t('openBadge',      { ns: 'challenge' })}
                        </span>
                        {c.is_owner && <span className="profile-host-tag">{t('challenges.challenger')}</span>}
                      </button>
                    </div>
                  ))
              }
            </div>
          )
        })()}

        {/* ── Tab: Hangouts ── */}
        {activeTab === 'hangouts' && (
          <div className="profile-card">
            {myHangouts.length === 0
              ? <p className="profile-tab-empty">{t('hangouts.empty')}</p>
              : myHangouts.map(h => (
                  <div key={h.id} className="my-event-row">
                    <button className="my-event-row-body" onClick={() => onOpenHangout?.(h)}>
                      <span className="my-event-title">{HANGOUT_ICONS[h.category] ?? '💬'} {h.title}</span>
                      {h.is_owner && <span className="profile-host-tag">{t('hangouts.host')}</span>}
                    </button>
                  </div>
                ))
            }
          </div>
        )}

        {/* ── Tab: Events (Going + Hosting) ── */}
        {activeTab === 'events' && (() => {
          const gid        = account.guest_id
          const goingEvts  = (myEvents ?? []).filter(ev => ev.guest_id !== gid)
          const hostingEvts = (myEvents ?? []).filter(ev => ev.guest_id === gid)
          const renderRow  = (ev, canDelete) => {
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
                    {isLive ? t('events.live') : (ev.recurrence_label ? t('events.recurring') : t('events.upcoming'))}
                  </span>
                </button>
                {canDelete && (
                  <button className="my-event-delete" onClick={() => onDeleteEvent?.(ev)} aria-label={t('events.deleteEvent')}>✕</button>
                )}
              </div>
            )
          }
          return (
            <div className="profile-card">
              <p className="me-section-label">{t('events.going')}</p>
              {goingEvts.length === 0
                ? <p className="profile-tab-empty">{t('events.goingEmpty')}</p>
                : goingEvts.map(ev => renderRow(ev, false))
              }
              <p className="me-section-label" style={{ marginTop: 16 }}>{t('events.hosting')}</p>
              {hostingEvts.length === 0
                ? <p className="profile-tab-empty">{t('events.hostingEmpty')}</p>
                : hostingEvts.map(ev => renderRow(ev, true))
              }
            </div>
          )
        })()}

        {/* ── Tab: Friends ── */}
        {activeTab === 'friends' && (
          <>
          <button
            type="button"
            className="me-friend-req-row"
            onClick={() => onOpenFriendRequests?.()}
          >
            <span className="me-friend-req-icon">👤+</span>
            <span className="me-friend-req-label">{t('friends.requests')}</span>
            {friendRequestCount > 0 && (
              <span className="me-friend-req-badge">{friendRequestCount > 9 ? '9+' : friendRequestCount}</span>
            )}
            <span className="me-friend-req-chev">›</span>
          </button>
          <div className="profile-card">
            <p className="me-section-label">{t('friends.mine')}</p>
            {myFriends === null || myFriends.length === 0 ? (
              <p className="profile-tab-empty">{t('friends.empty')}</p>
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
                      ? <img className="my-friend-avatar" src={thumbUrl(f.thumbAvatarUrl ?? f.avatarUrl)} alt={f.displayName} />
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
          </>
        )}

        {/* ── Tab: Vibes ── */}
        {activeTab === 'vibes' && !vibesLoading && (
          <div className="profile-card">
            <p className="me-section-label">{t('vibesTab.received')}</p>
            {myVibeCount > 0 && (
              <div className="pub-profile-vibe-score">
                <div className="pub-profile-vibe-stars">
                  {[1,2,3,4,5].map(s => (
                    <span key={s} className={s <= Math.round(myVibeScore) ? 'vibe-star vibe-star--on' : 'vibe-star'}>★</span>
                  ))}
                </div>
                <span className="pub-profile-vibe-avg">{t('vibesTab.score', { score: myVibeScore?.toFixed(1) })}</span>
                <span className="pub-profile-vibe-count">{t('vibesTab.basedOn', { count: myVibeCount })}</span>
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
                <p>{t('vibesTab.empty')}</p>
                <p>{t('vibesTab.emptyHint')}</p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'vibes' && vibesLoading && (
          <p className="conv-loading">{t('common:loading')}</p>
        )}

      </div>

      {/* ══ STICKY: Save CTA ════════════════════════════════════════════════ */}
      <div className="profile-sticky-cta">
        {error && <p className="profile-sticky-error">{error}</p>}
        <button
          className="modal-submit profile-sticky-save"
          onClick={handleSave}
          disabled={saving || uploading || !username.trim()}
        >
          {uploading ? t('save.uploading') : saving ? t('save.saving') : saved ? t('save.saved') : t('save.save')}
        </button>
        <div className="profile-sticky-bottom-row">
          <button className="profile-sticky-signout" onClick={onSignOut} type="button">{t('signOut')}</button>
          <button className="profile-sticky-delete" onClick={() => { setShowDeleteConfirm(true); setDeleteError(null) }} type="button">
            {t('deleteAccount')}
          </button>
        </div>
      </div>

      {/* ══ Delete account confirmation overlay ═════════════════════════════ */}
      {showDeleteConfirm && (
        <div className="delete-account-overlay" onClick={() => !deleteLoading && setShowDeleteConfirm(false)}>
          <div className="delete-account-sheet" onClick={e => e.stopPropagation()}>
            <p className="delete-account-icon">⚠️</p>
            <h3 className="delete-account-title">{t('delete.title')}</h3>
            <p className="delete-account-body">
              {t('delete.body')}
              <br /><br />
              <strong>{t('delete.irreversible')}</strong>
            </p>
            {deleteError && <p className="delete-account-error">{deleteError}</p>}
            <button className="delete-account-confirm" onClick={handleDeleteAccount} disabled={deleteLoading}>
              {deleteLoading ? t('delete.deleting') : t('delete.confirm')}
            </button>
            <button className="delete-account-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleteLoading}>
              {t('delete.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* PR48 - Legend-only city picker. Selecting a city posts to
          /me/city via the host's onCityChange callback; the host
          updates `account.current_city_id` so the field re-renders
          with the new name on next paint. */}
      {isLegend && (
        <LeaderboardCityPickerModal
          visible={cityPickerOpen}
          selectedChannelId={currentCityChannelId}
          onSelect={(channelId) => {
            setCityPickerOpen(false)
            const wrappedId = `city_${channelId}`
            if (typeof onCityChange === 'function') onCityChange(wrappedId)
          }}
          onClose={() => setCityPickerOpen(false)}
        />
      )}
    </div>
  )
}
