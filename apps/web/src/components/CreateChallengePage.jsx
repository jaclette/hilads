import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createChallenge, updateChallenge } from '../api'
import BackButton from './BackButton'

/**
 * Web equivalent of mobile's app/challenge/create.tsx. Same 3 fields per spec
 * (audience toggle + 4 type squares + title); orange brand accents to match
 * mobile CreateChallengeScreen. Reuses the existing .full-page / .page-header
 * / .cef-* class skeleton so it inherits CreateTopicPage styling instead of
 * shipping a new CSS layer.
 *
 * On submit: hits POST /channels/{cityId}/challenges (Phase 2 backend). On
 * success, calls onCreated(challenge) so the host App.jsx can route to the
 * just-created challenge via setActiveChallenge.
 */

const TYPES     = [
  { value: 'food',    icon: '🍜' },
  { value: 'place',   icon: '📍' },
  { value: 'culture', icon: '🎭' },
  { value: 'help',    icon: '🤝' },
]
const AUDIENCES = ['locals', 'explorers']

export default function CreateChallengePage({ channelId, guest, account, editChallenge = null, onCreated, onUpdated, onBack }) {
  const { t } = useTranslation('city')
  const isEdit = !!editChallenge

  // Edit mode pre-populates from the existing challenge; create starts fresh.
  const [audience,   setAudience]   = useState(editChallenge?.audience       ?? 'locals')
  const [type,       setType]       = useState(editChallenge?.challenge_type ?? 'food')
  const [title,      setTitle]      = useState(editChallenge?.title          ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        const updated = await updateChallenge(editChallenge.id, guest.guestId, trimmed, type, audience)
        onUpdated?.(updated)
      } else {
        const nickname = account?.display_name ?? guest?.nickname ?? null
        const challenge = await createChallenge(channelId, guest.guestId, nickname, trimmed, type, audience)
        onCreated?.(challenge)
      }
    } catch (err) {
      setError(err?.message || t('create.challengeErrStart'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('create.challengePageTitle')}</span>
      </div>

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Audience — 2 pills filling the row */}
          <div className="cef-section">
            <p className="cef-label">{t('create.challengeAudience')}</p>
            <div className="cef-audience-row">
              {AUDIENCES.map(a => (
                <button
                  key={a}
                  type="button"
                  className={`cef-audience-btn${audience === a ? ' selected' : ''}`}
                  onClick={() => setAudience(a)}
                >
                  {a === 'locals' ? t('create.challengeAudLocals') : t('create.challengeAudExplorers')}
                </button>
              ))}
            </div>
          </div>

          {/* Type — 4 emoji squares */}
          <div className="cef-section">
            <p className="cef-label">{t('create.challengeType')}</p>
            <div className="cef-type-grid">
              {TYPES.map(tp => (
                <button
                  key={tp.value}
                  type="button"
                  className={`cef-type-btn${type === tp.value ? ' selected' : ''}`}
                  onClick={() => setType(tp.value)}
                >
                  <span style={{ fontSize: 26 }}>{tp.icon}</span>
                  <span className="cef-type-label">
                    {tp.value === 'food'    ? t('create.challengeTypeFood')
                     : tp.value === 'place' ? t('create.challengeTypePlace')
                     : tp.value === 'culture' ? t('create.challengeTypeCulture')
                     :                        t('create.challengeTypeHelp')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="cef-section">
            <label className="cef-label">{t('create.challengeTitleLabel')}</label>
            <input
              className="cef-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('create.challengeTitlePlaceholder')}
              maxLength={100}
              autoFocus
            />
          </div>

          {error && <p className="cef-error">{error}</p>}

          {/* Submit — orange brand button (same colour as ChallengeChatPage's accept-btn) */}
          <button
            type="submit"
            className="cef-submit cef-submit--challenge"
            disabled={submitting || !title.trim()}
          >
            {submitting ? '…' : t('create.challengeCta')}
          </button>

        </form>
      </div>
    </div>
  )
}
