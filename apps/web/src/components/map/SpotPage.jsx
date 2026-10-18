import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import { fetchSpot } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { CityName } from '../CityName'
import { track } from '../../lib/analytics'
import { themeName, APP_STORE, PLAY_STORE, deviceStore, directionsUrl, formatPriceRange } from './spotsShared'
import Icon from '../Icon'
import { THEME_ICON } from '../../lib/icons'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

/** The ranking line ("Top voted this week in Saigon"), week first. */
function rankingLine(t, ranking) {
  if (!ranking?.cityName) return null
  const city = localizeCityName(ranking.cityName)
  if (ranking.week)    return ranking.week === 1 ? t('spot.rankWeekFirst', { city }) : t('spot.rankWeek', { rank: ranking.week, city })
  if (ranking.alltime) return ranking.alltime === 1 ? t('spot.rankAlltimeFirst', { city }) : t('spot.rankAlltime', { rank: ranking.alltime, city })
  return null
}

/**
 * A spot on the web (SPEC 9.5): its proofs' photos (paged), stats, the ranking
 * line, the latest captions, directions (OpenStreetMap) and "post your proof
 * here" in the app. Full screen.
 */
export default function SpotPage({ spotId, onBack }) {
  const { t, i18n } = useTranslation('challenge')
  const [data, setData]       = useState(null)
  const [photos, setPhotos]   = useState([])
  const [next, setNext]       = useState(null)
  const [missing, setMissing] = useState(false)
  const store = deviceStore()

  useEffect(() => {
    let alive = true
    fetchSpot(spotId)
      .then(d => {
        if (!alive) return
        if (!d) { setMissing(true); return }
        setData(d); setPhotos(d.photos.items); setNext(d.photos.nextOffset)
        track('web_spot_viewed', { spot: d.spot.id })
      })
      .catch(() => { if (alive) setMissing(true) })
    return () => { alive = false }
  }, [spotId])

  const more = () => {
    if (next === null) return
    fetchSpot(spotId, next).then(d => { if (d) { setPhotos(p => [...p, ...d.photos.items]); setNext(d.photos.nextOffset) } }).catch(() => {})
  }

  const spot  = data?.spot
  const price = spot ? formatPriceRange(spot.priceRange, i18n.language) : null
  const rank  = data ? rankingLine(t, data.ranking) : null

  return (
    <div className="full-page wm-spot">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{spot?.name ?? ''}</span>
      </div>
      <div className="page-body">
        {missing ? <p className="wm-empty">{t('spot.notFound')}</p> : !spot ? (
          <div className="wm-loading"><span className="wm-spinner" aria-hidden="true" /></div>
        ) : (
          <>
            <h1 className="wm-spot-name">{spot.name}</h1>
            <p className="wm-spot-meta">
              {spot.city?.name ? <CityName name={spot.city.name} country={spot.city.country} /> : null}
              {spot.themes.map((k, i) => (
                <span key={k} style={ROW}>{(i > 0 || spot.city?.name) && ' · '}<Icon name={THEME_ICON[k] ?? 'pricetag-outline'} size={14} />{themeName(k)}</span>
              ))}
            </p>
            {rank && <p className="wm-spot-rank" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="trophy-outline" size={16} />{rank}</p>}
            <p className="wm-spot-meta">
              {t('map.proofs', { count: spot.proofCount })} · {t('map.votes', { count: spot.votes })}
              {price ? ` · ${t('map.pricePaid', { price })}` : ''}
            </p>
            {(spot.validatedByLocal || spot.tags.length > 0) && (
              <div className="wm-spot-tags">
                {spot.validatedByLocal && <span className="wm-tag wm-tag--local" style={ROW}><Icon name="checkmark" size={14} />{t('map.validated')}</span>}
                {spot.tags.map(tag => <span key={tag} className="wm-tag">{tag}</span>)}
              </div>
            )}

            <div className="wm-spot-actions">
              <a className="wm-btn wm-btn--ghost" href={directionsUrl(spot.lat, spot.lng)} target="_blank" rel="noopener noreferrer"
                 onClick={() => track('web_spot_directions', { spot: spot.id })}>
                <Icon name="navigate-outline" size={18} />{t('map.directions')}
              </a>
              <a className="wm-btn" href={store === 'android' ? PLAY_STORE : APP_STORE} target="_blank" rel="noopener noreferrer"
                 onClick={() => track('web_app_map_card_clicked', { store: store ?? 'ios', placement: 'spot' })}>
                <Icon name="camera-outline" size={18} />{t('spot.proofInApp')}
              </a>
            </div>
            {!store && (
              <a className="wm-store-alt" href={PLAY_STORE} target="_blank" rel="noopener noreferrer"
                 onClick={() => track('web_app_map_card_clicked', { store: 'android', placement: 'spot' })}>Google Play</a>
            )}

            {photos.length > 0 && (
              <>
                <h2 className="wm-section">{t('spot.photos')}</h2>
                <div className="wm-photos">
                  {photos.map(p => (
                    <figure key={p.id} className="wm-photo">
                      <img src={p.thumbUrl || p.photoUrl} alt={p.caption || ''} loading="lazy" />
                      <figcaption>
                        <span>{p.user.displayName || p.user.username}{p.isLocal ? ` · ${t('spot.local')}` : ''}</span>
                        <span style={ROW}><Icon name="heart" size={12} />{p.voteCount}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {next !== null && <button type="button" className="wm-btn wm-btn--ghost wm-more" onClick={more}>{t('spot.morePhotos')}</button>}
              </>
            )}

            {data.captions.length > 0 && (
              <>
                <h2 className="wm-section">{t('spot.captions')}</h2>
                <ul className="wm-captions">
                  {data.captions.map((c, i) => (
                    <li key={i}>“{c.text}”{c.username ? <span className="wm-caption-by"> · {c.username}</span> : null}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
