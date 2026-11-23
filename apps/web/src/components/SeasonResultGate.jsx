import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSeasonResult, markSeasonSeen } from '../api'
import { RankMedal } from './daily/dailyShared'
import AvatarWithFlag from './AvatarWithFlag'
import i18n from '../i18n'

/**
 * The season's results on the web (scoring v2, as the app's SeasonResultGate): once a month,
 * after the drop of the 1st froze the season, my final rank (a medal for the top 3), the
 * season's podium and "a new season starts now". Shown once (POST /me/season-result/seen).
 */
export default function SeasonResultGate({ account, onPlay }) {
  const { t } = useTranslation('challenge', { keyPrefix: 'dc' })
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!account?.id) return
    let alive = true
    // After the reward screen had its chance (it opens on load).
    const id = setTimeout(() => fetchSeasonResult().then(r => { if (alive && r) setResult(r) }), 2500)
    return () => { alive = false; clearTimeout(id) }
  }, [account?.id])
  if (!result) return null
  const name = (() => { const [y, m] = result.season.split('-').map(Number); try { return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' }) } catch { return result.season } })()
  const close = (play) => { markSeasonSeen(result.season); setResult(null); if (play) onPlay?.() }
  return (
    <div className="v3-sheet-wrap season-result" role="dialog" aria-modal="true" aria-label={t('season.resultsKicker', { season: name })}>
      <button type="button" className="v3-sheet-scrim" onClick={() => close(false)} aria-label={t('season.close')} />
      <div className="v3-sheet season-result-card">
        <p className="dc-muted season-result-kicker">{t('season.resultsKicker', { season: name })}</p>
        {result.medal ? <RankMedal rank={result.rank} size={88} /> : <p className="season-result-rank">#{result.rank}</p>}
        <p className="v3-sheet-title">{result.medal ? t('season.medalTitle', { rank: result.rank }) : t('season.rankTitle', { rank: result.rank, count: result.players })}</p>
        <p className="dc-muted">{t('season.stats', { points: result.points, days: result.days, podiums: result.podiums })}</p>
        {result.podium.map(p => (
          <div key={p.rank} className="season-result-place">
            <RankMedal rank={p.rank} size={28} />
            <AvatarWithFlag userId={p.user.id} displayName={p.user.displayName ?? p.user.username} photoUrl={p.user.photoUrl} size={32} />
            <strong className="pp-ellipsis">{p.user.username ? '@' + p.user.username : p.user.displayName}</strong>
            <span>{t('ranks.pts', { count: p.points })}</span>
          </div>
        ))}
        <p>{t('season.newSeason')}</p>
        <button type="button" className="today-cta dc-full btn-primary" onClick={() => close(true)}>{t('season.play')}</button>
        <button type="button" className="dc-link" onClick={() => close(false)}>{t('season.close')}</button>
      </div>
    </div>
  )
}
