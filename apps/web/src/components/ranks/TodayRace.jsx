import { useEffect, useState } from 'react'
import { fetchInbox, fetchRanks, markNotificationTypesRead } from '../../api'
import { useAwayShowsResults } from '../../lib/awayResults'
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
 * never over the hero: "🏆 Your photo finished #2 in the world yesterday · See results →". Hidden
 * while the away card carries them. A click opens Ranks › Photos › Yesterday on my photo (confetti);
 * ✕ dismisses it; both mark the results read (and clear the Ranks tab's dot).
 */
export function ResultsCard({ account }) {
  const { t } = useDc()
  const { openRanks } = useDaily()
  const { badges } = useNotifCounts()
  const inAway = useAwayShowsResults()
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
