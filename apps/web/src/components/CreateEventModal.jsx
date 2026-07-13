import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { requestFeatureLocation } from '../lib/gpsFeature'
import { createEvent, createEventSeries, updateEvent, deleteEvent, EventLimitReachedError } from '../api'
import { EVENT_TYPES } from '../cityMeta'
import BackButton from './BackButton'
import LocationPicker from './LocationPicker'

// ── Time helpers ───────────────────────────────────────────────────────────────

// Convert a unix timestamp back to HH:MM in the given timezone (for pre-filling edit form).
function unixToTimeStr(unixTs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixTs * 1000))
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

function getDefaultTime(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  let h = parseInt(p.hour === '24' ? '0' : p.hour)
  let m = parseInt(p.minute)
  if (m < 30) { m = 30 } else { m = 0; h = (h + 1) % 24 }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Add hours to an HH:MM string, wrapping past midnight.
function addHoursToTime(timeStr, hours) {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + hours * 60
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Resolve a (date, time) pair in the city's timezone to a unix timestamp.
 *
 * @param timezone IANA tz, e.g. "Europe/Lisbon"
 * @param timeStr  "HH:MM" 24h
 * @param dateStr  optional "YYYY-MM-DD" - defaults to today in `timezone`
 */
function cityTimeToUnix(timezone, timeStr, dateStr = null) {
  const day = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const naive = new Date(`${day}T${timeStr}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(naive)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  const cityAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}Z`)
  const offsetMs = cityAsUtc.getTime() - naive.getTime()
  return Math.floor((naive.getTime() - offsetMs) / 1000)
}

/** Today / tomorrow as YYYY-MM-DD strings in the given timezone. */
function todayInCity(tz)    { return new Date().toLocaleDateString('en-CA', { timeZone: tz }) }
function tomorrowInCity(tz) {
  const t = new Date(); t.setDate(t.getDate() + 1)
  return t.toLocaleDateString('en-CA', { timeZone: tz })
}

// ── Category icons ─────────────────────────────────────────────────────────────

const P = {
  width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.75',
  strokeLinecap: 'round', strokeLinejoin: 'round',
}

function IconDrinks() {
  return (
    <svg {...P}>
      {/* Wine glass bowl */}
      <path d="M6 3h12l-2.5 8a4.5 4.5 0 0 1-9 0L6 3z" />
      {/* Stem */}
      <line x1="12" y1="15" x2="12" y2="20" />
      {/* Base */}
      <line x1="9" y1="20" x2="15" y2="20" />
    </svg>
  )
}

function IconParty() {
  return (
    <svg {...P}>
      {/* Radiant burst */}
      <line x1="12" y1="2"   x2="12" y2="5.5" />
      <line x1="12" y1="18.5" x2="12" y2="22" />
      <line x1="2"   y1="12" x2="5.5" y2="12" />
      <line x1="18.5" y1="12" x2="22" y2="12" />
      <line x1="5.3"  y1="5.3"  x2="7.8" y2="7.8" />
      <line x1="16.2" y1="16.2" x2="18.7" y2="18.7" />
      <line x1="5.3"  y1="18.7" x2="7.8" y2="16.2" />
      <line x1="16.2" y1="7.8"  x2="18.7" y2="5.3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconMusic() {
  return (
    <svg {...P}>
      <path d="M9 18V7l11-2v11" />
      <circle cx="6"  cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  )
}

function IconFood() {
  return (
    <svg {...P}>
      {/* Fork */}
      <line x1="10" y1="2" x2="10" y2="22" />
      <path d="M7 2v6a3 3 0 0 0 6 0V2" />
      {/* Knife */}
      <line x1="17" y1="2" x2="17" y2="22" />
      <path d="M14 2c0 3 3 4 3 6" />
    </svg>
  )
}

function IconCoffee() {
  return (
    <svg {...P}>
      {/* Cup */}
      <path d="M6 9h12l-1.5 10a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2L6 9z" />
      {/* Handle */}
      <path d="M18 11h2a2 2 0 0 1 0 4h-2" />
      {/* Steam */}
      <path d="M10 5c0 2 2 2 2 4" />
      <path d="M14 5c0 2 2 2 2 4" />
    </svg>
  )
}

function IconSport() {
  return (
    <svg {...P}>
      {/* Lightning bolt - energy, action */}
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function IconMeetup() {
  return (
    <svg {...P}>
      {/* Two speech bubbles */}
      <path d="M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3 3v-3H5a2 2 0 0 1-2-2V6z" />
      <path d="M17 9h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2v2l-2.5-2" />
    </svg>
  )
}

function IconOther() {
  return (
    <svg {...P}>
      {[5, 12, 19].flatMap(cy =>
        [5, 12, 19].map(cx => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" fill="currentColor" stroke="none" />
        ))
      )}
    </svg>
  )
}

const CATEGORY_ICONS = {
  drinks: IconDrinks,
  party:  IconParty,
  music:  IconMusic,
  food:   IconFood,
  coffee: IconCoffee,
  sport:  IconSport,
  meetup: IconMeetup,
  other:  IconOther,
}

// ── Component ──────────────────────────────────────────────────────────────────

// Labels resolved via i18n at render; `tk` is the translation key in the
// `event` namespace (presets.<tk> + presets.<tk>Desc).
const QUICK_PRESETS = [
  { key: 'daily_spot',    tk: 'dailySpot',    emoji: '☀️', recurrence: 'daily',  startTime: '18:00', endTime: '21:00', weekdays: null },
  { key: 'every_evening', tk: 'everyEvening', emoji: '🌙', recurrence: 'daily',  startTime: '20:00', endTime: '23:00', weekdays: null },
  { key: 'weekends',      tk: 'weekends',     emoji: '🎉', recurrence: 'weekly', startTime: null,    endTime: null,    weekdays: [0, 6] },
]

// Recurrence options - value drives logic, tk is the i18n key.
const RECURRENCE_OPTS = [
  { value: 'once',         tk: 'once' },
  { value: 'daily',        tk: 'daily' },
  { value: 'weekly',       tk: 'weekly' },
  { value: 'every_n_days', tk: 'everyNDays' },
]

export default function CreateEventPage({ channelId, guest, nickname, cityTimezone, account, onCreated, onBack, onDeleted, onLimitReached, editEvent }) {
  const { t } = useTranslation('event')
  const tz = cityTimezone || 'UTC'
  const isEdit = !!editEvent
  const [type, setType] = useState(() => editEvent?.type || 'other')
  const [title, setTitle] = useState(() => editEvent?.title || '')
  // selectedDate carries the day-of-event in city tz as YYYY-MM-DD. Default
  // is "today" - chips below let the user flip to tomorrow or pick any date
  // in the next 6 months. Edit mode pre-fills from the event's existing
  // starts_at; create mode starts on today (the most-discoverable path).
  const [selectedDate, setSelectedDate] = useState(() => {
    if (editEvent) {
      const d = new Date(editEvent.starts_at * 1000)
      return d.toLocaleDateString('en-CA', { timeZone: tz })
    }
    return todayInCity(tz)
  })
  const [startTime, setStartTime] = useState(() => editEvent ? unixToTimeStr(editEvent.starts_at, tz) : getDefaultTime(tz))
  const [endTime, setEndTime] = useState(() => editEvent ? unixToTimeStr(editEvent.ends_at || editEvent.expires_at, tz) : addHoursToTime(getDefaultTime(tz), 2))
  const [location, setLocation] = useState(() => editEvent?.location_hint || editEvent?.location || '')
  // Precise coords from the map picker (optional). Pre-fill from the event being
  // edited so re-opening the picker centers on its existing spot.
  const [locationCoords, setLocationCoords] = useState(() =>
    (typeof editEvent?.venue_lat === 'number' && typeof editEvent?.venue_lng === 'number')
      ? { lat: editEvent.venue_lat, lng: editEvent.venue_lng }
      : null,
  )
  const [pickerCenter, setPickerCenter] = useState(null)  // {lat,lng} → picker open
  const [locating,     setLocating]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Recurrence state (registered users only)
  const [recurrence, setRecurrence] = useState('once') // 'once' | 'daily' | 'weekly' | 'every_n_days'
  const [recurExpanded, setRecurExpanded] = useState(false) // Repeat section collapsed by default (one-shot)
  const [weekdays, setWeekdays] = useState([])           // [0-6] for weekly
  const [intervalDays, setIntervalDays] = useState(2)    // for every_n_days
  const [selectedPreset, setSelectedPreset] = useState(null)

  const isLocal = account?.mode === 'local'

  // Date chip helpers - "today" / "tomorrow" / "Pick a date" mirror native UX.
  const todayStr    = todayInCity(tz)
  const tomorrowStr = tomorrowInCity(tz)
  const maxDateStr  = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6)
    return d.toLocaleDateString('en-CA', { timeZone: tz })
  })()
  const isToday    = selectedDate === todayStr
  const isTomorrow = selectedDate === tomorrowStr
  const isCustom   = !isToday && !isTomorrow

  function applyPreset(preset) {
    if (selectedPreset === preset.key) { setSelectedPreset(null); return }
    setSelectedPreset(preset.key)
    setRecurrence(preset.recurrence)
    setRecurExpanded(true) // presets set a recurrence → reveal the Repeat options
    if (preset.startTime) setStartTime(preset.startTime)
    if (preset.endTime)   setEndTime(preset.endTime)
    if (preset.weekdays)  setWeekdays(preset.weekdays)
  }

  function toggleWeekday(dow) {
    setWeekdays(prev =>
      prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]
    )
  }

  // Open the shared map picker. Re-edit: center on the chosen spot. New: use
  // the browser's current position (the web picker has no GPS auto-refine).
  async function handleOpenLocation() {
    if (locationCoords) { setPickerCenter(locationCoords); return }
    setLocating(true)
    setError(null)
    const res = await requestFeatureLocation('event_location')
    if (res.ok) setPickerCenter(res.coords)
    else if (res.reason === 'unsupported') setError(t('errors.locUnavailable'))
    else setError(t('errors.locFailed'))
    setLocating(false)
  }

  function handleLocationConfirm({ place, address, lat, lng }) {
    setPickerCenter(null)
    const label = address ? (place && !address.startsWith(place) ? `${place} - ${address}` : address) : place
    setLocation(label)
    setLocationCoords({ lat, lng })
  }

  function clearLocation() {
    setLocation('')
    setLocationCoords(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t || !startTime || !endTime) return

    // ── Edit mode ──────────────────────────────────────────────────────────────
    if (isEdit) {
      let startsAtUnix = cityTimeToUnix(tz, startTime, selectedDate)
      let endsAtUnix   = cityTimeToUnix(tz, endTime,   selectedDate)
      if (endsAtUnix <= startsAtUnix) endsAtUnix += 86400
      if (endsAtUnix - startsAtUnix < 15 * 60) {
        setError(t('errors.endAfterStart'))
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        const updated = await updateEvent(editEvent.id, guest.guestId, {
          title: t,
          location_hint: location.trim() || null,
          starts_at: startsAtUnix,
          ends_at: endsAtUnix,
          type,
        })
        onCreated(updated)
      } catch (err) {
        setError(err.message)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // ── Create mode: one-time event ────────────────────────────────────────────
    if (recurrence === 'once') {
      let startsAtUnix = cityTimeToUnix(tz, startTime, selectedDate)
      let endsAtUnix   = cityTimeToUnix(tz, endTime,   selectedDate)
      if (endsAtUnix <= startsAtUnix) endsAtUnix += 86400
      if (endsAtUnix - startsAtUnix < 15 * 60) {
        setError(t('errors.endAfterStart'))
        return
      }

      setSubmitting(true)
      setError(null)
      try {
        const newEvent = await createEvent(
          channelId,
          guest.guestId,
          nickname,
          t,
          location.trim() || null,
          startsAtUnix,
          endsAtUnix,
          type,
          locationCoords?.lat,
          locationCoords?.lng,
        )
        onCreated(newEvent)
      } catch (err) {
        if (err instanceof EventLimitReachedError) {
          onLimitReached?.()
          return
        }
        setError(err.message)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // Recurring event
    if (recurrence === 'weekly' && weekdays.length === 0) {
      setError(t('errors.pickDay'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        title: t,
        location_hint: location.trim() || null,
        start_time: startTime,
        end_time: endTime,
        type,
        recurrence_type: recurrence,
        weekdays: recurrence === 'weekly' ? weekdays : undefined,
        interval_days: recurrence === 'every_n_days' ? intervalDays : undefined,
        // Anchors the recurrence series to the picked start date - backend
        // accepts YYYY-MM-DD; defaults to today server-side if omitted.
        starts_on: selectedDate,
      }
      const result = await createEventSeries(channelId, guest.guestId, payload)
      // Return the first upcoming occurrence so the caller can open it
      if (result.first_event) {
        onCreated(result.first_event)
      } else {
        onBack()
      }
    } catch (err) {
      if (err instanceof EventLimitReachedError) {
        onLimitReached?.()
        return
      }
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteEvent(editEvent.id, guest.guestId)
      onDeleted?.(editEvent.id)
    } catch (err) {
      setDeleting(false)
      setShowConfirm(false)
      setError(err.message || t('errors.deleteFailed'))
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{isEdit ? t('title.edit') : isLocal ? t('title.host') : t('title.create')}</span>
      </div>

      {showConfirm && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <p className="delete-confirm-title">{t('delete.confirmTitle')}</p>
            <p className="delete-confirm-body">{t('delete.confirmBody')}</p>
            <div className="delete-confirm-actions">
              <button
                className="delete-confirm-cancel"
                onClick={() => setShowConfirm(false)}
                disabled={deleting}
              >
                {t('delete.cancel')}
              </button>
              <button
                className="delete-confirm-ok"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? t('delete.deleting') : t('delete.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Quick presets - local hosts only, not in edit mode */}
          {isLocal && !isEdit && (
            <div className="cef-section">
              <p className="cef-label">{t('quickStart')}</p>
              <div className="cef-preset-row">
                {QUICK_PRESETS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    className={`cef-preset-btn${selectedPreset === p.key ? ' selected' : ''}`}
                    onClick={() => applyPreset(p)}
                  >
                    <span className="cef-preset-emoji">{p.emoji}</span>
                    <span className="cef-preset-label">{t(`presets.${p.tk}`)}</span>
                    <span className="cef-preset-desc">{t(`presets.${p.tk}Desc`)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category */}
          <div className="cef-section">
            <p className="cef-label">{t('category')}</p>
            <div className="cef-category-grid">
              {EVENT_TYPES.map(et => {
                const Icon = CATEGORY_ICONS[et.value]
                return (
                  <button
                    key={et.value}
                    type="button"
                    className={`cef-cat-btn${type === et.value ? ' selected' : ''}`}
                    onClick={() => setType(et.value)}
                  >
                    {Icon && <Icon />}
                    <span className="cef-cat-label">{t(`categories.${et.value}`, et.label)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div className="cef-section">
            <label className="cef-label">{t('titleLabel')}</label>
            <input
              className="cef-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              maxLength={100}
            />
          </div>

          {/* Date - when does it happen? Editable in both create and edit. */}
          <div className="cef-section">
            <p className="cef-label">{t('date')}</p>
            <div className="cef-date-row">
              <button
                type="button"
                className={`cef-date-chip${isToday ? ' selected' : ''}`}
                onClick={() => setSelectedDate(todayStr)}
              >
                {t('today')}
              </button>
              <button
                type="button"
                className={`cef-date-chip${isTomorrow ? ' selected' : ''}`}
                onClick={() => setSelectedDate(tomorrowStr)}
              >
                {t('tomorrow')}
              </button>
              <input
                type="date"
                className={`cef-date-input${isCustom ? ' selected' : ''}`}
                value={selectedDate}
                min={todayStr}
                max={maxDateStr}
                onChange={e => e.target.value && setSelectedDate(e.target.value)}
              />
            </div>
            {isToday && !isEdit && (
              <p className="cef-date-hint">{t('todayHint')}</p>
            )}
          </div>

          {/* Start + End time */}
          <div className="cef-row">
            <div className="cef-section">
              <label className="cef-label">{t('starts')}</label>
              <input
                className="cef-input"
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="cef-section">
              <label className="cef-label">{t('ends')}</label>
              <input
                className="cef-input"
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Recurrence - registered users only, not available in edit mode */}
          {account && !isEdit && (
            <div className="cef-section">
              {/* Collapsed = one-shot ('once'); expand to pick a recurrence. */}
              <button type="button" className="cef-repeat-header" onClick={() => setRecurExpanded(v => !v)}>
                <span className="cef-label" style={{ margin: 0 }}>{t('repeat')}</span>
                <span className="cef-repeat-header-right">
                  {recurrence !== 'once' && (
                    <span className="cef-repeat-summary">{t(`recurrence.${RECURRENCE_OPTS.find(o => o.value === recurrence)?.tk}`)}</span>
                  )}
                  <span className="cef-repeat-chevron">{recurExpanded ? '▲' : '▼'}</span>
                </span>
              </button>
              {recurExpanded && (
                <div className="cef-recurrence-row">
                  {RECURRENCE_OPTS.filter(o => o.value !== 'once').map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`cef-recur-btn${recurrence === opt.value ? ' selected' : ''}`}
                      // Tap the active option again to go back to one-shot.
                      onClick={() => setRecurrence(recurrence === opt.value ? 'once' : opt.value)}
                    >
                      {t(`recurrence.${opt.tk}`)}
                    </button>
                  ))}
                </div>
              )}

              {recurExpanded && recurrence === 'weekly' && (
                <div className="cef-weekday-row">
                  {t('weekdays', { returnObjects: true }).map((label, dow) => (
                    <button
                      key={dow}
                      type="button"
                      className={`cef-day-btn${weekdays.includes(dow) ? ' selected' : ''}`}
                      onClick={() => toggleWeekday(dow)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {recurExpanded && recurrence === 'every_n_days' && (
                <div className="cef-interval-row">
                  <span className="cef-interval-label">{t('intervalEvery')}</span>
                  <input
                    className="cef-interval-input"
                    type="number"
                    min={2}
                    max={365}
                    value={intervalDays}
                    onChange={e => setIntervalDays(Math.max(2, Math.min(365, parseInt(e.target.value) || 2)))}
                  />
                  <span className="cef-interval-label">{t('intervalDays')}</span>
                </div>
              )}
            </div>
          )}

          {/* Location - tappable, opens the map picker (optional) */}
          <div className="cef-section">
            <label className="cef-label">{t('location')}</label>
            <button
              type="button"
              className="cef-loc-field"
              onClick={handleOpenLocation}
              disabled={locating}
            >
              <span className="cef-loc-icon" aria-hidden="true">📍</span>
              <span className={`cef-loc-text${location ? '' : ' cef-loc-placeholder'}`}>
                {locating ? t('locating') : (location || t('locationPlaceholder'))}
              </span>
              {location ? (
                <span
                  className="cef-loc-clear"
                  role="button"
                  tabIndex={0}
                  aria-label={t('clearLocation')}
                  onClick={e => { e.stopPropagation(); clearLocation() }}
                >✕</span>
              ) : (
                <span className="cef-loc-chevron" aria-hidden="true">›</span>
              )}
            </button>
          </div>

          {error && <p className="cef-error">{error}</p>}

          <button
            type="submit"
            className="cef-submit"
            disabled={submitting || !title.trim()}
          >
            {submitting
              ? (isEdit ? t('submit.saving') : t('submit.creating'))
              : isEdit
                ? t('submit.saveChanges')
                : isLocal
                  ? (recurrence !== 'once' ? t('submit.openSpot') : t('submit.startEvent'))
                  : t('submit.create')
            }
          </button>

          {isEdit && (
            <button
              type="button"
              className="cef-delete-btn"
              onClick={() => setShowConfirm(true)}
              disabled={submitting}
            >
              {t('delete.button')}
            </button>
          )}

        </form>
      </div>

      {/* Map location picker (shared with drop-my-spot; full-screen overlay) */}
      {pickerCenter && (
        <LocationPicker
          initialLat={pickerCenter.lat}
          initialLng={pickerCenter.lng}
          nickname={nickname}
          onConfirm={handleLocationConfirm}
          onClose={() => setPickerCenter(null)}
        />
      )}
    </div>
  )
}
