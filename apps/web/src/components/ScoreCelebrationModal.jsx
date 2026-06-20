import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'

// Per-kind subtitle key - same mapping as the native modal. Falls through
// to `default` when top_kind is null or unknown (older / ghost events).
const KIND_KEYS = {
  challenge_created: 'scoreCelebration.subtitle.challenge_created',
  accepted:    'scoreCelebration.subtitle.accepted',
  date_locked: 'scoreCelebration.subtitle.date_locked',
  meetup:      'scoreCelebration.subtitle.meetup',
  debrief:     'scoreCelebration.subtitle.debrief',
  ghost:       'scoreCelebration.subtitle.ghost',
  meet_bonus:  'scoreCelebration.subtitle.meet_bonus',
}

// Short kind label + emoji for the per-event rows. Distinct keys from the
// subtitle copy above (which is a full sentence for the headline path).
const KIND_SHORT_KEYS = {
  challenge_created: 'scoreCelebration.kindShort.challenge_created',
  accepted:    'scoreCelebration.kindShort.accepted',
  date_locked: 'scoreCelebration.kindShort.date_locked',
  meetup:      'scoreCelebration.kindShort.meetup',
  debrief:     'scoreCelebration.kindShort.debrief',
  ghost:       'scoreCelebration.kindShort.ghost',
  meet_bonus:  'scoreCelebration.kindShort.meet_bonus',
}
const KIND_EMOJI = {
  challenge_created: '🎯',
  accepted:    '🤝',
  date_locked: '🗓️',
  meetup:      '🎉',
  debrief:     '🎉',
  ghost:       '👻',
  meet_bonus:  '🤝',
}

/**
 * Web "+X points!" celebration modal - parity with the native version.
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
export default function ScoreCelebrationModal({ data, visible, onClose, onOpenLeaderboard }) {
  const { t } = useTranslation('challenge')
  const [displayPoints, setDisplayPoints] = useState(0)
  const rafRef = useRef(null)

  // Count-up effect - restarts whenever a new payload becomes visible.
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
  const cityRank         = data.rank_month?.city   ?? data.rank_alltime?.city   ?? null
  const worldRank        = data.rank_month?.global ?? data.rank_alltime?.global ?? null
  const cityInCitiesRank = data.city_rank_month    ?? data.city_rank_alltime    ?? null

  // Running total after the delta. Prefer the in-month total when present
  // (matches the monthly rank lens above) and fall back to alltime.
  const totalPoints = (data.total_month && data.total_month > 0)
    ? data.total_month
    : (data.total_alltime ?? 0)

  // Running total climbs in sync with the "+X" count-up: starts at the score
  // before this gain (total - delta), ends at the final total.
  const displayTotal = Math.max(0, totalPoints - data.points) + displayPoints

  const cityRankCopy = cityRank !== null
    ? t('scoreCelebration.rank.city',       { rank: cityRank, city: data.city_name ?? '' })
    : t('scoreCelebration.rank.cityBeyond', { topN })
  const worldRankCopy = worldRank !== null
    ? t('scoreCelebration.rank.world',       { rank: worldRank })
    : t('scoreCelebration.rank.worldBeyond', { topN })
  const cityInCitiesCopy = cityInCitiesRank !== null
    ? t('scoreCelebration.rank.cities',       { rank: cityInCitiesRank, city: data.city_name ?? '' })
    : t('scoreCelebration.rank.citiesBeyond', { topN,                   city: data.city_name ?? '' })

  const cityFlag   = countryToFlag(data.city_country) || '📍'
  const worldFlag  = '🌐'
  const citiesFlag = '🏙️'

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

        {totalPoints > 0 && (
          <div className={`score-celebration-total${data.points > 0 && displayPoints >= data.points ? ' is-lit' : ''}`}>
            {t('scoreCelebration.total', { total: displayTotal })}
          </div>
        )}

        <div className="score-celebration-subtitle">
          {t(subtitleKey)}
        </div>

        {/* Per-event breakdown - same shape as the native modal. Each row
            shows the challenge title + which step earned the points so the
            popin reads as a recap, not just a number. */}
        {data.events && data.events.length > 0 && (
          <div className="score-celebration-events">
            {data.events.map(ev => {
              const emoji   = KIND_EMOJI[ev.kind] ?? '🏆'
              const kindKey = KIND_SHORT_KEYS[ev.kind] ?? 'scoreCelebration.kindShort.default'
              const title   = ev.challenge_title ?? t('scoreCelebration.event.deletedChallenge')
              const isBonus = ev.kind === 'meet_bonus'
              return (
                <div
                  key={ev.id}
                  className={`score-celebration-event${isBonus ? ' score-celebration-event--bonus' : ''}`}
                >
                  <span className="score-celebration-event-points">+{ev.points}</span>
                  <span className="score-celebration-event-body">
                    <span className="score-celebration-event-title">{title}</span>
                    <span className="score-celebration-event-kind">
                      {emoji} {t(kindKey)}
                    </span>
                  </span>
                </div>
              )
            })}
            {data.events_truncated && data.event_count != null && (
              <div className="score-celebration-events-more">
                {t('scoreCelebration.event.andMore', {
                  count: Math.max(0, (data.event_count ?? 0) - data.events.length),
                })}
              </div>
            )}
          </div>
        )}

        <div className="score-celebration-divider" />

        {/* PR38 - rank rows are clickable when a handler is provided. Tap
            opens the leaderboard pre-scoped to that row's lens (city or
            world). The handler is responsible for acking the watermark
            before navigating so the popin doesn't re-appear. */}
        {(() => {
          const cityTappable  = typeof onOpenLeaderboard === 'function'
          const worldTappable = typeof onOpenLeaderboard === 'function'
          return (
            <>
              <div
                className={`score-celebration-row score-celebration-row--1${cityTappable ? ' score-celebration-row--tappable' : ''}`}
                role={cityTappable ? 'button' : undefined}
                tabIndex={cityTappable ? 0 : undefined}
                onClick={cityTappable ? () => onOpenLeaderboard('city') : undefined}
                onKeyDown={cityTappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLeaderboard('city') } } : undefined}
              >
                <span className="score-celebration-row-flag" aria-hidden="true">{cityFlag}</span>
                <span className="score-celebration-row-label">{cityRankCopy}</span>
                {cityTappable && <span className="score-celebration-row-chevron" aria-hidden="true">›</span>}
              </div>
              <div
                className={`score-celebration-row score-celebration-row--2${worldTappable ? ' score-celebration-row--tappable' : ''}`}
                role={worldTappable ? 'button' : undefined}
                tabIndex={worldTappable ? 0 : undefined}
                onClick={worldTappable ? () => onOpenLeaderboard('world') : undefined}
                onKeyDown={worldTappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLeaderboard('world') } } : undefined}
              >
                <span className="score-celebration-row-flag" aria-hidden="true">{worldFlag}</span>
                <span className="score-celebration-row-label">{worldRankCopy}</span>
                {worldTappable && <span className="score-celebration-row-chevron" aria-hidden="true">›</span>}
              </div>
              {/* City-in-cities - where the user's home city ranks among
                  all cities. Rendered only when there's a current city
                  set; uses the same row chrome as the other two. */}
              {data.city_id && (
                <div className="score-celebration-row score-celebration-row--2">
                  <span className="score-celebration-row-flag" aria-hidden="true">{citiesFlag}</span>
                  <span className="score-celebration-row-label">{cityInCitiesCopy}</span>
                </div>
              )}
            </>
          )
        })()}

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
