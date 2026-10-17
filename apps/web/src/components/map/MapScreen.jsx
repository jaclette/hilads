import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import SpotPage from './SpotPage'
import { fetchMap, searchSpots } from '../../api'
import { track } from '../../lib/analytics'
import { THEME_KEYS, THEME_NAMES, CITY_ZOOM, MIN_ZOOM, mapTiles, clusterPins } from './spotsShared'
import Icon, { iconHtml } from '../Icon'
import { THEME_ICON } from '../../lib/icons'

const IDLE_MS = 350
const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
// The camera stays around the city (like the app): about 110 km each way.
const CITY_SPAN = 1
// Within this distance of the city centre, "where I am" just moves the camera;
// further away, the map re-centres on me and shows the spots around me.
const NEAR_CITY_KM = 50

function km(a, b) {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = (b[0] - a[0]) * r
  return Math.sqrt(x * x + y * y) * 6371
}

const spotIcon = (spot) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-pin" style="color: var(--primary)">${iconHtml(THEME_ICON[spot.themes?.[0]] || 'location-outline', 20)}</span>`,
  iconSize: [40, 40], iconAnchor: [20, 20],
})
const clusterIcon = (n) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-cluster">${n}</span>`,
  iconSize: [44, 44], iconAnchor: [22, 22],
})
const meIcon = L.divIcon({
  className: 'wm-pin-wrap',
  html: '<span class="wm-me"></span>',
  iconSize: [22, 22], iconAnchor: [11, 11],
})
const planIcon = () => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-plan" style="color: var(--accent2)">${iconHtml('calendar-outline', 18)}</span>`,
  iconSize: [36, 36], iconAnchor: [18, 18],
})

/** Reports the visible area (debounced) and the zoom; keeps the camera on the city. */
function MapWatcher({ onArea, onZoom }) {
  const timer = useRef(null)
  const map = useMapEvents({
    moveend: () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const b = map.getBounds()
        onArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      }, IDLE_MS)
    },
    zoomend: () => onZoom(map.getZoom()),
  })
  useEffect(() => {
    const b = map.getBounds()
    onArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    return () => clearTimeout(timer.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Moves the camera when the parent asks (search pick, cluster tap). */
function CameraTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView([target.lat, target.lng], target.zoom, { animate: true })
  }, [target, map])
  return null
}

/** Pins grouped by screen distance at the current zoom. */
function Pins({ spots, zoom, onSpot, onCluster }) {
  const map = useMap()
  const groups = useMemo(
    () => clusterPins(spots, (lat, lng) => map.project([lat, lng], zoom)),
    [spots, zoom, map],
  )
  return groups.map(g => g.items.length === 1 ? (
    <Marker key={g.items[0].id} position={[g.lat, g.lng]} icon={spotIcon(g.items[0])}
            eventHandlers={{ click: () => onSpot(g.items[0]) }} title={g.items[0].name} />
  ) : (
    <Marker key={`c:${g.items.map(s => s.id).join(',')}`} position={[g.lat, g.lng]} icon={clusterIcon(g.items.length)}
            eventHandlers={{ click: () => onCluster(g) }} />
  ))
}

/**
 * The web map of spots (SPEC 9.5, same API as the app's Map tab): the current
 * city's spots and Hi plans, theme chips, search, and a spot page. Full screen.
 */
export default function MapScreen({ channelId, cityName, onClose, onOpenPlan, initialSpotId = null }) {
  const { t } = useTranslation('challenge')
  const [center, setCenter]   = useState(null)
  const [spots, setSpots]     = useState([])
  const [plans, setPlans]     = useState([])
  const [zoom, setZoom]       = useState(CITY_ZOOM)
  const [theme, setTheme]     = useState(null)
  const [selected, setSelected] = useState(null)
  const [openSpotId, setOpenSpotId] = useState(initialSpotId)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState(null)
  const [camera, setCamera]   = useState(null)
  const [failed, setFailed]   = useState(false)
  const [me, setMe]           = useState(null)      // my position, once the browser gives it
  const [nearMe, setNearMe]   = useState(false)     // far from the city: the map is around me
  const [notice, setNotice]   = useState(null)
  const areaRef = useRef(null)
  const cityCenterRef = useRef(null)
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  const tiles = mapTiles(dark)

  useEffect(() => { track('web_map_opened', { city: cityName ?? null }) }, [cityName])

  // The city centre first (GET /map with the city), then the visible area.
  useEffect(() => {
    if (!channelId) return
    fetchMap({ cityId: channelId, theme: null })
      .then(d => {
        const c = d.city ? [d.city.lat, d.city.lng] : (d.spots[0] ? [d.spots[0].lat, d.spots[0].lng] : null)
        cityCenterRef.current = c
        setCenter(c)
        setSpots(d.spots); setPlans(d.plans)
        if (!c) setFailed(true)
        // Location already allowed for this site: use it without asking.
        navigator.permissions?.query({ name: 'geolocation' })
          .then(p => { if (p.state === 'granted') locate(false) })
          .catch(() => {})
      })
      .catch(() => setFailed(true))
  }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Where I am: near the city, the camera moves to me; far from it (another
  // city, travelling), the map re-centres on me with the spots around me.
  const locate = (asked) => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      const here = [pos.coords.latitude, pos.coords.longitude]
      const city = cityCenterRef.current
      const near = !!city && km(city, here) <= NEAR_CITY_KM
      setMe(here)
      track('web_map_located', { auto: !asked, near_city: near })
      if (near) {
        setCamera({ lat: here[0], lng: here[1], zoom: Math.max(zoom, 15) })
      } else {
        setNearMe(true); setSelected(null); setSpots([]); setPlans([])
        setCenter(here)
      }
    }, err => {
      if (asked) setNotice(err.code === 1 ? t('map.locationDenied') : t('map.locationFailed'))
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 })
  }

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

  const loadArea = useCallback((bbox, th = theme) => {
    areaRef.current = bbox
    fetchMap({ cityId: nearMe ? null : channelId, bbox, theme: th })
      .then(d => { setSpots(d.spots); setPlans(d.plans) })
      .catch(() => {})
  }, [channelId, theme, nearMe])

  const pickTheme = (k) => {
    const next = theme === k ? null : k
    setTheme(next)
    setSelected(null)
    if (areaRef.current) loadArea(areaRef.current, next)
  }

  // Search: name or dish tag, in the city.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); return }
    const id = setTimeout(() => {
      searchSpots(q, { cityId: channelId }).then(setResults).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(id)
  }, [query, channelId])

  const focusSpot = (s) => {
    setQuery(''); setResults(null)
    setSelected(s)
    setCamera({ lat: s.lat, lng: s.lng, zoom: Math.max(zoom, 16) })
  }

  if (openSpotId) {
    return <SpotPage spotId={openSpotId} onBack={() => setOpenSpotId(null)} />
  }

  return (
    <div className="full-page full-page--tab wm-page">
      <div className="page-header">
        <BackButton onClick={onClose} />
        <span className="page-title">{nearMe ? t('map.nearYou') : (cityName || t('map.button'))}</span>
      </div>

      <div className="wm-top">
        <div className="wm-search">
          <Icon name="search-outline" size={18} style={{ color: 'var(--muted2)' }} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('map.search')}
            aria-label={t('map.searchA11y')}
          />
          {query && <button type="button" className="wm-search-clear" onClick={() => setQuery('')} aria-label={t('map.clearSearch')}><Icon name="close" size={18} /></button>}
        </div>
        {results === null ? (
          <div className="wm-chips" role="toolbar">
            <button type="button" className={`wm-chip${theme === null ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(null)}>{t('map.all')}</button>
            {THEME_KEYS.map(k => (
              <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={ROW} onClick={() => pickTheme(k)}>
                <Icon name={THEME_ICON[k]} size={15} />{THEME_NAMES[k]}
              </button>
            ))}
          </div>
        ) : (
          <div className="wm-results">
            {results.length === 0 ? <p className="wm-empty">{t('map.noResults')}</p> : results.map(s => (
              <button key={s.id} type="button" className="wm-result" onClick={() => focusSpot(s)}>
                <span className="wm-result-name">{s.name}</span>
                <span className="wm-result-meta">{t('map.proofs', { count: s.proofCount })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wm-map">
        {center ? (
          <MapContainer key={center.join(',')} center={center} zoom={CITY_ZOOM} minZoom={MIN_ZOOM} zoomControl={false} className="wm-leaflet"
                        maxBounds={[[center[0] - CITY_SPAN, center[1] - CITY_SPAN], [center[0] + CITY_SPAN, center[1] + CITY_SPAN]]}
                        maxBoundsViscosity={1}>
            <TileLayer url={tiles.url} attribution={tiles.attribution} tileSize={tiles.tileSize} zoomOffset={tiles.zoomOffset} maxZoom={19} />
            <MapWatcher onArea={bbox => loadArea(bbox)} onZoom={setZoom} />
            <CameraTo target={camera} />
            <Pins spots={spots} zoom={zoom} onSpot={setSelected}
                  onCluster={g => setCamera({ lat: g.lat, lng: g.lng, zoom: Math.min(zoom + 2, 18) })} />
            {me && <Marker position={me} icon={meIcon} interactive={false} />}
            {plans.map(p => (
              <Marker key={`p:${p.id}`} position={[p.lat, p.lng]} icon={planIcon()} title={p.title}
                      eventHandlers={{ click: () => onOpenPlan?.(p.id) }} />
            ))}
          </MapContainer>
        ) : (
          <div className="wm-loading">{failed ? t('map.unavailable') : <span className="wm-spinner" aria-hidden="true" />}</div>
        )}
        {center && (
          <button type="button" className="wm-locate" onClick={() => locate(true)} aria-label={t('map.locate')} title={t('map.locate')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        )}
        {notice && <div className="wm-notice" role="status">{notice}</div>}
        {tiles.mapbox && (
          <a className="wm-mapbox-logo" href="https://www.mapbox.com/" target="_blank" rel="noopener noreferrer" aria-label="Mapbox">mapbox</a>
        )}
        {center && spots.length === 0 && plans.length === 0 && !selected && (
          <div className="wm-sheet wm-sheet--empty">
            <p className="wm-sheet-title">{t('map.emptyTitle')}</p>
          </div>
        )}
        {selected && (
          <div className="wm-sheet">
            <button type="button" className="wm-sheet-close" onClick={() => setSelected(null)} aria-label={t('map.closeSpot')}><Icon name="close" size={20} /></button>
            <button type="button" className="wm-sheet-body" onClick={() => setOpenSpotId(selected.id)}>
              {selected.cover?.thumbUrl ? <img className="wm-sheet-photo" src={selected.cover.thumbUrl} alt="" /> : <span className="wm-sheet-photo" />}
              <span className="wm-sheet-info">
                <span className="wm-sheet-title">{selected.name}</span>
                <span className="wm-sheet-meta">
                  {selected.themes.map((k, i) => (
                    <span key={k} style={ROW}>{i > 0 && ' · '}<Icon name={THEME_ICON[k] ?? 'pricetag-outline'} size={13} />{THEME_NAMES[k]}</span>
                  ))}
                </span>
                <span className="wm-sheet-meta">
                  {t('map.proofs', { count: selected.proofCount })} · {t('map.votes', { count: selected.votes })}
                  {selected.validatedByLocal && <> · <span style={ROW}><Icon name="checkmark" size={13} />{t('map.validated')}</span></>}
                </span>
              </span>
            </button>
            <button type="button" className="wm-sheet-cta" onClick={() => setOpenSpotId(selected.id)}>{t('map.openSpot')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
