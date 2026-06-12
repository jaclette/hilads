import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createTopic, updateTopic, HangoutLimitError } from '../api'
import BackButton from './BackButton'

// Labels are translated at render via t(`create.cat.${value}`); icons stay here.
const CATEGORIES = [
  { value: 'general', icon: '🗣️' },
  { value: 'tips',    icon: '💡' },
  { value: 'food',    icon: '🍴' },
  { value: 'drinks',  icon: '🍺' },
  { value: 'help',    icon: '🙋' },
  { value: 'meetup',  icon: '👋' },
]

export default function CreateTopicPage({ channelId, guest, onCreated, onUpdated, onBack, userLocation, editTopic, onGoToHangout }) {
  const { t } = useTranslation('hangout')
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
        setLimitTopic({ id: err.existingTopicId, title: err.existingTitle || t('create.yourHangout') })
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
          <span className="page-title">{t('create.limitHeader')}</span>
        </div>
        <div className="topic-gated">
          <span className="topic-gated-emoji">🗣️</span>
          <strong className="topic-gated-title">{t('create.limitTitle')}</strong>
          <span className="topic-gated-sub">
            {t('create.limitSub', { title: limitTopic.title })}
          </span>
          <button className="topic-join-btn" onClick={() => onGoToHangout?.(limitTopic.id)}>{t('create.limitGo')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{isEdit ? t('create.editTitle') : t('create.startTitle')}</span>
      </div>

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Title */}
          <div className="cef-section">
            <label className="cef-label">{t('create.titleLabel')}</label>
            <input
              className="cef-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('create.titlePlaceholder')}
              maxLength={100}
              autoFocus
            />
          </div>

          {/* Expiry note */}
          {!isEdit && (
            <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0', textAlign: 'center' }}>
              {t('create.expiry')}
            </p>
          )}

          {error && <p className="cef-error">{error}</p>}

          <button
            type="submit"
            className="cef-submit"
            disabled={submitting || !title.trim()}
          >
            {submitting ? (isEdit ? t('create.saving') : t('create.starting')) : (isEdit ? t('create.saveChanges') : t('create.startCta'))}
          </button>

        </form>
      </div>
    </div>
  )
}
