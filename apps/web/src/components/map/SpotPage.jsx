import { useEffect, useState } from 'react'
import { shareLink } from '../../lib/shareLink'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import { fetchSpot } from '../../api'
import { localizeCityName, shortCityName } from '../../i18n/cityName'
import { CityName } from '../CityName'
import { track } from '../../lib/analytics'
import { themeName, deviceStore, formatPriceRange } from './spotsShared'
import { MAPS_APP_NAMES, directionsLink, getMapsApp, mapsApps, setMapsApp, travelMode } from '../../lib/directions'
import { openAppModal } from '../AppModal'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'
import { thumbFallback } from '../../lib/thumbFallback'
import { PickBadge, GoodToKnow } from './Pick'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }

/** The ranking line ("Top voted this week in Saigon"), week first. */
function rankingLine(t, ranking) {
  if (!ranking?.cityName) return null
  const city = shortCityName(ranking.cityName)
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
  const [copied, setCopied]   = useState(false)
  const [mode, setMode]       = useState(null)   // walking / driving, once known (SPEC 9.5)
  const [chooser, setChooser] = useState(false)
  const { t: tc } = useTranslation('common')
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
  // Walking under 2 km, driving beyond (only with a position already allowed).
  useEffect(() => {
    if (!spot) return
    let alive = true
    travelMode(spot.lat, spot.lng).then(m => { if (alive) setMode(m) })
    return () => { alive = false }
  }, [spot?.lat, spot?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  // Directions: Google Maps; iOS browsers pick Google or Apple Maps once (remembered, Me > Directions).
  const directions = (e) => {
    track('web_spot_directions', { spot: spot.id })
    if (mapsApps().length > 1 && !getMapsApp()) { e.preventDefault(); setChooser(true) }
  }
  const pickMaps = (app) => {
    setMapsApp(app)
    setChooser(false)
    window.open(directionsLink(app, spot.lat, spot.lng, mode), '_blank', 'noopener,noreferrer')
  }
  // Share (SPEC 9.14): hilads.live/s/{id}, whose preview is the spot's card.
  const share = async () => {
    if (!spot) return
    const city = spot.city?.name ? localizeCityName(spot.city.name) : null
    const text = city ? tc('shareLink.textSpotCity', { name: spot.name, city }) : tc('shareLink.textSpot', { name: spot.name })
    const res = await shareLink({ type: 'spot', path: `/s/${spot.id}`, text, source: 'spot_screen' })
    if (res === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  }
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
                <span key={k} style={ROW}>{(i > 0 || spot.city?.name) && ' · '}<Icon name={themeIcon(k)} size={14} />{themeName(k)}</span>
              ))}
            </p>
            {rank && <p className="wm-spot-rank" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="trophy-outline" size={16} />{rank}</p>}
            {spot.pick && <PickBadge />}
            {/* A pick alone has no answers to count. */}
            {(spot.proofCount > 0 || price) && (
              <p className="wm-spot-meta">
                {[spot.proofCount > 0 ? `${t('map.proofs', { count: spot.proofCount })} · ${t('map.votes', { count: spot.votes })}` : null,
                  price ? t('map.pricePaid', { price }) : null].filter(Boolean).join(' · ')}
              </p>
            )}
            <GoodToKnow note={spot.pick?.note} />
            {/* Represent your city (SPEC 9.16): the spot of its city's first approved proof ever. */}
            {spot.pioneerCity && (
              <div className="wm-spot-tags"><span className="wm-tag" style={ROW}><Icon name="flag-outline" size={14} />{tc('represent.spotOne', { city: shortCityName(spot.pioneerCity) })}</span></div>
            )}
            {(spot.validatedByLocal || spot.tags.length > 0) && (
              <div className="wm-spot-tags">
                {spot.validatedByLocal && <span className="wm-tag wm-tag--local" style={ROW}><Icon name="checkmark" size={14} />{t('map.validated')}</span>}
                {spot.tags.map(tag => <span key={tag} className="wm-tag">{tag}</span>)}
              </div>
            )}

            <div className="wm-spot-actions">
              <a className="wm-btn wm-btn--ghost" href={directionsLink(getMapsApp() ?? 'google', spot.lat, spot.lng, mode)} target="_blank" rel="noopener noreferrer"
                 onClick={directions}>
                <Icon name="navigate-outline" size={18} />{t('map.directions')}
              </a>
              <button type="button" className="wm-btn"
                 onClick={() => { track('web_app_map_card_clicked', { store: store ?? 'ios', placement: 'spot' }); openAppModal({ action: 'play', surface: 'spot' }) }}>
                <Icon name="camera-outline" size={18} />{t('spot.proofInApp')}
              </button>
              <button type="button" className="wm-btn wm-btn--ghost wm-spot-share" onClick={share}>
                <Icon name="share-social-outline" size={18} />{copied ? tc('shareLink.copied') : tc('shareLink.share')}
              </button>
            </div>

            {photos.length > 0 && (
              <>
                <h2 className="wm-section">{t('spot.photos')}</h2>
                <div className="wm-photos">
                  {photos.map(p => (
                    <figure key={p.id} className="wm-photo">
                      <img src={p.thumbUrl || p.photoUrl} onError={thumbFallback(p.photoUrl)} alt={p.caption || ''} loading="lazy" />
                      {/* A Hilads pick's photo: its credit, never votes. */}
                      <figcaption>
                        {p.pick
                          ? <span>{tc('pick.credit', { credit: p.credit || 'Hilads' })}</span>
                          : <>
                              <span>{p.user.displayName || p.user.username}{p.isLocal ? ` · ${t('spot.local')}` : ''}</span>
                              <span style={ROW}><Icon name="heart" size={12} />{p.voteCount}</span>
                            </>}
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
      {chooser && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={tc('directions.chooseTitle')}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setChooser(false)} aria-label={tc('cancel')} />
          <div className="v3-sheet">
            <span className="v3-sheet-grabber" aria-hidden="true" />
            <p className="v3-sheet-title">{tc('directions.chooseTitle')}</p>
            {mapsApps().map(app => (
              <button key={app} type="button" className="v3-scope-row" onClick={() => pickMaps(app)}>
                <span className="v3-scope-row-icon" aria-hidden="true"><Icon name="navigate-outline" size={20} /></span>
                <span className="v3-scope-row-body"><span className="v3-scope-row-title">{MAPS_APP_NAMES[app]}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
