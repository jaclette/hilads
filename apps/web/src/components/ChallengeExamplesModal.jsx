import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChallengeExamples } from '../api'

const LINE_ICON = { created: '🎯', winner: '🏆', present: '✅', submission: '📸', host: '👑' }

/**
 * "See 3 real examples" - real resolved challenges with a who-earned-what point
 * breakdown. Self-contained: opened from the ScoringInfoModal CTA.
 */
export default function ChallengeExamplesModal({ onClose }) {
  const { t } = useTranslation('challenge')
  const [examples, setExamples] = useState(null)

  useEffect(() => { fetchChallengeExamples().then(setExamples) }, [])

  const lineLabel = (l) => {
    const opts = { name: l.name ?? '', count: l.count ?? 0 }
    switch (l.kind) {
      case 'created':    return t('pointExamples.line.created',    { ...opts, defaultValue: `${opts.name} created it` })
      case 'winner':     return t('pointExamples.line.winner',     { ...opts, defaultValue: `${opts.name} won` })
      case 'present':    return t('pointExamples.line.present',    { ...opts, defaultValue: `${opts.count} showed up` })
      case 'submission': return t('pointExamples.line.submission', { ...opts, defaultValue: `${opts.count} submitted a photo` })
      case 'host':       return t('pointExamples.line.host',       { ...opts, defaultValue: `${opts.name} hosted` })
      default:           return ''
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel point-examples-panel" onClick={(e) => e.stopPropagation()}>
        <div className="point-examples-head">
          <h3 className="modal-title">✨ {t('pointExamples.title', { defaultValue: '3 real examples' })}</h3>
          <button type="button" className="point-examples-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="point-examples-intro">{t('pointExamples.intro', { defaultValue: 'How real challenges paid out — who earned what.' })}</p>
        {examples === null ? (
          <p className="point-examples-loading">…</p>
        ) : examples.length === 0 ? (
          <p className="point-examples-empty">{t('pointExamples.empty', { defaultValue: 'No examples yet — be the first to run a challenge!' })}</p>
        ) : (
          <div className="point-examples-list">
            {examples.map((ex) => (
              <div key={ex.id} className="point-example-card">
                <div className="point-example-cardhead">
                  <span className={`point-example-fmt point-example-fmt--${ex.format}`}>
                    {ex.format === 'photo' ? `📸 ${t('card.photoBadge', { defaultValue: 'Photo proof' })}` : `📍 ${t('card.meetBadge', { defaultValue: 'Meet' })}`}
                  </span>
                  <span className="point-example-title">{ex.title}</span>
                </div>
                {ex.lines.map((l, i) => (
                  <div key={i} className="point-example-line">
                    <span className="point-example-line-icon">{LINE_ICON[l.kind]}</span>
                    <span className="point-example-line-label">{lineLabel(l)}</span>
                    <span className="point-example-line-points">+{l.points}{l.per ? ` ${t('pointExamples.each', { defaultValue: 'each' })}` : ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
