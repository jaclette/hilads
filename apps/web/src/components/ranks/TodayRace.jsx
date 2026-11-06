import { useEffect, useState } from 'react'
import { fetchRanks, markNotificationTypesRead } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { FlagSticker } from '../joy/Joy'
import { getLastToday, useDaily, useDc } from '../daily/dailyShared'
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '../../lib/notifCounts'
import Icon from '../Icon'
import { MEDAL_EMOJI } from './parts'

/** "🏁 Today's race" (V6): the three leading cities, my city's position, "See ranks"; refreshed every minute. */
export function TodayRace() {
  const { t } = useDc()
  const { cityId, openRanks } = useDaily()
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => fetchRanks('cities', { period: 'today', cityId }).then(d => { if (alive) setData(d) }).catch(() => {})
    load()
    const id = setInterval(load, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [cityId])
  const top = data?.entries.slice(0, 3) ?? []
  if (top.length < 2) return null
  const mine = data.mine
  const myName = getLastToday()?.city?.name
  const where = mine ? t('ranks.race.you', { city: shortCityName(mine.city.name), rank: mine.rank })
    : myName ? t('ranks.race.youNone', { city: shortCityName(myName) }) : null
  return (
    <button type="button" className="r6-race" onClick={() => openRanks({ tab: 'cities', period: 'today' })}>
      <span className="r6-race-head"><strong>{t('ranks.race.title')}</strong><span className="r6-race-see">{t('ranks.race.see')}<Icon name="chevron-forward" size={14} /></span></span>
      <span className="r6-race-podium">
        {top.map((e, i) => (
          <span key={e.city.id} className="r6-race-slot">
            <span className="r6-race-medal">{MEDAL_EMOJI[i]}</span>
            <FlagSticker country={e.city.country} size={34} />
            <span className="r6-race-city">{shortCityName(e.city.name)}</span>
            <span className="r6-race-count">{t('today.proofs', { count: e.photos })}</span>
          </span>
        ))}
      </span>
      {where && <span className="r6-race-where">{where}</span>}
    </button>
  )
}

/** "🏆 Results are in!" (V6), once: while yesterday's results are unread; a click opens Ranks › Photos › Yesterday. */
export function ResultsCard() {
  const { t } = useDc()
  const { openRanks } = useDaily()
  const { badges } = useNotifCounts()
  if (!badges.ranks) return null
  const done = () => {
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, ranks: 0 } }))
    markNotificationTypesRead(['daily_result', 'daily_rank']).then(refreshNotifCounts)
  }
  return (
    <div className="r6-results">
      <button type="button" className="r6-results-body" onClick={() => { done(); openRanks({ tab: 'photos', period: 'yesterday' }) }}>
        <span className="r6-trophy">🏆</span>
        <span><strong>{t('ranks.results.title')}</strong><span>{t('ranks.results.sub')}</span></span>
      </button>
      <button type="button" className="n6-away-close" onClick={done} aria-label={t('ranks.results.dismiss')}><Icon name="close" size={18} /></button>
    </div>
  )
}
