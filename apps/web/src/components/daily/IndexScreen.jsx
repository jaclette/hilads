import { useEffect, useMemo, useRef, useState } from 'react'
import BackButton from '../BackButton'
import Icon from '../Icon'
import { CityFlag } from '../CityName'
import { fetchCompared } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { useDc } from './dailyShared'
import { ComparisonCard, comparisonTitle, shareComparison, useComparisonValue } from './Comparisons'

const SECTIONS = ['price', 'time', 'word']
const sectionOf = (c) => (c.kind === 'price' ? 'price' : c.kind === 'time' ? 'time' : 'word')
const cardId = (c) => `${c.kind}:${c.key}`

/**
 * The Hilads Index (SPEC 10.9): everything the world compared on Hilads, all
 * time (cities with 3 answers or more), in Prices, Times and Words (numbers go
 * with the words), with a search over the questions, cities and answers.
 * `focus` (kind:key) scrolls to a carousel card's comparison. "Two cities":
 * every comparison where both cities have data, side by side ("Saigon and
 * Lisbon", never "vs"). Readable without an account.
 */
export default function IndexScreen({ focus = null, onBack }) {
  const { t, i18n } = useDc()
  const value = useComparisonValue()
  const [cards, setCards] = useState(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [pair, setPair] = useState(null)       // [cityA | null, cityB | null], or null when closed
  const [picking, setPicking] = useState(null) // 0 | 1 | null
  const searched = useRef(false)
  const focused = useRef(false)

  useEffect(() => {
    let alive = true
    fetchCompared('all', i18n.language).then(d => { if (alive) setCards(d.cards) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [i18n.language])

  useEffect(() => {
    if (!searched.current && query.trim().length >= 2) {
      searched.current = true
      track('index_search_used', { length: query.trim().length, platform_surface: 'web' })
    }
  }, [query])

  // Focused from a carousel card: scroll to it once rendered.
  useEffect(() => {
    if (!cards || !focus || focused.current) return
    focused.current = true
    requestAnimationFrame(() => document.getElementById(`cmpx-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [cards, focus])

  const cities = useMemo(() => {
    const byId = new Map()
    ;(cards ?? []).forEach(c => c.rows.forEach(r => byId.set(r.city.id, r.city)))
    return [...byId.values()].sort((a, b) => shortCityName(a.name).localeCompare(shortCityName(b.name)))
  }, [cards])

  const q = query.trim().toLowerCase()
  const matches = (c) => !q
    || comparisonTitle(c, t).toLowerCase().includes(q)
    || c.rows.some(r => shortCityName(r.city.name).toLowerCase().includes(q) || (r.city.name ?? '').toLowerCase().includes(q)
                        || String(value(c, r.value)).toLowerCase().includes(q))
  const shown = (cards ?? []).filter(matches)

  const [a, b] = pair ?? [null, null]
  const both = a && b ? (cards ?? []).filter(c => c.rows.some(r => r.city.id === a.id) && c.rows.some(r => r.city.id === b.id)) : []
  useEffect(() => {
    if (a && b) track('two_cities_compared', { a: a.name, b: b.name, comparisons: both.length, platform_surface: 'web' })
  }, [a?.id, b?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickCity = (city) => {
    const next = [...(pair ?? [null, null])]
    next[picking ?? 0] = city
    setPair(next)
    setPicking(next[0] && !next[1] ? 1 : null)
  }

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('index.screenTitle')}</span>
      </div>
      <div className="page-body dc-body cmpx-body">
        {!cards ? (
          failed ? <p className="dc-muted dc-center">{t('loadFailed')}</p> : <div className="archive-loading"><span className="wm-spinner" aria-hidden="true" /></div>
        ) : (
          <>
            <p className="dc-muted cmpx-sub">{t('index.screenSub')}</p>

            {/* Two cities: pick two, see every comparison where both have data. */}
            {pair === null ? (
              <button type="button" className="cmpx-two-btn" disabled={cities.length < 2} onClick={() => { setPair([null, null]); setPicking(0) }}>
                <Icon name="git-compare-outline" size={20} />{t('index.twoCities')}
              </button>
            ) : (
              <div className="cmpx-pair">
                <div className="cmpx-pair-head">
                  <span className="cmpx-pair-title">{t('index.twoCities')}</span>
                  <button type="button" className="cmpx-close" onClick={() => { setPair(null); setPicking(null) }} aria-label={t('index.closeTwoCities')}><Icon name="close" size={20} /></button>
                </div>
                <div className="cmpx-pick">
                  {[a, b].map((c, i) => (
                    <button key={i} type="button" className="cmpx-pick-btn" onClick={() => setPicking(i)}>
                      {c ? <CityFlag country={c.country} size={18} /> : <Icon name="add" size={18} />}
                      <span className={c ? '' : 'dc-muted'}>{c ? shortCityName(c.name) : t('index.pickCity')}</span>
                    </button>
                  ))}
                </div>
                {a && b && (
                  <>
                    <p className="cmpx-pair-cities">{t('index.and', { a: shortCityName(a.name), b: shortCityName(b.name) })}</p>
                    {both.length === 0 ? <p className="dc-muted dc-center">{t('index.twoCitiesEmpty')}</p> : both.map(c => {
                      const ra = c.rows.find(r => r.city.id === a.id)
                      const rb = c.rows.find(r => r.city.id === b.id)
                      return (
                        <div key={cardId(c)} className="cmpx-pair-card">
                          <p className="cmpx-pair-q">{comparisonTitle(c, t)}</p>
                          <div className="cmpx-pair-cols">
                            {[ra, rb].map(r => (
                              <div key={r.city.id} className="cmpx-pair-col">
                                <span className="cmpx-pair-city"><CityFlag country={r.city.country} size={16} />{shortCityName(r.city.name)}</span>
                                <span className="cmpx-pair-value">{value(c, r.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}

            {pair === null && (
              <>
                <div className="wm-search">
                  <Icon name="search-outline" size={18} style={{ color: 'var(--muted2)' }} />
                  <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('index.search')} aria-label={t('index.search')} />
                  {query && <button type="button" className="wm-search-clear" onClick={() => setQuery('')} aria-label={t('index.clearSearch')}><Icon name="close" size={18} /></button>}
                </div>
                {cards.length === 0 ? <p className="dc-muted dc-center">{t('index.empty')}</p>
                  : shown.length === 0 ? <p className="dc-muted dc-center">{t('index.noResults')}</p>
                  : SECTIONS.map(s => {
                    const list = shown.filter(c => sectionOf(c) === s)
                    if (list.length === 0) return null
                    return (
                      <section key={s} className="cmpx-section">
                        <h2 className="cmpx-section-title">{t(`index.sections.${s}`)}</h2>
                        {list.map(c => (
                          <div key={cardId(c)} id={`cmpx-${cardId(c)}`} className="cmpx-anchor">
                            <ComparisonCard card={c} className={focus === cardId(c) ? 'cmpx-card--focused' : ''}
                                            onShare={() => shareComparison(c, t, value, 'index_screen')} />
                          </div>
                        ))}
                      </section>
                    )
                  })}
              </>
            )}
          </>
        )}
      </div>

      {picking !== null && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('index.pickCity')}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setPicking(null)} aria-label={t('index.pickCity')} />
          <div className="v3-sheet cmpx-sheet">
            <span className="v3-sheet-grabber" aria-hidden="true" />
            <p className="v3-sheet-title">{t('index.pickCity')}</p>
            <div className="cmpx-sheet-list">
              {cities.filter(c => c.id !== (picking === 0 ? b?.id : a?.id)).map(c => (
                <button key={c.id} type="button" className="cmpx-city-row" onClick={() => pickCity(c)}>
                  <CityFlag country={c.country} size={20} />{shortCityName(c.name)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
