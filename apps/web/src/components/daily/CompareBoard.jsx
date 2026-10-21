import { useEffect, useRef, useState } from 'react'
import { cachedDailyBoard, fetchDailyBoard, fetchDailySheet } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { CityFlag } from '../CityName'
import Icon from '../Icon'
import { useDc, ProofTile, SheetSkeleton } from './dailyShared'
import { answerText, useMoney } from './compareShared'
import { useBackLayer } from '../../lib/backLayers'

/**
 * The Compare tab of the challenge sheet (SPEC 10.6): "How the world answered",
 * the question, the range for number and time questions, the cheapest and
 * priciest city with the price fun fact, and one row per city (flag, short name, the
 * answer of its best proof, median price in my currency, proof count). A row
 * opens that city's proofs. Readable without an account.
 */
export default function CompareBoard({ date, source = 'tab', onOpenProof }) {
  const { t, i18n } = useDc()
  const money = useMoney()
  const [board, setBoard] = useState(() => cachedDailyBoard(date, i18n.language))   // prefetched by Today: instant, then refreshed
  const [failed, setFailed] = useState(false)
  const [city, setCity] = useState(null)
  useBackLayer(city !== null, () => setCity(null))   // a city's photos: browser back returns to every city
  const [cityProofs, setCityProofs] = useState(null)
  const tracked = useRef(false)

  useEffect(() => {
    let alive = true
    fetchDailyBoard(date, i18n.language)
      .then(b => {
        if (!alive) return
        setBoard(b)
        if (!tracked.current) {
          tracked.current = true
          track('world_board_viewed', { source, date, cities: b.cities, type: b.compare?.type ?? null, platform_surface: 'web' })
        }
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [date, i18n.language, source])

  useEffect(() => {
    if (!city) { setCityProofs(null); return }
    let alive = true
    fetchDailySheet(date, { scope: 'city', cityId: city.id, limit: 50, locale: i18n.language })
      .then(s => { if (alive) setCityProofs(s.proofs) })
      .catch(() => { if (alive) setCityProofs([]) })
    return () => { alive = false }
  }, [city, date, i18n.language])

  if (failed) return <p className="dc-muted dc-center">{t('loadFailed')}</p>
  if (!board) return <SheetSkeleton rows />

  if (city) {
    return (
      <div className="cmp">
        <button type="button" className="cmp-back" onClick={() => setCity(null)}><Icon name="chevron-back" size={16} />{t('compare.allCities')}</button>
        <p className="cmp-city-title"><CityFlag country={city.country} />{shortCityName(city.name)}</p>
        {cityProofs === null ? <p className="dc-muted">…</p> : (
          <div className="dc-grid">{cityProofs.map(p => <ProofTile key={p.id} proof={p} onOpen={() => onOpenProof(p)} />)}</div>
        )}
      </div>
    )
  }

  const range = board.range
  const prices = board.prices ?? null
  const cheapest = prices ? money.fromEur(prices.cheapest.eur) : null
  const priciest = prices ? money.fromEur(prices.priciest.eur) : null
  const keys = board.compare?.type === 'time' ? ['compare.earliest', 'compare.latest'] : ['compare.lowest', 'compare.highest']
  const ans = (a) => (a ? answerText(a, i18n.language) : '-')
  return (
    <div className="cmp">
      <p className="cmp-title">{t('compare.boardTitle')}</p>
      {board.compare && <p className="cmp-question">{board.compare.question}</p>}
      {/* The empty board has nothing to count (COPY.md: "Already 5 countries answered"). */}
      {board.rows.length > 0 && <p className="dc-muted">{t('compare.answeredRow', { count: board.countries })}</p>}
      {range && (
        <p className="cmp-range">
          {t(keys[0], { city: shortCityName(range.min.city.name), answer: ans(range.min.answer) })}
          {'  ·  '}
          {t(keys[1], { city: shortCityName(range.max.city.name), answer: ans(range.max.answer) })}
        </p>
      )}
      {prices && cheapest && priciest && (
        <p className="cmp-range">
          {t('compare.cheapest', { city: shortCityName(prices.cheapest.city.name), price: cheapest })}
          {'  ·  '}
          {t('compare.priciest', { city: shortCityName(prices.priciest.city.name), price: priciest })}
        </p>
      )}
      {/* The fun fact, only from twice the price (COPY.md): surprise, never a ranking. */}
      {prices && prices.ratio != null && prices.ratio >= 2 && (
        <p className="cmp-fun">
          {t('compare.funFact', {
            ratio: prices.ratio.toLocaleString(i18n.language, { maximumFractionDigits: prices.ratio >= 10 ? 0 : 1 }),
            city: shortCityName(prices.priciest.city.name), other: shortCityName(prices.cheapest.city.name),
          })}
        </p>
      )}
      {board.rows.length === 0 ? (
        <div className="dc-center">
          <Icon name="earth-outline" size={30} style={{ color: 'var(--muted2)' }} />
          <p className="dc-empty-title">{t('compare.emptyTitle')}</p>
          <p className="dc-muted">{t('compare.emptyBody')}</p>
        </div>
      ) : (
        <div className="cmp-table">
          {board.rows.map(r => {
            const price = money.fromEur(r.priceMedianEur)
            return (
              <button key={r.city.id} type="button" className="cmp-row" onClick={() => setCity(r.city)}>
                <CityFlag country={r.city.country} size={20} />
                <span className="cmp-row-body">
                  <span className="cmp-row-city">{shortCityName(r.city.name)}</span>
                  <span className={`cmp-row-answer${r.answer ? '' : ' cmp-row-answer--none'}`}>{r.answer ? ans(r.answer) : t('compare.noAnswer')}</span>
                </span>
                <span className="cmp-row-side">
                  {price && <span className="cmp-row-price">{t('compare.median', { price })}</span>}
                  <span className="cmp-row-count">{t('compare.proofs', { count: r.count })}</span>
                </span>
                <Icon name="chevron-forward" size={16} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

