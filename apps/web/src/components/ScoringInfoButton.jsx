import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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

      {open && <ScoringInfoModal onClose={() => setOpen(false)} t={t} />}
    </>
  )
}

function ScoringInfoModal({ onClose, t }) {
  const steps = [
    // Creation reward (+2 challenger) - credited instantly at creation,
    // capped at the first 3/day. Sits above the per-run steps; the total
    // below is the per-challenge-run total and intentionally excludes it.
    { icon: '🎯', labelKey: 'scoringInfo.steps.created',  challenger: 10, taker: null },
    { icon: '🤝', labelKey: 'scoringInfo.steps.accepted', challenger: 5,  taker: null },
    { icon: '📅', labelKey: 'scoringInfo.steps.date',     challenger: 5,  taker: 5    },
    { icon: '⭐', labelKey: 'scoringInfo.steps.rate',     challenger: 30, taker: 40   },
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

          <div className="scoring-info-header-row">
            <span className="scoring-info-col-step">{t('scoringInfo.colStep')}</span>
            <span className="scoring-info-col">{t('badge.challenger')}</span>
            <span className="scoring-info-col">{t('badge.taker')}</span>
          </div>

          {steps.map((s) => (
            <div key={s.labelKey} className="scoring-info-row">
              <span className="scoring-info-icon">{s.icon}</span>
              <span className="scoring-info-label">{t(s.labelKey)}</span>
              <span className={`scoring-info-points${s.challenger === null ? ' scoring-info-points--muted' : ''}`}>
                {s.challenger === null ? t('scoringInfo.noPoints') : `+${s.challenger}`}
              </span>
              <span className={`scoring-info-points${s.taker === null ? ' scoring-info-points--muted' : ''}`}>
                {s.taker === null ? t('scoringInfo.noPoints') : `+${s.taker}`}
              </span>
            </div>
          ))}

          <div className="scoring-info-total-row">
            <span className="scoring-info-total-label">{t('scoringInfo.totalLabel')}</span>
            <span className="scoring-info-total-value">40</span>
            <span className="scoring-info-total-value">45</span>
          </div>

          <p className="scoring-info-footnote">{t('scoringInfo.footnote')}</p>
        </div>
      </div>
    </div>
  )
}
