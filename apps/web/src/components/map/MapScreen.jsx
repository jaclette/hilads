import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import SpotPage from './SpotPage'
import { fetchMap, searchSpots } from '../../api'
import { track } from '../../lib/analytics'
import { THEME_KEYS, THEME_NAMES, THEME_EMOJI, CITY_ZOOM, MIN_ZOOM, mapTiles, clusterPins } from './spotsShared'

const IDLE_MS = 350
// The camera stays around the city (like the app): about 110 km each way.
const CITY_SPAN = 1

const spotIcon = (spot) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-pin">${THEME_EMOJI[spot.themes?.[0]] || '📍'}</span>`,
  iconSize: [40, 40], iconAnchor: [20, 20],
})
const clusterIcon = (n) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-cluster">${n}</span>`,
  iconSize: [44, 44], iconAnchor: [22, 22],
})
const planIcon = () => L.divIcon({
  className: 'wm-pin-wrap',
  html: '<span class="wm-plan">🎉</span>',
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
  const areaRef = useRef(null)
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  const tiles = mapTiles(dark)

  useEffect(() => { track('web_map_opened', { city: cityName ?? null }) }, [cityName])

  // The city centre first (GET /map with the city), then the visible area.
  useEffect(() => {
    if (!channelId) return
    fetchMap({ cityId: channelId, theme: null })
      .then(d => {
        setCenter(d.city ? [d.city.lat, d.city.lng] : (d.spots[0] ? [d.spots[0].lat, d.spots[0].lng] : null))
        setSpots(d.spots); setPlans(d.plans)
        if (!d.city && !d.spots[0]) setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [channelId])

  const loadArea = useCallback((bbox, th = theme) => {
    areaRef.current = bbox
    fetchMap({ cityId: channelId, bbox, theme: th })
      .then(d => { setSpots(d.spots); setPlans(d.plans) })
      .catch(() => {})
  }, [channelId, theme])

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
        <span className="page-title">{cityName || t('map.button')}</span>
      </div>

      <div className="wm-top">
        <div className="wm-search">
          <span aria-hidden="true">🔎</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('map.search')}
            aria-label={t('map.searchA11y')}
          />
          {query && <button type="button" className="wm-search-clear" onClick={() => setQuery('')} aria-label={t('map.clearSearch')}>✕</button>}
        </div>
        {results === null ? (
          <div className="wm-chips" role="toolbar">
            <button type="button" className={`wm-chip${theme === null ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(null)}>{t('map.all')}</button>
            {THEME_KEYS.map(k => (
              <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(k)}>
                {THEME_EMOJI[k]} {THEME_NAMES[k]}
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
          <MapContainer center={center} zoom={CITY_ZOOM} minZoom={MIN_ZOOM} zoomControl={false} className="wm-leaflet"
                        maxBounds={[[center[0] - CITY_SPAN, center[1] - CITY_SPAN], [center[0] + CITY_SPAN, center[1] + CITY_SPAN]]}
                        maxBoundsViscosity={1}>
            <TileLayer url={tiles.url} attribution={tiles.attribution} tileSize={tiles.tileSize} zoomOffset={tiles.zoomOffset} maxZoom={19} />
            <MapWatcher onArea={bbox => loadArea(bbox)} onZoom={setZoom} />
            <CameraTo target={camera} />
            <Pins spots={spots} zoom={zoom} onSpot={setSelected}
                  onCluster={g => setCamera({ lat: g.lat, lng: g.lng, zoom: Math.min(zoom + 2, 18) })} />
            {plans.map(p => (
              <Marker key={`p:${p.id}`} position={[p.lat, p.lng]} icon={planIcon()} title={p.title}
                      eventHandlers={{ click: () => onOpenPlan?.(p.id) }} />
            ))}
          </MapContainer>
        ) : (
          <div className="wm-loading">{failed ? t('map.unavailable') : <span className="wm-spinner" aria-hidden="true" />}</div>
        )}
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
            <button type="button" className="wm-sheet-close" onClick={() => setSelected(null)} aria-label={t('map.closeSpot')}>✕</button>
            <button type="button" className="wm-sheet-body" onClick={() => setOpenSpotId(selected.id)}>
              {selected.cover?.thumbUrl ? <img className="wm-sheet-photo" src={selected.cover.thumbUrl} alt="" /> : <span className="wm-sheet-photo" />}
              <span className="wm-sheet-info">
                <span className="wm-sheet-title">{selected.name}</span>
                <span className="wm-sheet-meta">
                  {selected.themes.map(k => `${THEME_EMOJI[k]} ${THEME_NAMES[k]}`).join(' · ')}
                </span>
                <span className="wm-sheet-meta">
                  {t('map.proofs', { count: selected.proofCount })} · {t('map.votes', { count: selected.votes })}
                  {selected.validatedByLocal ? ` · ✓ ${t('map.validated')}` : ''}
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
