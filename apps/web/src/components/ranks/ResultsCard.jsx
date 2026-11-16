import { useEffect, useState } from 'react'
import { fetchInbox, markNotificationTypesRead } from '../../api'
import { useAwayCardShowing } from '../../lib/awayResults'
import { shortCityName } from '../../i18n/cityName'
import { useDaily, useDc } from '../daily/dailyShared'
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '../../lib/notifCounts'
import Icon from '../Icon'

/** The results line for my photo's daily_result ("🏆 Your photo finished #2 in the world yesterday"). */
export function resultsLine(d, t) {
  if (!d) return t('ranks.results.generic')
  const city = shortCityName(d.cityName ?? '')
  return d.worldRank ? t('ranks.results.world', { rank: d.worldRank })
    : d.cityBest ? t('ranks.results.best', { city })
    : d.cityRank ? t('ranks.results.city', { rank: d.cityRank, city })
    : typeof d.votes === 'number' ? t('ranks.results.votes', { count: d.votes })
    : t('ranks.results.generic')
}

/**
 * Yesterday's results on Today (V6, as the app), above the hero in the away card's place and style,
 * never over the hero: "🏆 Your photo finished #2 in the world yesterday · See results →". One card
 * at a time: it waits while the away card shows (that one often carries them). A click opens Ranks › Photos › Yesterday on my photo (confetti);
 * ✕ dismisses it; both mark the results read (and clear the Ranks tab's dot).
 */
export function ResultsCard({ account }) {
  const { t } = useDc()
  const { openRanks } = useDaily()
  const { badges } = useNotifCounts()
  const inAway = useAwayCardShowing()
  const pending = !!account && badges.ranks > 0
  const [result, setResult] = useState(undefined)
  useEffect(() => {
    if (!pending) { setResult(undefined); return undefined }
    let alive = true
    fetchInbox({ categories: ['game'], limit: 10 })
      .then(r => { if (alive) setResult(r.items.find(i => i.type === 'daily_result' && !i.read) ?? null) })
      .catch(() => { if (alive) setResult(null) })
    return () => { alive = false }
  }, [pending])
  if (!pending || inAway || result === undefined) return null
  const done = () => {
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, ranks: 0 } }))
    markNotificationTypesRead(['daily_result', 'daily_rank']).then(refreshNotifCounts)
  }
  const line = resultsLine(result?.data ?? null, t)
  return (
    <div className="r6-results">
      <button type="button" className="r6-results-body" onClick={() => { done(); openRanks({ tab: 'photos', period: 'yesterday', focus: 'me' }) }}>
        {line} <strong>{t('ranks.results.see')}</strong>
      </button>
      <button type="button" className="n6-away-close" onClick={done} aria-label={t('ranks.results.dismiss')}><Icon name="close" size={18} /></button>
    </div>
  )
}
