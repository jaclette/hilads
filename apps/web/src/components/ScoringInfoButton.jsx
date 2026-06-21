import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChallengeExamplesModal from './ChallengeExamplesModal'

/**
 * Web parity for the mobile ScoringInfoButton. Small round (i) button +
 * a popin explaining the points-per-step schedule. Numbers mirror score_rules
 * in migrate.php (PR12): Accept +5 challenger; Date locked +5 challenger /
 * +5 taker; Both rate +30 challenger / +40 taker.
 *
 * Mounted on:
 *   - The NOW screen, next to the "🔥 challenges" section header.
 *   - The challenge channel header, near the pipeline.
 *
 * Reads i18n from the 'challenge' namespace under scoringInfo.*. The
 * mobile pass shipped these keys for all 18 non-en locales - they live
 * in the same JSON file on web.
 */
export default function ScoringInfoButton({ size = 22, className = '', labeled = false }) {
  const { t } = useTranslation('challenge')
  const [open, setOpen] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)

  return (
    <>
      {labeled ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('scoringInfo.aria')}
          className={`scoring-info-pill ${className}`}
        >
          {t('scoringInfo.helpLabel')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('scoringInfo.aria')}
          className={`scoring-info-btn ${className}`}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        >
          <svg
            width={size - 6} height={size - 6}
            viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8"  x2="12.01" y2="8" />
          </svg>
        </button>
      )}

      {open && <ScoringInfoModal onClose={() => setOpen(false)} t={t} onSeeExamples={() => { setOpen(false); setExamplesOpen(true) }} />}
      {examplesOpen && <ChallengeExamplesModal onClose={() => setExamplesOpen(false)} />}
    </>
  )
}

function ScoringInfoModal({ onClose, t, onSeeExamples }) {
  // Group-model "ways to earn" (mirrors score_rules in migrate.php).
  const ways = [
    { icon: '🙌', labelKey: 'scoringInfo.ways.join',    points: '+2'  },
    { icon: '🎯', labelKey: 'scoringInfo.ways.create',  points: '+10' },
    { icon: '✅', labelKey: 'scoringInfo.ways.present', points: '+40', highlight: true },
    { icon: '👑', labelKey: 'scoringInfo.ways.host',    points: '+10 · 🙋 +5' },
    { icon: '📸', labelKey: 'scoringInfo.ways.submit',  points: '+5'  },
    { icon: '🏆', labelKey: 'scoringInfo.ways.win',     points: '+40', highlight: true },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel scoring-info-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('scoringInfo.title')}</span>
          <button className="going-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="scoring-info-body">
          {/* 1 - Two flavours of challenge. Friendly + emoji-led so the
              user instantly knows what game they're stepping into. */}
          <section className="scoring-info-section">
            <h3 className="scoring-info-section-heading">{t('scoringInfo.types.heading')}</h3>
            <p className="scoring-info-section-body">{t('scoringInfo.types.local')}</p>
            <p className="scoring-info-section-body">{t('scoringInfo.types.international')}</p>
          </section>

          {/* 2 - Lifecycle reassurance. Mirrors the per-acceptance chat
              reset we shipped server-side: the challenge persists, the
              conversation doesn't. */}
          <section className="scoring-info-section">
            <h3 className="scoring-info-section-heading">{t('scoringInfo.lifecycle.heading')}</h3>
            <p className="scoring-info-section-body">{t('scoringInfo.lifecycle.body')}</p>
          </section>

          {/* 3 - Points breakdown, kept verbatim from the prior modal so
              the numbers + the muscle memory of returning users stay
              intact. */}
          <h3 className="scoring-info-section-heading">{t('scoringInfo.pointsHeading')}</h3>
          <p className="scoring-info-intro">{t('scoringInfo.intro')}</p>

          {ways.map((w) => (
            <div key={w.labelKey} className={`scoring-info-row${w.highlight ? ' scoring-info-row--highlight' : ''}`}>
              <span className="scoring-info-icon">{w.icon}</span>
              <span className="scoring-info-label">{t(w.labelKey)}</span>
              <span className="scoring-info-points">{w.points}</span>
            </div>
          ))}

          <p className="scoring-info-footnote">{t('scoringInfo.footnote')}</p>

          {/* See real examples - opens the Success Challenges showcase so the
              user can see real completed challenges, not just rules. */}
          {onSeeExamples && (
            <button
              type="button"
              className="scoring-info-examples-btn"
              onClick={() => { onClose(); onSeeExamples() }}
            >
              ✨ {t('scoringInfo.seeExamples', { defaultValue: 'See 3 real examples' })} →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
