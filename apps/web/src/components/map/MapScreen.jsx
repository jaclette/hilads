import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../lib/leafletGuard'
import { useTranslation } from 'react-i18next'
import SpotPage from './SpotPage'
import { fetchMap, searchSpots, fetchDailyToday } from '../../api'
import { track } from '../../lib/analytics'
import { THEME_KEYS, themeName, CITY_ZOOM, MIN_ZOOM, mapTiles, clusterPins, pinLabel, placeLabels, APP_STORE, PLAY_STORE, deviceStore, compactPrice, formatDistance, sortSpots } from './spotsShared'
import Icon, { iconHtml } from '../Icon'
import { THEME_ICON } from '../../lib/icons'
import { useDaily } from '../daily/dailyShared'
import HeaderArt from '../HeaderArt'

const IDLE_MS = 350
// The last view (map or list), remembered on this device.
const VIEW_KEY = 'hilads_map_view'
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

// Pin labels from this zoom (the city view), where they stay readable.
const LABEL_MIN_ZOOM = 14
const LABEL_FONT = '700 12px'

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

let measureCtx = null
/** Rendered width of a label (the text plus its padding), in pixels. */
function labelWidth(text) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
    measureCtx.font = `${LABEL_FONT} ${getComputedStyle(document.body).fontFamily}`
  }
  return Math.ceil(measureCtx.measureText(text).width) + 16
}

// 44 px: the tap target (the label, when shown, is tappable too).
const spotIcon = (spot, label, side, selected) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-pin${selected ? ' wm-pin--on' : ''}" style="color: var(--primary)">${iconHtml(THEME_ICON[spot.themes?.[0]] || 'location-outline', 20)}</span>`
    + (side ? `<span class="wm-pin-label wm-pin-label--${side}${selected ? ' wm-pin-label--on' : ''}">${escapeHtml(label)}</span>` : ''),
  iconSize: [44, 44], iconAnchor: [22, 22],
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

/** Moves the camera when the parent asks (search pick, cluster tap, the city's spots). */
function CameraTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target?.bounds) map.fitBounds(target.bounds, { padding: [48, 48], maxZoom: CITY_ZOOM + 1, animate: false })
    else if (target) map.setView([target.lat, target.lng], target.zoom, { animate: true })
  }, [target, map])
  return null
}

/** The theme a date gets by default (its weekday's; THEME_KEYS is Monday first). */
function defaultThemeFor(date) {
  const iso = new Date(`${date}T12:00:00Z`).getUTCDay() || 7
  return THEME_KEYS[iso - 1]
}

/**
 * Pins grouped by screen distance at the current zoom (the selected spot
 * stays out of the groups), with labels where they fit: see placeLabels.
 */
function Pins({ spots, zoom, selected, onSpot, onCluster }) {
  const map = useMap()
  const { i18n } = useTranslation()
  const groups = useMemo(() => {
    const others = clusterPins(spots.filter(s => s.id !== selected?.id), (lat, lng) => map.project([lat, lng], zoom))
    return selected ? [...others, { items: [selected], lat: selected.lat, lng: selected.lng }] : others
  }, [spots, selected, zoom, map])
  const labels = useMemo(() => {
    const text = new Map()
    const pins = []
    const obstacles = []
    groups.forEach(g => {
      const p = map.project([g.lat, g.lng], zoom)
      if (g.items.length > 1) { obstacles.push({ x1: p.x - 22, y1: p.y - 22, x2: p.x + 22, y2: p.y + 22, id: 'c' }); return }
      const s = g.items[0]
      const isSelected = s.id === selected?.id
      if (zoom < LABEL_MIN_ZOOM && !isSelected) { pins.push({ id: s.id, x: p.x, y: p.y, w: 0, selected: false, rank: 0, off: true }); return }
      const label = pinLabel(s.name, s.priceRange, i18n.language)
      text.set(s.id, label)
      pins.push({ id: s.id, x: p.x, y: p.y, w: labelWidth(label), selected: isSelected, rank: -(s.proofCount * 1000 + s.votes) })
    })
    const vb = map.getPixelBounds()
    const sides = placeLabels(pins.filter(p => !p.off), [...obstacles, ...pins.filter(p => p.off).map(p => ({ x1: p.x - 22, y1: p.y - 22, x2: p.x + 22, y2: p.y + 22, id: p.id }))],
                              { view: { x1: vb.min.x, y1: vb.min.y, x2: vb.max.x, y2: vb.max.y } })
    return { text, sides }
  }, [groups, zoom, map, selected?.id, i18n.language])
  return groups.map(g => g.items.length === 1 ? (
    <Marker key={g.items[0].id} position={[g.lat, g.lng]} zIndexOffset={g.items[0].id === selected?.id ? 1000 : 0}
            icon={spotIcon(g.items[0], labels.text.get(g.items[0].id), labels.sides.get(g.items[0].id), g.items[0].id === selected?.id)}
            eventHandlers={{ click: () => onSpot(g.items[0]) }} title={g.items[0].name} />
  ) : (
    <Marker key={`c:${g.items.map(s => s.id).join(',')}`} position={[g.lat, g.lng]} icon={clusterIcon(g.items.length)}
            eventHandlers={{ click: () => onCluster(g) }} />
  ))
}

/**
 * The list view (like the app's): the area's spots with the map's search and
 * theme filter, by distance or this week's votes. A row: proof photo, name,
 * theme, distance (when my position is known), median price, votes,
 * "validated by a local". Tapping opens the spot sheet.
 */
function SpotListView({ spots, sort, onSort, me, origin, onPick, empty, t }) {
  const { i18n } = useTranslation()
  const data = sortSpots(spots, sort, origin, km)
  return (
    <div className="wm-list">
      <div className="wm-list-sorts">
        <button type="button" className={`wm-chip${sort === 'near' ? ' wm-chip--on' : ''}`} onClick={() => onSort('near')}>{t('map.sortNearest')}</button>
        <button type="button" className={`wm-chip${sort === 'week' ? ' wm-chip--on' : ''}`} onClick={() => onSort('week')}>{t('map.sortWeek')}</button>
      </div>
      {data.length === 0 && empty && <p className="wm-empty">{t('map.noResults')}</p>}
      {data.map(s => {
        const th = s.themes?.[0] ?? null
        const p = s.priceRange
        const median = p ? (p.median ?? (p.min === p.max ? p.min : null)) : null
        const meta = [
          me ? formatDistance(km(me, [s.lat, s.lng]) * 1000, i18n.language) : null,
          median != null ? compactPrice(median, p.currency, i18n.language) : null,
        ].filter(Boolean).join(' · ')
        return (
          <button key={s.id} type="button" className="wm-row" onClick={() => onPick(s)}>
            {s.cover?.thumbUrl || s.cover?.photoUrl
              ? <img className="wm-row-photo" src={s.cover.thumbUrl || s.cover.photoUrl} alt="" loading="lazy" />
              : <span className="wm-row-photo wm-row-photo--empty"><Icon name={THEME_ICON[th] || 'location-outline'} size={22} /></span>}
            <span className="wm-row-body">
              <span className="wm-row-name">{s.name}</span>
              <span className="wm-row-chips">
                {th && <span className="wm-row-theme" style={ROW}><Icon name={THEME_ICON[th]} size={12} />{themeName(th)}</span>}
                {s.validatedByLocal && <span className="wm-row-local" style={ROW}><Icon name="checkmark" size={12} />{t('map.validated')}</span>}
              </span>
              <span className="wm-row-meta">
                {meta && <span>{meta}</span>}
                <span style={ROW}><Icon name="heart" size={12} />{sort === 'week' ? s.votesWeek : s.votes}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A city without spots: "Be the first to put a spot here" with today's
 * challenge. On a place theme, "Take it" opens the store (proofs are posted
 * from the app); on a Language day, a line names tomorrow's theme.
 */
function EmptyCard({ today, t }) {
  const { openDaily } = useDaily()
  const challenge = today?.challenge ?? null
  const placeTheme = !!challenge?.theme && challenge.theme.key !== 'language'
  const tomorrowKey = today?.tomorrow?.theme?.key
    ?? (challenge ? defaultThemeFor(new Date(Date.parse(`${challenge.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) : null)
  const store = deviceStore()
  const canTake = challenge?.isActive && !today?.myProof && placeTheme
  const body = (
    <>
      <span className="wm-sheet-title" style={ROW}><Icon name="location-outline" size={20} style={{ color: 'var(--primary-text)' }} />{t('map.emptyTitle')}</span>
      {challenge && <span className="wm-empty-text">{challenge.text}</span>}
      {canTake && <span className="wm-sheet-cta">{t('dc.takeIt')}</span>}
      {challenge?.isActive && !placeTheme && tomorrowKey && <span className="wm-empty-tomorrow">{t('map.spotsTomorrow', { theme: themeName(tomorrowKey) })}</span>}
    </>
  )
  // The whole card is the tap target: the store on a place theme (proofs are
  // posted from the app), else today's challenge.
  if (canTake) {
    return (
      <a className="wm-sheet wm-sheet--empty" href={store === 'android' ? PLAY_STORE : APP_STORE} target="_blank" rel="noopener noreferrer"
         onClick={() => track('web_today_take_clicked', { store: store ?? 'ios', surface: 'map_empty' })}>
        {body}
      </a>
    )
  }
  return (
    <button type="button" className="wm-sheet wm-sheet--empty" disabled={!challenge}
            onClick={() => challenge && openDaily('challenge', { date: challenge.date, source: 'map_empty' })}>
      {body}
    </button>
  )
}

/**
 * The web map of spots (SPEC 9.5, same API as the app's Map tab): the current
 * city's spots and Hi plans, theme chips, search, and a spot page. Full screen.
 */
export default function MapScreen({ channelId, cityName, onOpenPlan, initialSpotId = null }) {
  const { t, i18n } = useTranslation('challenge')
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
  const [view, setView]       = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map' } catch { return 'map' } })
  const [sort, setSort]       = useState('near')
  const [cityEmpty, setCityEmpty] = useState(false)  // the city really has no spot (not just the visible area)
  const [today, setToday]     = useState(null)
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
        setCityEmpty(d.spots.length === 0)
        // A city's stored centre can be kilometres from its spots: without my
        // position (asked below), frame the spots.
        if (d.spots.length > 1) setCamera({ bounds: d.spots.map(s => [s.lat, s.lng]) })
        else if (d.spots.length === 1) setCamera({ lat: d.spots[0].lat, lng: d.spots[0].lng, zoom: CITY_ZOOM + 1 })
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

  // Today's challenge, for the empty city card.
  useEffect(() => {
    if (!channelId) return
    fetchDailyToday(channelId, i18n.language).then(setToday).catch(() => {})
  }, [channelId, i18n.language])

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

  const toggleView = () => {
    const next = view === 'map' ? 'list' : 'map'
    setView(next); setSelected(null)
    track('web_map_view_switched', { view: next })
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private mode */ }
  }
  // The list shares the map's state: the search hits (in the theme) or the area's spots.
  const listSpots = results !== null ? results.filter(s => theme === null || s.themes.includes(theme)) : spots
  const areaCentre = areaRef.current ? [(areaRef.current[1] + areaRef.current[3]) / 2, (areaRef.current[0] + areaRef.current[2]) / 2] : center
  const showEmpty = center && !selected && (nearMe ? spots.length === 0 && plans.length === 0 : cityEmpty)

  if (openSpotId) {
    return <SpotPage spotId={openSpotId} onBack={() => setOpenSpotId(null)} />
  }

  return (
    <div className="full-page full-page--tab wm-page">
      <div className="page-header has-art">
        <HeaderArt kind="map" />
        <div className="tab-heading">
          <span className="page-title">{nearMe ? t('map.nearYou') : (cityName || t('map.button'))}</span>
          <p className="tab-subtitle">{t('subtitles.map', { ns: 'common' })}</p>
        </div>
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
        {results === null || view === 'list' ? (
          <div className="wm-chips" role="toolbar">
            <button type="button" className={`wm-chip${theme === null ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(null)}>{t('map.all')}</button>
            {THEME_KEYS.map(k => (
              <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={ROW} onClick={() => pickTheme(k)}>
                <Icon name={THEME_ICON[k]} size={15} />{themeName(k)}
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
            <Pins spots={spots} zoom={zoom} selected={selected} onSpot={setSelected}
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
        {center && view === 'map' && (
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
        {view === 'list' && center && (
          <SpotListView spots={listSpots} sort={sort} onSort={k => { setSort(k); track('web_map_list_sorted', { sort: k }) }}
                        me={me} origin={me ?? areaCentre} onPick={setSelected} empty={!showEmpty} t={t} />
        )}
        {/* Bottom: the List / Map switch, then the selected spot or the empty city. */}
        <div className="wm-bottom">
          {center && (
            <button type="button" className="wm-toggle" onClick={toggleView}>
              <Icon name={view === 'map' ? 'list-outline' : 'map-outline'} size={18} />{view === 'map' ? t('map.list') : t('map.mapView')}
            </button>
          )}
          {showEmpty && (
            <EmptyCard today={today} t={t} />
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
                      <span key={k} style={ROW}>{i > 0 && ' · '}<Icon name={THEME_ICON[k] ?? 'pricetag-outline'} size={13} />{themeName(k)}</span>
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
    </div>
  )
}
