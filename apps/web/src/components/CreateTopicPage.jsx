import { useState } from 'react'
import { createTopic, updateTopic, HangoutLimitError } from '../api'
import BackButton from './BackButton'

const CATEGORIES = [
  { value: 'general', label: 'General',  icon: '🗣️' },
  { value: 'tips',    label: 'Tips',     icon: '💡' },
  { value: 'food',    label: 'Food',     icon: '🍴' },
  { value: 'drinks',  label: 'Drinks',   icon: '🍺' },
  { value: 'help',    label: 'Help',     icon: '🙋' },
  { value: 'meetup',  label: 'Meet up',  icon: '👋' },
]

export default function CreateTopicPage({ channelId, guest, onCreated, onUpdated, onBack, userLocation, editTopic, onGoToHangout }) {
  const isEdit = !!editTopic
  const [category,    setCategory]    = useState(editTopic?.category ?? 'general')
  const [title,       setTitle]       = useState(editTopic?.title ?? '')
  const [description, setDescription] = useState(editTopic?.description ?? '')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState(null)
  // Set when the server rejects a new hangout because the user already has one.
  const [limitTopic,  setLimitTopic]  = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        const topic = await updateTopic(editTopic.id, guest.guestId, t, description.trim() || null, category)
        onUpdated?.(topic)
        return
      }
      // Hangout's location = creator's location (the coords captured at boot
      // geolocation). Null when geolocation is off → no distance, no block.
      const topic = await createTopic(channelId, guest.guestId, t, description.trim() || null, category, userLocation ?? null)
      onCreated(topic)
    } catch (err) {
      // One-hangout-per-user: surface the existing hangout instead of an error.
      if (err instanceof HangoutLimitError) {
        setLimitTopic({ id: err.existingTopicId, title: err.existingTitle || 'your hangout' })
      } else {
        setError(err.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (limitTopic) {
    return (
      <div className="full-page">
        <div className="page-header">
          <BackButton onClick={onBack} />
          <span className="page-title">One at a time</span>
        </div>
        <div className="topic-gated">
          <span className="topic-gated-emoji">⚡</span>
          <strong className="topic-gated-title">You already have a hangout</strong>
          <span className="topic-gated-sub">
            You can run one hangout at a time. Head to “{limitTopic.title}”, or delete it to start a new one.
          </span>
          <button className="topic-join-btn" onClick={() => onGoToHangout?.(limitTopic.id)}>Go to my hangout →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{isEdit ? 'Edit hangout' : 'Start a hangout'}</span>
      </div>

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Category */}
          <div className="cef-section">
            <p className="cef-label">Category</p>
            <div className="cef-category-grid">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  className={`cef-cat-btn${category === cat.value ? ' selected' : ''}`}
                  onClick={() => setCategory(cat.value)}
                >
                  <span style={{ fontSize: 22 }}>{cat.icon}</span>
                  <span className="cef-cat-label">{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="cef-section">
            <label className="cef-label">What's on your mind?</label>
            <input
              className="cef-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Best coffee spot in the area?"
              maxLength={100}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="cef-section">
            <label className="cef-label">Add details <span style={{ color: 'var(--muted, #888)', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              className="cef-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Give it some context…"
              maxLength={300}
              rows={3}
              style={{ resize: 'none', lineHeight: 1.5 }}
            />
          </div>

          {/* Expiry note */}
          {!isEdit && (
            <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0', textAlign: 'center' }}>
              ⏱ Auto-expires in 24 h
            </p>
          )}

          {error && <p className="cef-error">{error}</p>}

          <button
            type="submit"
            className="cef-submit"
            disabled={submitting || !title.trim()}
          >
            {submitting ? (isEdit ? 'Saving…' : 'Starting…') : (isEdit ? 'Save changes' : 'Start a hangout ⚡')}
          </button>

        </form>
      </div>
    </div>
  )
}
