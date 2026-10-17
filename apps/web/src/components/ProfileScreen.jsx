import { thumbUrl } from '../lib/imageThumb'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { updateProfile, uploadImage, deleteAccount, checkUsernameAvailability } from '../api'

import BackButton from './BackButton'
import { badgeLabel } from '../badgeMeta'
import LeaderboardCityPickerModal from './LeaderboardCityPickerModal'
import { isLegend as accountIsLegend } from '../lib/canCreateEvent'
import { localizeCityName } from '../i18n/cityName'
import AppearanceLanguageCard from './AppearanceLanguageCard'

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


const AMBASSADOR_PICKS = [
  { key: 'restaurant', emoji: '🍜', maxLen: 200 },
  { key: 'spot',       emoji: '🗺️', maxLen: 200 },
  { key: 'tip',        emoji: '💡', maxLen: 300 },
  { key: 'story',      emoji: '🎭', maxLen: 400 },
]

/**
 * Settings (W4, behind Passport's gear, like the app's settings screen):
 * photo, username, about, interests, age, vibe, mode, home city (Legends),
 * appearance and language, save, sign out, delete account. Friends and vibes
 * live in Passport → Friends now.
 */
export default function ProfileScreen({ account, onSave, onBack, onSignOut, onDeleteAccount, tabMode = false, renderAppHeader, city, cityChannelId, onCityChange }) {
  const { t } = useTranslation(['profile', 'common'])
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
  const [uploading,       setUploading]       = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [error,           setError]           = useState(null)
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


  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError,       setDeleteError]       = useState(null)
  const [deleteLoading,     setDeleteLoading]     = useState(false)

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
        <span className="page-title">{t('settings', { ns: 'common' })}</span>
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

          {/* Appearance (theme) + Language — shared with the guest Me view
              so members and guests get the identical pickers. */}
          <AppearanceLanguageCard account={account} />

        </div>

        {/* ── Tab: Interests ── */}
        {(
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
