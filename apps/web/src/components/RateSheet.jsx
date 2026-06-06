import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { submitRating } from '../api'

const COMMENT_MAX = 500

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

/**
 * Bottom-sheet rating modal for a single rate-prompt. Stars (1–5, required) +
 * optional comment (≤500 chars). Mirrors the mobile RateSheet contract:
 *   - onSubmitted(challengeId) fires after a successful POST OR after a
 *     recoverable race (409 already_rated / 403 not_rate_eligible) — the
 *     parent treats both as "this prompt is done, remove it".
 *   - onClose dismisses without affecting the prompt list.
 */
export default function RateSheet({ prompt, visible, onClose, onSubmitted }) {
  const { t } = useTranslation('challenge')
  const [stars,   setStars]   = useState(0)
  const [comment, setComment] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState(null)

  // Reset on every (re-)open for a new prompt.
  useEffect(() => {
    if (visible) { setStars(0); setComment(''); setBusy(false); setError(null) }
  }, [visible, prompt?.challenge_id])

  if (!visible || !prompt) return null

  const cp = prompt.counterparty
  const [c1, c2] = avatarColors(cp.displayName)
  const canSubmit = stars >= 1 && stars <= 5 && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      await submitRating(prompt.challenge_id, stars, comment.trim() || null)
      onSubmitted?.(prompt.challenge_id)
      onClose?.()
    } catch (err) {
      // Recoverable race: parent just refetches.
      if (err?.status === 409 || err?.status === 403) {
        onSubmitted?.(prompt.challenge_id)
        onClose?.()
        return
      }
      setError(t('ratePrompts.errSubmit'))
      setBusy(false)
    }
  }

  return (
    <>
      <div
        onClick={busy ? undefined : onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)', zIndex: 9000,
        }}
      />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9001,
        background: 'var(--bg-2, #1a1a1a)',
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '12px 16px 28px',
        maxWidth: 600, margin: '0 auto',
      }}>
        <div style={{
          alignSelf: 'center', margin: '0 auto 12px',
          width: 40, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.2)',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{
            width: 48, height: 48, borderRadius: 24,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${c1}, ${c2})`,
            color: '#fff', fontWeight: 700, fontSize: 18,
            overflow: 'hidden', flexShrink: 0,
          }}>
            {cp.thumbAvatarUrl
              ? <img src={cp.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (cp.displayName ?? '?')[0].toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text, #fff)', letterSpacing: -0.3 }}>
              {t('ratePrompts.sheet.title', { name: cp.displayName })}
            </div>
            <div style={{
              fontSize: 13, color: 'var(--muted, #b3b3b3)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {prompt.challenge_title}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '12px 8px', marginBottom: 4,
        }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              type="button"
              key={n}
              onClick={() => setStars(n)}
              disabled={busy}
              aria-label={t('ratePrompts.sheet.starsAria', { n })}
              style={{
                background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer',
                padding: 4, fontSize: 36, lineHeight: 1,
                color: n <= stars ? '#FFC93C' : 'rgba(255,255,255,0.25)',
              }}
            >
              {n <= stars ? '★' : '☆'}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
            placeholder={t('ratePrompts.sheet.commentPlaceholder')}
            maxLength={COMMENT_MAX}
            disabled={busy}
            rows={3}
            style={{
              width: '100%', resize: 'vertical', minHeight: 80,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12, padding: 10,
              color: 'var(--text, #fff)', fontSize: 15,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          {comment.length > 0 && (
            <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted-2, #888)', marginTop: 4 }}>
              {comment.length}/{COMMENT_MAX}
            </div>
          )}
        </div>

        {error && (
          <div style={{
            color: 'var(--red, #f87171)', fontSize: 13, marginBottom: 10, textAlign: 'center',
          }}>{error}</div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: '100%',
            background: '#FF7A3C',
            border: 'none', borderRadius: 999,
            padding: '13px 16px',
            color: '#fff', fontWeight: 800, fontSize: 15,
            cursor: canSubmit ? 'pointer' : 'default',
            opacity: canSubmit ? 1 : 0.4,
          }}
        >
          {busy ? '…' : t('ratePrompts.sheet.submit')}
        </button>

        <button
          type="button"
          onClick={busy ? undefined : onClose}
          disabled={busy}
          style={{
            width: '100%', marginTop: 8,
            background: 'transparent', border: 'none',
            padding: '8px', color: 'var(--muted, #b3b3b3)', fontSize: 13, fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {t('ratePrompts.sheet.later')}
        </button>
      </div>
    </>
  )
}
