import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createChallenge, updateChallenge } from '../api'
import BackButton from './BackButton'

// Mirror backend ChallengeRepository::MAX_PARTICIPANTS_{MIN,MAX,DEFAULT}.
const MAX_P_MIN     = 1
const MAX_P_MAX     = 20
const MAX_P_DEFAULT = 3

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
const AUDIENCES = [
  // 'explorers' is kept as the technical key (DB value, API enum). The
  // user-visible label was renamed to Travelers / Voyageurs / etc.
  { value: 'locals',    icon: '🏠' },
  { value: 'explorers', icon: '🧳' },
]

export default function CreateChallengePage({ channelId, guest, account, editChallenge = null, onCreated, onUpdated, onBack }) {
  const { t } = useTranslation('city')
  const isEdit = !!editChallenge

  // Edit mode pre-populates from the existing challenge; create starts fresh.
  const [audience,        setAudience]        = useState(editChallenge?.audience         ?? 'locals')
  const [type,            setType]            = useState(editChallenge?.challenge_type   ?? 'food')
  const [title,           setTitle]           = useState(editChallenge?.title            ?? '')
  const [maxParticipants, setMaxParticipants] = useState(editChallenge?.max_participants ?? MAX_P_DEFAULT)
  const [returnClause,    setReturnClause]    = useState(editChallenge?.return_clause    ?? '')
  // First user edit pins the return clause — type switches after that won't
  // overwrite it. In edit mode the stored clause is treated as pinned from the
  // start (we never want to clobber what the creator already saved).
  const returnClauseDirty                     = useRef(!!editChallenge?.return_clause)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  // Re-template the return clause whenever the type changes, unless the user
  // has already edited it manually.
  useEffect(() => {
    if (returnClauseDirty.current) return
    setReturnClause(t(`returnClauseTemplates.${type}`, { ns: 'challenge' }))
  }, [type, t])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed       = title.trim()
    const trimmedClause = returnClause.trim() || null
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        const updated = await updateChallenge(editChallenge.id, guest.guestId, trimmed, type, audience, maxParticipants, trimmedClause)
        onUpdated?.(updated)
      } else {
        const nickname = account?.display_name ?? guest?.nickname ?? null
        const challenge = await createChallenge(channelId, guest.guestId, nickname, trimmed, type, audience, maxParticipants, trimmedClause)
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
                  key={a.value}
                  type="button"
                  className={`cef-audience-btn${audience === a.value ? ' selected' : ''}`}
                  onClick={() => setAudience(a.value)}
                >
                  <span className="cef-audience-emoji" aria-hidden="true">{a.icon}</span>
                  <span>{a.value === 'locals' ? t('create.challengeAudLocals') : t('create.challengeAudExplorers')}</span>
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

          {/* Return clause — the "...and come tell me about it in person" half.
              Pre-filled per type; user-editable; first edit pins it so type
              switches stop overwriting. Forces every challenge to lead to a
              real meetup (the heart of the redesign). */}
          <div className="cef-section">
            <label className="cef-label">{t('returnClauseLabel', { ns: 'challenge' })}</label>
            <input
              className="cef-input"
              type="text"
              value={returnClause}
              onChange={e => { returnClauseDirty.current = true; setReturnClause(e.target.value) }}
              placeholder={t('returnClauseTemplates.food', { ns: 'challenge' })}
              maxLength={200}
            />
          </div>

          {/* Max participants stepper — −/+ buttons flanking the number.
              Discrete steps are faster than a slider drag for a 1-20 range. */}
          <div className="cef-section">
            <label className="cef-label">{t('maxParticipantsLabel', { ns: 'challenge' })}</label>
            <div className="cef-stepper">
              <button
                type="button"
                className="cef-stepper-btn"
                onClick={() => setMaxParticipants(Math.max(MAX_P_MIN, maxParticipants - 1))}
                disabled={maxParticipants <= MAX_P_MIN}
                aria-label="−"
              >−</button>
              <span className="cef-stepper-value">{maxParticipants}</span>
              <button
                type="button"
                className="cef-stepper-btn"
                onClick={() => setMaxParticipants(Math.min(MAX_P_MAX, maxParticipants + 1))}
                disabled={maxParticipants >= MAX_P_MAX}
                aria-label="+"
              >+</button>
            </div>
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

          {/* Examples — 3 tappable starters that swap based on the selected
              type. Keeps the screen useful when the user has no idea what
              to write. Tapping fills the input directly (real challenge
              title, not just inspiration). Pulls from the `challenge` ns. */}
          {(() => {
            const examples = t(`examples.${type}`, { ns: 'challenge', returnObjects: true })
            if (!Array.isArray(examples) || examples.length === 0) return null
            return (
              <div className="cef-examples">
                <p className="cef-examples-label">{t('examples.label', { ns: 'challenge' })}</p>
                <div className="cef-examples-grid">
                  {examples.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      className="cef-example-chip"
                      onClick={() => setTitle(ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

        </form>
      </div>
    </div>
  )
}
