import { useState } from 'react'
import { createEvent } from '../api'
import { EVENT_TYPES } from '../cityMeta'

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

export default function CreateEventModal({ channelId, guest, nickname, cityTimezone, onCreated, onClose }) {
  const tz = cityTimezone || 'UTC'
  const [type, setType] = useState('other')
  const [title, setTitle] = useState('')
  const [time, setTime] = useState(() => getDefaultTime(tz))
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t || !time) return
    setSubmitting(true)
    setError(null)
    try {
      await createEvent(
        channelId,
        guest.guestId,
        nickname,
        t,
        location.trim() || null,
        cityTimeToUnix(tz, time),
        type,
      )
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Create event</span>
          <button className="city-picker-close" onClick={onClose}>✕</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="event-type-grid">
            {EVENT_TYPES.map(et => (
              <button
                key={et.value}
                type="button"
                className={`event-type-btn${type === et.value ? ' selected' : ''}`}
                onClick={() => setType(et.value)}
              >
                <span className="event-type-icon">{et.icon}</span>
                <span className="event-type-label">{et.label}</span>
              </button>
            ))}
          </div>
          <div className="modal-field">
            <label className="modal-label">Title</label>
            <input
              className="modal-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Jazz night at Rooftop Bar"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="modal-row">
            <div className="modal-field" style={{ flex: 1 }}>
              <label className="modal-label">Time (local)</label>
              <input
                className="modal-input"
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                required
              />
            </div>
            <div className="modal-field" style={{ flex: 1 }}>
              <label className="modal-label">Location (optional)</label>
              <input
                className="modal-input"
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Rooftop Bar"
                maxLength={100}
              />
            </div>
          </div>
          {error && <p className="modal-error">{error}</p>}
          <button type="submit" className="modal-submit" disabled={submitting || !title.trim()}>
            {submitting ? 'Creating…' : 'Create event'}
          </button>
        </form>
      </div>
    </div>
  )
}
