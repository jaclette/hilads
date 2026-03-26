import { useState } from 'react'
import { createEvent, createEventSeries, updateEvent } from '../api'
import { EVENT_TYPES } from '../cityMeta'
import BackButton from './BackButton'

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

function cityTimeToUnix(timezone, timeStr) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const naive = new Date(`${today}T${timeStr}:00Z`)
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
      {/* Lightning bolt — energy, action */}
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

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CreateEventPage({ channelId, guest, nickname, cityTimezone, account, onCreated, onBack, editEvent }) {
  const tz = cityTimezone || 'UTC'
  const isEdit = !!editEvent
  const [type, setType] = useState(() => editEvent?.type || 'other')
  const [title, setTitle] = useState(() => editEvent?.title || '')
  const [startTime, setStartTime] = useState(() => editEvent ? unixToTimeStr(editEvent.starts_at, tz) : getDefaultTime(tz))
  const [endTime, setEndTime] = useState(() => editEvent ? unixToTimeStr(editEvent.ends_at || editEvent.expires_at, tz) : addHoursToTime(getDefaultTime(tz), 2))
  const [location, setLocation] = useState(() => editEvent?.location_hint || editEvent?.location || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Recurrence state (registered users only)
  const [recurrence, setRecurrence] = useState('once') // 'once' | 'daily' | 'weekly' | 'every_n_days'
  const [weekdays, setWeekdays] = useState([])           // [0-6] for weekly
  const [intervalDays, setIntervalDays] = useState(2)    // for every_n_days

  function toggleWeekday(dow) {
    setWeekdays(prev =>
      prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t || !startTime || !endTime) return

    // ── Edit mode ──────────────────────────────────────────────────────────────
    if (isEdit) {
      let startsAtUnix = cityTimeToUnix(tz, startTime)
      let endsAtUnix   = cityTimeToUnix(tz, endTime)
      if (endsAtUnix <= startsAtUnix) endsAtUnix += 86400
      if (endsAtUnix - startsAtUnix < 15 * 60) {
        setError('End time must be at least 15 minutes after start time')
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
      let startsAtUnix = cityTimeToUnix(tz, startTime)
      let endsAtUnix   = cityTimeToUnix(tz, endTime)
      if (endsAtUnix <= startsAtUnix) endsAtUnix += 86400
      if (endsAtUnix - startsAtUnix < 15 * 60) {
        setError('End time must be at least 15 minutes after start time')
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
        )
        onCreated(newEvent)
      } catch (err) {
        setError(err.message)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // Recurring event
    if (recurrence === 'weekly' && weekdays.length === 0) {
      setError('Pick at least one day of the week')
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
      }
      const result = await createEventSeries(channelId, guest.guestId, payload)
      // Return the first upcoming occurrence so the caller can open it
      if (result.first_event) {
        onCreated(result.first_event)
      } else {
        onBack()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{isEdit ? 'Edit event' : 'Create event'}</span>
      </div>

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Category */}
          <div className="cef-section">
            <p className="cef-label">Category</p>
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
                    <span className="cef-cat-label">{et.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title */}
          <div className="cef-section">
            <label className="cef-label">Title</label>
            <input
              className="cef-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Jazz night at Rooftop Bar"
              maxLength={100}
            />
          </div>

          {/* Start + End time */}
          <div className="cef-row">
            <div className="cef-section">
              <label className="cef-label">Starts</label>
              <input
                className="cef-input"
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="cef-section">
              <label className="cef-label">Ends</label>
              <input
                className="cef-input"
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Recurrence — registered users only, not available in edit mode */}
          {account && !isEdit && (
            <div className="cef-section">
              <p className="cef-label">Repeat</p>
              <div className="cef-recurrence-row">
                {[
                  { value: 'once',        label: 'Once' },
                  { value: 'daily',       label: 'Daily' },
                  { value: 'weekly',      label: 'Weekly' },
                  { value: 'every_n_days',label: 'Every N days' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`cef-recur-btn${recurrence === opt.value ? ' selected' : ''}`}
                    onClick={() => setRecurrence(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {recurrence === 'weekly' && (
                <div className="cef-weekday-row">
                  {WEEKDAY_LABELS.map((label, dow) => (
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

              {recurrence === 'every_n_days' && (
                <div className="cef-interval-row">
                  <span className="cef-interval-label">Every</span>
                  <input
                    className="cef-interval-input"
                    type="number"
                    min={2}
                    max={365}
                    value={intervalDays}
                    onChange={e => setIntervalDays(Math.max(2, Math.min(365, parseInt(e.target.value) || 2)))}
                  />
                  <span className="cef-interval-label">days</span>
                </div>
              )}
            </div>
          )}

          {/* Location */}
          <div className="cef-section">
            <label className="cef-label">Location</label>
            <input
              className="cef-input"
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Optional"
              maxLength={100}
            />
          </div>

          {error && <p className="cef-error">{error}</p>}

          <button
            type="submit"
            className="cef-submit"
            disabled={submitting || !title.trim()}
          >
            {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save changes' : 'Create event')}
          </button>

        </form>
      </div>
    </div>
  )
}
