import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { submitHostRating, submitTakerRating } from '../api'
import Icon from './Icon'

/**
 * GROUP challenge result reveal modal (web). Role-specific, never-negative copy
 * + (photo contests) the winning photo. Web mirror of ChallengeResultModal.tsx.
 */
export default function ChallengeResultModal({ reveal, visible, onClose, onOpenLeaderboard }) {
  const { t } = useTranslation('challenge')
  const [displayPoints, setDisplayPoints] = useState(0)
  const [revealedHeads, setRevealedHeads] = useState(0)
  const [hostStars, setHostStars] = useState(0)
  const [hostNote, setHostNote] = useState('')
  const [savingRating, setSavingRating] = useState(false)
  const rafRef = useRef(null)
  const targetPoints = reveal?.myPoints ?? 0

  useEffect(() => { if (!visible) { setHostStars(0); setHostNote(''); setSavingRating(false) } }, [visible])

  // Host breakdown: reveal one person icon at a time, +points ticking up with each.
  const hb        = reveal?.hostBreakdown ?? null
  const headCount = (reveal?.myRole === 'host' && hb && hb.heads > 0) ? hb.heads : 0
  const staggered = headCount > 0 && headCount <= 8
  useEffect(() => {
    if (!visible || !reveal || headCount === 0) { setRevealedHeads(0); return }
    if (!staggered) { setRevealedHeads(headCount); return }
    setRevealedHeads(0)
    const timers = []
    for (let i = 1; i <= headCount; i++) {
      timers.push(setTimeout(() => setRevealedHeads(i), 350 + i * 450))
    }
    return () => timers.forEach(clearTimeout)
  }, [visible, reveal, headCount, staggered])

  // Count-up for the points + running total (out-cubic, matches the native modal).
  useEffect(() => {
    if (!visible || !reveal) { setDisplayPoints(0); return }
    const target = targetPoints
    const duration = Math.min(2400, 600 + target * 55)
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

  const { myRole, myPoints, winnerName, winnerPhotoUrl, format, myTotal,
          challengeTitle, rankCity, rankGlobal, rankTopN, cityName } = reveal
  const finalTotal = myTotal ?? 0
  const displayTotal = Math.max(0, finalTotal - myPoints) + displayPoints
  const isPhoto = format === 'photo'
  const showPhoto = isPhoto && !!winnerPhotoUrl

  let icon = 'sparkles-outline', title = '', body = ''
  switch (myRole) {
    case 'winner':
      icon = 'ribbon-outline'; title = t('result.winner.title', { defaultValue: 'You won!' })
      body = t('result.winner.body', { defaultValue: 'Your photo took the challenge.' })
      break
    case 'loser':
      icon = 'camera-outline'; title = t('result.loser.title', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won` })
      body = t('result.loser.body', { points: `+${myPoints}`, defaultValue: `Nice shot! You earned +${myPoints} for joining — take another shot next time` })
      break
    case 'present':
      icon = 'checkmark-circle-outline'; title = t('result.present.title', { defaultValue: 'You showed up!' })
      body = t('result.present.body', { defaultValue: 'Validated present at the meet.' })
      break
    case 'absent':
      icon = 'hand-left-outline'; title = t('result.absent.title', { defaultValue: 'You missed this one' })
      body = t('result.absent.body', { defaultValue: 'Catch the next meet — your spot is waiting.' })
      break
    case 'host':
      icon = 'trophy-outline'
      title = isPhoto
        ? t('result.host.titlePhoto', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won your challenge!` })
        : t('result.host.titleMeet', { defaultValue: 'Your meet is done!' })
      body = t('result.host.body', { defaultValue: 'Thanks for hosting.' })
      break
    default: break
  }

  const showPoints = myRole !== 'absent'
  const showHostRating = myRole === 'host' && isPhoto  // photo host rates here (no validate sheet)
  // The taker rates the challenge too, from their own reveal modal (same UI).
  const showTakerRating = myRole === 'winner' || myRole === 'loser' || myRole === 'present'
  const showRating = showHostRating || showTakerRating

  return (
    <div className="crm-backdrop" onClick={onClose}>
      <div className="crm-card" onClick={(e) => e.stopPropagation()}>
        {showPhoto ? (
          <div className="crm-photo-wrap">
            <img className="crm-photo" src={winnerPhotoUrl} alt="" />
            {winnerName ? <span className="crm-photo-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ribbon-outline" size={14} />{winnerName}</span> : null}
          </div>
        ) : (
          <div className="crm-big-emoji" aria-hidden="true" style={{ color: 'var(--gold)', lineHeight: 0 }}><Icon name={icon} size={64} /></div>
        )}

        <div className="crm-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name={icon} size={20} style={{ color: 'var(--gold)' }} />{title}</div>
        {challengeTitle ? <div className="crm-challenge-name" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Icon name="pin-outline" size={14} style={{ color: 'var(--muted2)' }} />{challengeTitle}</div> : null}
        {body ? <div className="crm-body">{body}</div> : null}

        {showPoints ? (
          <div className="crm-points-block">
            <div className="crm-points">+{displayPoints}</div>
            {headCount > 0 && hb ? (
              <div className="crm-breakdown crm-breakdown-row">
                {staggered ? (
                  <>
                    {Array.from({ length: revealedHeads }).map((_, i) => (
                      <span key={i} className="crm-pop-emoji"><Icon name="person-outline" size={14} /></span>
                    ))}
                    <span> = +{hb.perHead * revealedHeads}</span>
                    {revealedHeads >= headCount ? <span style={{ marginLeft: 12 }}><Icon name="home-outline" size={14} /> +{hb.base}</span> : null}
                  </>
                ) : (
                  <span><Icon name="person-outline" size={14} />{` ×${headCount} = +${hb.perHead * headCount}`}<Icon name="home-outline" size={14} style={{ marginLeft: 12 }} />{` +${hb.base}`}</span>
                )}
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
            <div
              className={`crm-rank-row${onOpenLeaderboard ? ' crm-rank-row--tappable' : ''}`}
              role={onOpenLeaderboard ? 'button' : undefined}
              tabIndex={onOpenLeaderboard ? 0 : undefined}
              onClick={onOpenLeaderboard ? () => onOpenLeaderboard('city') : undefined}
              onKeyDown={onOpenLeaderboard ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLeaderboard('city') } } : undefined}
            >
              <span className="crm-rank-flag" aria-hidden="true" style={{ color: 'var(--muted2)', lineHeight: 0 }}><Icon name="location-outline" size={16} /></span>
              <span className="crm-rank-label">
                {rankCity != null
                  ? t('scoreCelebration.rank.city',       { rank: rankCity, city: cityName ?? '' })
                  : t('scoreCelebration.rank.cityBeyond', { topN: rankTopN })}
              </span>
              {onOpenLeaderboard ? <span className="crm-rank-chevron" aria-hidden="true" style={{ lineHeight: 0 }}><Icon name="chevron-forward" size={16} /></span> : null}
            </div>
            <div
              className={`crm-rank-row${onOpenLeaderboard ? ' crm-rank-row--tappable' : ''}`}
              role={onOpenLeaderboard ? 'button' : undefined}
              tabIndex={onOpenLeaderboard ? 0 : undefined}
              onClick={onOpenLeaderboard ? () => onOpenLeaderboard('world') : undefined}
              onKeyDown={onOpenLeaderboard ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLeaderboard('world') } } : undefined}
            >
              <span className="crm-rank-flag" aria-hidden="true" style={{ color: 'var(--muted2)', lineHeight: 0 }}><Icon name="globe-outline" size={16} /></span>
              <span className="crm-rank-label">
                {rankGlobal != null
                  ? t('scoreCelebration.rank.world',       { rank: rankGlobal })
                  : t('scoreCelebration.rank.worldBeyond', { topN: rankTopN })}
              </span>
              {onOpenLeaderboard ? <span className="crm-rank-chevron" aria-hidden="true" style={{ lineHeight: 0 }}><Icon name="chevron-forward" size={16} /></span> : null}
            </div>
          </div>
        ) : null}

        {showRating ? (
          <div className="crm-rate-block">
            <div className="crm-rate-title">{t('result.rateTitle', { defaultValue: 'Rate this challenge' })}</div>
            <div className="crm-rate-stars">
              {[1, 2, 3, 4, 5].map(n => (
                <span
                  key={n}
                  role="button"
                  tabIndex={0}
                  onClick={() => setHostStars(n)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHostStars(n) } }}
                  style={{ fontSize: 28, lineHeight: 1, cursor: 'pointer', color: n <= hostStars ? '#FFC93C' : 'var(--border,#444)' }}
                >
                  <Icon name={n <= hostStars ? 'star' : 'star-outline'} size={28} />
                </span>
              ))}
            </div>
            <textarea
              className="crm-rate-note"
              placeholder={t('result.notePlaceholder', { defaultValue: 'Add a note (optional)' })}
              value={hostNote}
              onChange={(e) => setHostNote(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
        ) : null}

        <button
          type="button"
          className="crm-cta"
          disabled={savingRating || (showRating && hostStars === 0)}
          style={{ opacity: (savingRating || (showRating && hostStars === 0)) ? 0.5 : 1 }}
          onClick={async () => {
            if (showRating && hostStars > 0) {
              setSavingRating(true)
              try {
                if (showHostRating) await submitHostRating(reveal.challengeId, hostStars, hostNote)
                else await submitTakerRating(reveal.challengeId, hostStars, hostNote)
              } catch { /* non-fatal */ }
              setSavingRating(false)
            }
            onClose()
          }}
        >
          {savingRating ? '…' : (showRating ? t('result.saveRating', { defaultValue: 'Save rating' }) : t('result.cta', { defaultValue: 'Nice!' }))}
        </button>
      </div>
    </div>
  )
}
