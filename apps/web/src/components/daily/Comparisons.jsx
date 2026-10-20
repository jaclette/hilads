import { useEffect, useRef, useState } from 'react'
import { fetchCompared } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { CityFlag } from '../CityName'
import Icon from '../Icon'
import { HighlightText } from '../joy/Joy'
import { useDaily, useDc } from './dailyShared'
import { useMoney } from './compareShared'

const CARD_ROWS = 5

function formatTime(minutes, locale) {
  try {
    return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
}

/** A comparison's question: its title, or "How much is a beer?" for a price. */
export function comparisonTitle(card, t) {
  return card.kind === 'price' ? t('index.priceTitle', { label: card.priceLabel ?? '' }) : (card.title ?? '')
}

/** A city's usual value, as shown: a price in my currency, a time, a number with its unit, or the word. */
export function useComparisonValue() {
  const { i18n } = useDc()
  const money = useMoney()
  return (card, value) => {
    if (typeof value === 'string') return value
    if (card.kind === 'price') return money.fromEur(value) ?? `€${value.toFixed(2)}`
    if (card.kind === 'time') return formatTime(value, i18n.language)
    const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
    return card.unit ? `${n} ${card.unit}` : n
  }
}

/** Share a comparison: its question and one line per city, linking to its latest day. */
export function shareComparison(card, t, value, source) {
  track('index_shared', { card: card.key, source, platform_surface: 'web' })
  const lines = card.rows.map(r => `${shortCityName(r.city.name)} ${value(card, r.value)}`).join(' · ')
  shareLink({ type: 'index', path: card.date ? `/d/${card.date}` : '/today', text: `${comparisonTitle(card, t)} ${lines}`, source })
}

/**
 * One comparison (SPEC 10.9): its question, each city's usual price, time or
 * answer with its flag, the price fun fact and a share button. Never the word
 * "median". `rows` limits the cities shown (the carousel).
 */
export function ComparisonCard({ card, onOpen, onShare, rows, className = '' }) {
  const { t, i18n } = useDc()
  const value = useComparisonValue()
  const shown = rows ? card.rows.slice(0, rows) : card.rows
  const fun = card.funFact
  return (
    <div className={`cmpx-card${onOpen ? ' cmpx-card--link' : ''} ${className}`.trim()} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
         onClick={onOpen} onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen() } : undefined}>
      <div className="cmpx-head">
        <p className="cmpx-title">{comparisonTitle(card, t)}</p>
        <button type="button" className="index-share" aria-label={t('index.share')} onClick={(e) => { e.stopPropagation(); onShare() }}>
          <Icon name="share-social-outline" size={18} />
        </button>
      </div>
      {shown.map(r => (
        <div key={r.city.id} className="index-line">
          <CityFlag country={r.city.country} size={18} />
          <span className="index-city">{shortCityName(r.city.name)}</span>
          <span className={`index-value${card.kind === 'word' ? ' cmpx-word' : ''}`}>{value(card, r.value)}</span>
        </div>
      ))}
      {rows && card.rows.length > rows && <span className="dc-muted cmpx-more">{t('index.moreCities', { count: card.rows.length - rows })}</span>}
      {fun && fun.ratio >= 2 && (
        <p className="cmp-fun">
          {t('compare.funFact', {
            ratio: fun.ratio.toLocaleString(i18n.language, { maximumFractionDigits: fun.ratio >= 10 ? 0 : 1 }),
            city: shortCityName(fun.priciest.name), other: shortCityName(fun.cheapest.name),
          })}
        </p>
      )}
    </div>
  )
}

/**
 * "The world, compared" on Today (SPEC 10.9): last week's comparisons, one
 * card per shared key with at least 2 cities of 3 answers or more, then "See
 * all comparisons". A card opens the Index screen on it. Nothing without cards.
 */
export function IndexCarousel() {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const value = useComparisonValue()
  const [data, setData] = useState(null)
  const swiped = useRef(false)

  useEffect(() => {
    let alive = true
    fetchCompared('week', i18n.language).then(d => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [i18n.language])

  if (!data || data.cards.length === 0) return null
  const open = (focus, source) => {
    track('index_opened', { source, focus, platform_surface: 'web' })
    openDaily('index', { focus, source })
  }
  return (
    <div className="today-card index">
      <div className="today-card-head"><HighlightText className="today-card-title" text={t('index.carouselTitle')} /></div>
      <span className="dc-muted today-proofs-stats">{t('index.carouselSub')}</span>
      <div className="index-row" onScroll={() => {
        if (swiped.current) return
        swiped.current = true
        track('index_carousel_swiped', { cards: data.cards.length, platform_surface: 'web' })
      }}>
        {data.cards.map(card => (
          <ComparisonCard key={`${card.kind}:${card.key}`} card={card} rows={CARD_ROWS} className="cmpx-card--carousel"
                          onOpen={() => open(`${card.kind}:${card.key}`, 'carousel_card')}
                          onShare={() => shareComparison(card, t, value, 'index_today')} />
        ))}
        <button type="button" className="cmpx-card cmpx-card--carousel cmpx-all" onClick={() => open(null, 'carousel_all')}>
          <Icon name="earth-outline" size={28} />
          <span>{t('index.seeAllComparisons')}</span>
          <Icon name="arrow-forward" size={20} />
        </button>
      </div>
    </div>
  )
}
