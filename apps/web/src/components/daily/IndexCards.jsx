import { useEffect, useRef, useState } from 'react'
import { fetchDailyIndex } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { themeName } from '../map/spotsShared'
import { CityFlag } from '../CityName'
import Icon from '../Icon'
import { useDc } from './dailyShared'
import { useMoney } from './compareShared'

/** Brand term: English in every locale. */
const HILADS_INDEX = 'Hilads Index'

function formatTime(minutes, locale) {
  try {
    return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
}

/**
 * The Hilads Index on the web (SPEC 10.9): last week's price and time cards,
 * cities with 3 proofs or more, lowest first, prices in my currency. Today on
 * Mondays and the archive; a card shares its day's link. Nothing without cards.
 */
export default function IndexCards({ source }) {
  const { t, i18n } = useDc()
  const money = useMoney()
  const [index, setIndex] = useState(null)
  const tracked = useRef(null)

  useEffect(() => {
    let alive = true
    fetchDailyIndex(undefined, i18n.language).then(r => { if (alive) setIndex(r) }).catch(() => {})
    return () => { alive = false }
  }, [i18n.language])
  useEffect(() => {
    if (!index || index.cards.length === 0 || tracked.current === index.weekStart) return
    tracked.current = index.weekStart
    track('index_viewed', { source, week: index.weekStart, cards: index.cards.length, platform_surface: 'web' })
  }, [index, source])

  if (!index || index.cards.length === 0) return null
  const value = (kind, v) => (kind === 'time' ? formatTime(v, i18n.language) : money.fromEur(v) ?? `€${v.toFixed(2)}`)
  return (
    <div className="today-card index">
      <div className="today-card-head"><span className="today-card-title">{t('index.title')}</span></div>
      <span className="dc-muted today-proofs-stats">{t('index.sub')}</span>
      <div className="index-row">
        {index.cards.map(card => {
          const theme = card.challenge.theme ? themeName(card.challenge.theme.key, { special: card.challenge.special }) : ''
          const label = card.kind === 'time' && card.challenge.compare ? card.challenge.compare.question : t('index.pricePaid')
          const lines = card.rows.map(r => `${shortCityName(r.city.name)} ${value(card.kind, r.value)}`).join(' · ')
          return (
            <div key={card.id} className="index-card">
              <div className="index-head">
                <span className="index-kicker">{`${HILADS_INDEX} · ${theme}`}</span>
                <button type="button" className="index-share" aria-label={t('index.share')} onClick={() => {
                  track('index_shared', { card: card.id, week: index.weekStart, source, platform_surface: 'web' })
                  shareLink({ type: 'index', path: `/d/${card.date}`, text: t('index.shareText', { lines }), source: `index_${source}` })
                }}><Icon name="share-social-outline" size={18} /></button>
              </div>
              <p className="index-title">{card.challenge.text}</p>
              <p className="index-label">{label}</p>
              {card.rows.map(r => (
                <div key={r.city.id} className="index-line">
                  <CityFlag country={r.city.country} size={18} />
                  <span className="index-city">{shortCityName(r.city.name)}</span>
                  <span className="index-value">{value(card.kind, r.value)}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
