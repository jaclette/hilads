import { useState } from 'react'
import { createEvent } from '../api'

export default function CreateEventModal({ channelId, guest, nickname, onCreated, onClose }) {
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    setSubmitting(true)
    setError(null)
    try {
      await createEvent(
        channelId,
        guest.guestId,
        nickname,
        t,
        location.trim() || null,
        Math.floor(Date.now() / 1000),
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
          <div className="modal-field">
            <label className="modal-label">Location (optional)</label>
            <input
              className="modal-input"
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Rooftop Bar, Main St"
              maxLength={100}
            />
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
