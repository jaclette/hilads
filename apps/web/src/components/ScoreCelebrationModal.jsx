import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'

// Per-kind subtitle key — same mapping as the native modal. Falls through
// to `default` when top_kind is null or unknown (older / ghost events).
const KIND_KEYS = {
  accepted:    'scoreCelebration.subtitle.accepted',
  date_locked: 'scoreCelebration.subtitle.date_locked',
  meetup:      'scoreCelebration.subtitle.meetup',
  debrief:     'scoreCelebration.subtitle.debrief',
  ghost:       'scoreCelebration.subtitle.ghost',
}

/**
 * Web "+X points!" celebration modal — parity with the native version.
 *
 * Animation:
 *   - Fade-in backdrop + scale-in card via CSS keyframes (in index.css).
 *   - JS-driven count-up on the points headline using requestAnimationFrame
 *     so the integer ticks discretely.
 *   - Rank rows stagger via CSS animation-delay.
 *
 * The CTA + backdrop both fire onClose; the parent (LaunchGate) acks the
 * server watermark there so the same delta is never re-celebrated.
 */
export default function ScoreCelebrationModal({ data, visible, onClose }) {
  const { t } = useTranslation('challenge')
  const [displayPoints, setDisplayPoints] = useState(0)
  const rafRef = useRef(null)

  // Count-up effect — restarts whenever a new payload becomes visible.
  // Easing matches the native modal's out-cubic curve so the two feel the
  // same across platforms; duration scales with point count but is clamped
  // so a +500 doesn't roll forever.
  useEffect(() => {
    if (!visible || !data || data.points <= 0) {
      setDisplayPoints(0)
      return
    }
    const target   = data.points
    const duration = Math.min(900, 200 + target * 24)
    const startedAt = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayPoints(Math.round(target * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [visible, data])

  if (!visible || !data || data.points <= 0) return null

  const subtitleKey = data.top_kind && KIND_KEYS[data.top_kind]
    ? KIND_KEYS[data.top_kind]
    : 'scoreCelebration.subtitle.default'

  const topN      = data.top_n ?? 100
  // Prefer monthly rank when present (more current); fall back to alltime
  // so the popin still reads useful copy when a user is unranked monthly.
  const cityRank  = data.rank_month?.city   ?? data.rank_alltime?.city   ?? null
  const worldRank = data.rank_month?.global ?? data.rank_alltime?.global ?? null

  const cityRankCopy = cityRank !== null
    ? t('scoreCelebration.rank.city',       { rank: cityRank, city: data.city_name ?? '' })
    : t('scoreCelebration.rank.cityBeyond', { topN })
  const worldRankCopy = worldRank !== null
    ? t('scoreCelebration.rank.world',       { rank: worldRank })
    : t('scoreCelebration.rank.worldBeyond', { topN })

  const cityFlag  = countryToFlag(data.city_country) || '📍'
  const worldFlag = '🌍'

  return (
    <div className="score-celebration-backdrop" onClick={onClose}>
      <div
        className="score-celebration-card"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="score-celebration-confetti">✨   🎉   ✨</div>
        <div className="score-celebration-trophy">🏆</div>

        <div className="score-celebration-points">
          +{displayPoints}
          <span className="score-celebration-points-unit"> {t('scoreCelebration.unit')}</span>
        </div>

        <div className="score-celebration-subtitle">
          {t(subtitleKey)}
        </div>

        <div className="score-celebration-divider" />

        <div className="score-celebration-row score-celebration-row--1">
          <span className="score-celebration-row-flag" aria-hidden="true">{cityFlag}</span>
          <span className="score-celebration-row-label">{cityRankCopy}</span>
        </div>
        <div className="score-celebration-row score-celebration-row--2">
          <span className="score-celebration-row-flag" aria-hidden="true">{worldFlag}</span>
          <span className="score-celebration-row-label">{worldRankCopy}</span>
        </div>

        <button
          type="button"
          className="score-celebration-cta"
          onClick={onClose}
        >
          {t('scoreCelebration.cta')}
        </button>
      </div>
    </div>
  )
}
