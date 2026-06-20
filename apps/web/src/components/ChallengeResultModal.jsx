import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * GROUP challenge result reveal modal (web). Role-specific, never-negative copy
 * + (photo contests) the winning photo. Web mirror of ChallengeResultModal.tsx.
 */
export default function ChallengeResultModal({ reveal, visible, onClose }) {
  const { t } = useTranslation('challenge')
  const [displayPoints, setDisplayPoints] = useState(0)
  const rafRef = useRef(null)
  const targetPoints = reveal?.myPoints ?? 0

  // Count-up for the points + running total (out-cubic, matches the native modal).
  useEffect(() => {
    if (!visible || !reveal) { setDisplayPoints(0); return }
    const target = targetPoints
    const duration = Math.min(1100, 250 + target * 22)
    const startedAt = performance.now() + 250
    const tick = (now) => {
      const t2 = Math.max(0, Math.min(1, (now - startedAt) / duration))
      const eased = 1 - Math.pow(1 - t2, 3)
      setDisplayPoints(Math.round(target * eased))
      if (now < startedAt + duration) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [visible, reveal, targetPoints])

  if (!reveal || !visible) return null

  const { myRole, myPoints, winnerName, winnerPhotoUrl, format, hostBreakdown, myTotal,
          challengeTitle, rankCity, rankGlobal, rankTopN, cityName } = reveal
  const finalTotal = myTotal ?? 0
  const displayTotal = Math.max(0, finalTotal - myPoints) + displayPoints
  const isPhoto = format === 'photo'
  const showPhoto = isPhoto && !!winnerPhotoUrl

  let emoji = '🎉', title = '', body = ''
  switch (myRole) {
    case 'winner':
      emoji = '👑'; title = t('result.winner.title', { defaultValue: 'You won!' })
      body = t('result.winner.body', { defaultValue: 'Your photo took the contest.' })
      break
    case 'loser':
      emoji = '📸'; title = t('result.loser.title', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won` })
      body = t('result.loser.body', { points: `+${myPoints}`, defaultValue: `Nice shot! You earned +${myPoints} for joining — take another shot next time 💪` })
      break
    case 'present':
      emoji = '✅'; title = t('result.present.title', { defaultValue: 'You showed up!' })
      body = t('result.present.body', { defaultValue: 'Validated present at the meet.' })
      break
    case 'absent':
      emoji = '👋'; title = t('result.absent.title', { defaultValue: 'You missed this one' })
      body = t('result.absent.body', { defaultValue: 'Catch the next meet — your spot is waiting.' })
      break
    case 'host':
      emoji = '🏆'
      title = isPhoto
        ? t('result.host.titlePhoto', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won your contest!` })
        : t('result.host.titleMeet', { defaultValue: 'Your meet is done!' })
      body = t('result.host.body', { defaultValue: 'Thanks for hosting.' })
      break
    default: break
  }

  const showPoints = myRole !== 'absent'

  return (
    <div className="crm-backdrop" onClick={onClose}>
      <div className="crm-card" onClick={(e) => e.stopPropagation()}>
        {showPhoto ? (
          <div className="crm-photo-wrap">
            <img className="crm-photo" src={winnerPhotoUrl} alt="" />
            {winnerName ? <span className="crm-photo-caption">👑 {winnerName}</span> : null}
          </div>
        ) : (
          <div className="crm-big-emoji">{emoji}</div>
        )}

        <div className="crm-title">{emoji} {title}</div>
        {challengeTitle ? <div className="crm-challenge-name">📌 {challengeTitle}</div> : null}
        {body ? <div className="crm-body">{body}</div> : null}

        {showPoints ? (
          <div className="crm-points-block">
            <div className="crm-points">+{displayPoints}</div>
            {myRole === 'host' && hostBreakdown && hostBreakdown.heads > 0 ? (
              <div className="crm-breakdown">
                {t('result.host.breakdown', {
                  base: hostBreakdown.base, perHead: hostBreakdown.perHead, heads: hostBreakdown.heads,
                  defaultValue: `+${hostBreakdown.base} base · +${hostBreakdown.perHead} ×${hostBreakdown.heads}`,
                })}
              </div>
            ) : null}
            {finalTotal > 0 ? (
              <div className={`crm-total${targetPoints > 0 && displayPoints >= targetPoints ? ' is-lit' : ''}`}>
                {t('result.total', { total: displayTotal, defaultValue: `You now have ${displayTotal} points` })}
              </div>
            ) : null}
          </div>
        ) : null}

        {rankTopN != null ? (
          <div className="crm-rank-block">
            <div className="crm-rank-row">
              <span className="crm-rank-flag">📍</span>
              <span className="crm-rank-label">
                {rankCity != null
                  ? t('scoreCelebration.rank.city',       { rank: rankCity, city: cityName ?? '' })
                  : t('scoreCelebration.rank.cityBeyond', { topN: rankTopN })}
              </span>
            </div>
            <div className="crm-rank-row">
              <span className="crm-rank-flag">🌐</span>
              <span className="crm-rank-label">
                {rankGlobal != null
                  ? t('scoreCelebration.rank.world',       { rank: rankGlobal })
                  : t('scoreCelebration.rank.worldBeyond', { topN: rankTopN })}
              </span>
            </div>
          </div>
        ) : null}

        <button type="button" className="crm-cta" onClick={onClose}>
          {t('result.cta', { defaultValue: 'Nice!' })}
        </button>
      </div>
    </div>
  )
}
