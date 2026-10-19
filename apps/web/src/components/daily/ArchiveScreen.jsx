import { useCallback, useEffect, useState } from 'react'
import BackButton from '../BackButton'
import Icon from '../Icon'
import { IndexCarousel } from './Comparisons'
import { fetchDailyArchive } from '../../api'
import { themeIcon } from '../../lib/icons'
import { THEME_KEYS, themeName } from '../map/spotsShared'
import { useDaily, useDc } from './dailyShared'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

/**
 * All past challenges (SPEC 9.3, Today's "All past challenges"): newest first,
 * each with its date, theme, text, a mosaic of its best photos and its counts
 * (proofs, countries in World). Theme chips filter; a challenge opens its
 * sheet, read-only. In the app's scope: World, or a live city's proofs.
 * Readable without an account. Paged by date.
 */
export default function ArchiveScreen({ onBack }) {
  const { t, i18n } = useDc()
  const { scope, cityId, openDaily } = useDaily()
  const [theme, setTheme] = useState(null)
  const [data, setData] = useState(null)     // { scope, items, hasMore }
  const [more, setMore] = useState(false)
  const params = { scope: scope === 'city' && cityId ? 'city' : 'world', cityId: scope === 'city' ? cityId : null, theme, locale: i18n.language }

  useEffect(() => {
    let alive = true
    setData(null)
    fetchDailyArchive(params).then(d => { if (alive) setData(d) }).catch(() => { if (alive) setData({ items: [], hasMore: false }) })
    return () => { alive = false }
  }, [theme, scope, cityId, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    const last = data?.items[data.items.length - 1]
    if (!last || !data.hasMore || more) return
    setMore(true)
    fetchDailyArchive({ ...params, before: last.challenge.date })
      .then(d => setData(prev => ({ ...d, items: [...prev.items, ...d.items.filter(i => !prev.items.some(p => p.challenge.id === i.challenge.id))] })))
      .catch(() => {})
      .finally(() => setMore(false))
  }, [data, more]) // eslint-disable-line react-hooks/exhaustive-deps

  const dateOf = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('today.archiveTitle')}</span>
      </div>
      <div className="page-body dc-body">
        {/* The world, compared (SPEC 10.9), above the past challenges. */}
        <IndexCarousel />
        <div className="wm-chips archive-chips" role="toolbar">
          <button type="button" className={`wm-chip${theme === null ? ' wm-chip--on' : ''}`} onClick={() => setTheme(null)}>{t('today.archiveAll')}</button>
          {THEME_KEYS.map(k => (
            <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={ROW} onClick={() => setTheme(k)}>
              <Icon name={themeIcon(k)} size={15} />{themeName(k)}
            </button>
          ))}
        </div>
        {data === null ? (
          <div className="archive-loading"><span className="wm-spinner" aria-hidden="true" /></div>
        ) : data.items.length === 0 ? (
          <p className="dc-muted archive-empty">{t('today.archiveEmpty')}</p>
        ) : (
          <div className="archive-list">
            {data.items.map(item => {
              const c = item.challenge
              const count = data.scope === 'city' ? item.counts.city ?? item.counts.world : item.counts.world
              const proofs = t('today.proofs', { count })
              return (
                <button key={c.id} type="button" className="archive-card" onClick={() => openDaily('challenge', { date: c.date, source: 'archive' })}>
                  <span className="archive-head">
                    <span className="dc-muted">{dateOf(c.date)}</span>
                    {c.theme && <span className="today-chip" style={ROW}><Icon name={themeIcon(c.theme.key, c.special)} size={14} />{themeName(c.theme.key, { special: c.special })}</span>}
                  </span>
                  <span className="archive-text">{c.text}</span>
                  {item.photos?.length > 0 && (
                    <span className={`archive-mosaic archive-mosaic--${Math.min(item.photos.length, 4)}`}>
                      {item.photos.slice(0, 4).map(p => <img key={p.proofId} src={p.thumbUrl} alt="" loading="lazy" />)}
                    </span>
                  )}
                  <span className="dc-muted">
                    {count === 0 ? t('today.proofs', { count: 0 })
                      : data.scope === 'world' ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: item.counts.countries ?? 0 }) }) : proofs}
                  </span>
                </button>
              )
            })}
            {data.hasMore && (
              <button type="button" className="dc-link archive-more" onClick={loadMore} disabled={more}>{t('today.archiveMore')}</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
