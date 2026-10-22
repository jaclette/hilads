import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../lib/leafletGuard'
import { useTranslation } from 'react-i18next'
import SpotPage from './SpotPage'
import { fetchMap, fetchMapCities, searchSpots, fetchDailyToday } from '../../api'
import { track } from '../../lib/analytics'
import { THEME_KEYS, isPlaceTheme, themeName, CITY_ZOOM, MIN_ZOOM, mapTiles, clusterPins, pinLabel, placeLabels, deviceStore, compactPrice, formatDistance, sortSpots } from './spotsShared'
import { openAppModal } from '../AppModal'
import Icon, { iconHtml } from '../Icon'
import { themeIcon } from '../../lib/icons'
import { useDaily } from '../daily/dailyShared'
import HeaderArt from '../HeaderArt'
import { shortCityName } from '../../i18n/cityName'
import { thumbFallback } from '../../lib/thumbFallback'
import { PickBadge, PhotoCredit } from './Pick'
import { useBackLayer } from '../../lib/backLayers'

const IDLE_MS = 350
// The last view (map or list), remembered on this device.
const VIEW_KEY = 'hilads_map_view'
const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
// The camera stays around the city (like the app): about 110 km each way.
const CITY_SPAN = 1
// Within this distance of the city centre, "where I am" just moves the camera;
// further away, the map re-centres on me and shows the spots around me.
const NEAR_CITY_KM = 50
// World scope: the whole world, one bubble per city below the city zoom.
const WORLD_ZOOM = 2

function km(a, b) {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = (b[0] - a[0]) * r
  return Math.sqrt(x * x + y * y) * 6371
}

// Pin labels from this zoom (the city view), where they stay readable.
const LABEL_MIN_ZOOM = 14
const LABEL_FONT = '700 12px'
// The photo in a label: 54 px with its ring, and its gap (.wm-pin-photo).
const PHOTO_W = 60
const PHOTO_H = 54

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
  // A Hilads pick (editorial): its own gold pin with a star.
  html: (spot.pick
    ? `<span class="wm-pin wm-pin--pick${selected ? ' wm-pin--on' : ''}">${iconHtml('star', 20)}</span>`
    : `<span class="wm-pin${selected ? ' wm-pin--on' : ''}" style="color: var(--primary)">${iconHtml(spot.themes?.[0] ? themeIcon(spot.themes[0]) : 'location-outline', 20)}</span>`)
    + (side ? `<span class="wm-pin-label wm-pin-label--${side}${selected ? ' wm-pin-label--on' : ''}${spot.cover?.thumbUrl ? ' wm-pin-label--photo' : ''}">`
      // The spot's photo before its name (like the app).
      + (spot.cover?.thumbUrl ? `<img class="wm-pin-photo" src="${escapeHtml(spot.cover.thumbUrl)}" alt="" loading="lazy" /><span class="wm-pin-text">${escapeHtml(label)}</span>` : escapeHtml(label))
      + '</span>' : ''),
  iconSize: [44, 44], iconAnchor: [22, 22],
})
// A World bubble: the city's flag and its spot count.
const bubbleIcon = (b) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-bubble">${/^[A-Z]{2}$/.test(b.city.country ?? '') ? `<img src="/flags/${b.city.country.toLowerCase()}.svg" alt="" width="18" height="14" />` : ''}${b.spots}</span>`,
  iconSize: [64, 36], iconAnchor: [32, 18],
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
      pins.push({ id: s.id, x: p.x, y: p.y, w: labelWidth(label) + (s.cover?.thumbUrl ? PHOTO_W : 0), ...(s.cover?.thumbUrl ? { h: PHOTO_H } : {}), selected: isSelected, rank: -(s.proofCount * 1000 + s.votes) })
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
              ? <img className="wm-row-photo" src={s.cover.thumbUrl || s.cover.photoUrl} onError={thumbFallback(s.cover.photoUrl)} alt="" loading="lazy" />
              : <span className="wm-row-photo wm-row-photo--empty"><Icon name={th ? themeIcon(th) : 'location-outline'} size={22} /></span>}
            <span className="wm-row-body">
              <span className="wm-row-name">{s.name}</span>
              <span className="wm-row-chips">
                {th && <span className="wm-row-theme" style={ROW}><Icon name={themeIcon(th)} size={12} />{themeName(th)}</span>}
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
  const { t: tc } = useTranslation('common')
  const challenge = today?.challenge ?? null
  // Represent your city (SPEC 9.16): "Be the first to put Saigon on the map."
  const cityShort = today?.city?.name ? shortCityName(today.city.name) : null
  const placeTheme = isPlaceTheme(challenge?.theme?.key)
  const tomorrowKey = today?.tomorrow?.theme?.key
    ?? (challenge ? defaultThemeFor(new Date(Date.parse(`${challenge.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) : null)
  const store = deviceStore()
  const canTake = challenge?.isActive && !today?.myProof && placeTheme
  const body = (
    <>
      <span className="wm-sheet-title" style={ROW}><Icon name="location-outline" size={20} style={{ color: 'var(--primary-text)' }} />{cityShort ? tc('represent.mapEmpty', { city: cityShort }) : t('map.emptyTitle')}</span>
      {challenge && <span className="wm-empty-text">{challenge.text}</span>}
      {canTake && <span className="wm-sheet-cta">{t('dc.takeIt')}</span>}
      {challenge?.isActive && !placeTheme && tomorrowKey && <span className="wm-empty-tomorrow">{t('map.spotsTomorrow', { theme: themeName(tomorrowKey) })}</span>}
    </>
  )
  // The whole card is the tap target: the app modal on a place theme (photos are
  // posted from the app), else today's challenge.
  if (canTake) {
    return (
      <button type="button" className="wm-sheet wm-sheet--empty"
         onClick={() => { track('web_today_take_clicked', { store: store ?? 'ios', surface: 'map_empty' }); openAppModal({ action: 'play', surface: 'map_empty' }) }}>
        {body}
      </button>
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
 * The web map of spots (SPEC 9.5, same API as the app's Map tab): the scope
 * selector next to the search (the app-wide one: a city centres the map on it,
 * World zooms out to one bubble per city, flag and spot count, a bubble opens
 * its city), the current city's spots and Hi plans, theme chips, search, and a
 * spot page. Locate-me goes back to my position and my city. Full screen.
 */
export default function MapScreen({ channelId, cityName, onOpenPlan, initialSpotId = null, scope = 'city', scopePill = null, onScopeCity }) {
  const { t, i18n } = useTranslation('challenge')
  const [center, setCenter]   = useState(null)
  const [spots, setSpots]     = useState([])
  const [plans, setPlans]     = useState([])
  const [zoom, setZoom]       = useState(CITY_ZOOM)
  const [theme, setTheme]     = useState(null)
  const [selected, setSelected] = useState(null)
  const [openSpotId, setOpenSpotId] = useState(initialSpotId)
  // Browser back: the spot's page, then its card, before the map itself.
  useBackLayer(selected !== null, () => setSelected(null))
  useBackLayer(openSpotId !== null, () => setOpenSpotId(null))
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
  const [bubbles, setBubbles] = useState([])
  const world = scope === 'world'
  const worldView = world && zoom < MIN_ZOOM
  // The map remounts on a scope change: start at its zoom.
  useEffect(() => { setZoom(world ? WORLD_ZOOM : CITY_ZOOM) }, [world])
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
        if (d.spots.length > 1) setCamera({ scope: 'city', bounds: d.spots.map(s => [s.lat, s.lng]) })
        else if (d.spots.length === 1) setCamera({ scope: 'city', lat: d.spots[0].lat, lng: d.spots[0].lng, zoom: CITY_ZOOM + 1 })
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
        setCamera({ scope: 'city', lat: here[0], lng: here[1], zoom: Math.max(zoom, 15) })
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

  // World: one bubble per city with spots (in the theme).
  useEffect(() => {
    if (!world) return
    fetchMapCities(theme).then(setBubbles).catch(() => {})
  }, [world, theme])

  // A bubble opens its city, framed on its spots.
  const openBubble = (b) => {
    track('web_map_city_bubble_tapped', { city: b.city.name, spots: b.spots })
    fetchMap({ cityId: b.city.id, theme }).then(d => {
      if (d.spots.length > 1) setCamera({ scope: 'world', bounds: d.spots.map(x => [x.lat, x.lng]) })
      else setCamera({ scope: 'world', lat: d.spots[0]?.lat ?? b.city.lat, lng: d.spots[0]?.lng ?? b.city.lng, zoom: CITY_ZOOM })
    }).catch(() => setCamera({ scope: 'world', lat: b.city.lat, lng: b.city.lng, zoom: CITY_ZOOM }))
  }

  const loadArea = useCallback((bbox, th = theme) => {
    areaRef.current = bbox
    // The whole world: the bubbles say it, no pins to load.
    if (world && bbox[2] - bbox[0] > 40) { setSpots([]); setPlans([]); return }
    fetchMap({ cityId: nearMe || world ? null : channelId, bbox, theme: th })
      .then(d => { setSpots(d.spots); setPlans(world ? [] : d.plans) })
      .catch(() => {})
  }, [channelId, theme, nearMe, world])

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
    setCamera({ scope, lat: s.lat, lng: s.lng, zoom: Math.max(zoom, 16) })
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
          <span className="page-title">{world ? t('scope.world', { ns: 'common' }) : nearMe ? t('map.nearYou') : (cityName || t('map.button'))}</span>
          <p className="tab-subtitle">{t('subtitles.map', { ns: 'common' })}</p>
        </div>
      </div>

      <div className="wm-top">
        <div className="wm-search-row">
        {scopePill}
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
        </div>
        {results === null || view === 'list' ? (
          <div className="wm-chips" role="toolbar">
            <button type="button" className={`wm-chip${theme === null ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(null)}>{t('map.all')}</button>
            {THEME_KEYS.filter(isPlaceTheme).map(k => (
              <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={ROW} onClick={() => pickTheme(k)}>
                <Icon name={themeIcon(k)} size={15} />{themeName(k)}
              </button>
            ))}
          </div>
        ) : (
          <div className="wm-results">
            {results.length === 0 ? <p className="wm-empty">{t('map.noResults')}</p> : results.map(s => (
              <button key={s.id} type="button" className="wm-result" onClick={() => focusSpot(s)}>
                <span className="wm-result-name">{s.name}</span>
                <span className="wm-result-meta">{s.pick && !s.proofCount ? t('pick.badge', { ns: 'common' }) : t('map.proofs', { count: s.proofCount })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wm-map">
        {center ? (
          <MapContainer key={`${scope}:${center.join(',')}`} center={world ? [20, center[1]] : center} zoom={world ? WORLD_ZOOM : CITY_ZOOM}
                        minZoom={world ? WORLD_ZOOM : MIN_ZOOM} zoomControl={false} className="wm-leaflet"
                        maxBounds={world ? undefined : [[center[0] - CITY_SPAN, center[1] - CITY_SPAN], [center[0] + CITY_SPAN, center[1] + CITY_SPAN]]}
                        maxBoundsViscosity={world ? undefined : 1}>
            <TileLayer url={tiles.url} attribution={tiles.attribution} tileSize={tiles.tileSize} zoomOffset={tiles.zoomOffset} maxZoom={19} />
            <MapWatcher onArea={bbox => loadArea(bbox)} onZoom={setZoom} />
            {/* A move made in the other scope (the city's frame, a bubble) never replays after the map remounts. */}
            <CameraTo target={camera?.scope === scope ? camera : null} />
            {worldView && bubbles.slice(0, 150).map(b => (
              <Marker key={`c:${b.city.id}`} position={[b.city.lat, b.city.lng]} icon={bubbleIcon(b)}
                      title={t('map.cityBubbleA11y', { city: shortCityName(b.city.name), count: b.spots })}
                      eventHandlers={{ click: () => openBubble(b) }} />
            ))}
            <Pins spots={worldView ? [] : spots} zoom={zoom} selected={selected} onSpot={setSelected}
                  onCluster={g => setCamera({ scope, lat: g.lat, lng: g.lng, zoom: Math.min(zoom + 2, 18) })} />
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
          <button type="button" className="wm-locate" onClick={() => { if (world) onScopeCity?.(); locate(true) }} aria-label={t('map.locate')} title={t('map.locate')}>
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
                  {selected.pick && <PickBadge />}
                  <span className="wm-sheet-meta">
                    {selected.themes.map((k, i) => (
                      <span key={k} style={ROW}>{i > 0 && ' · '}<Icon name={themeIcon(k)} size={13} />{themeName(k)}</span>
                    ))}
                  </span>
                  {/* A pick alone has no answers to count. */}
                  {selected.proofCount > 0 && (
                    <span className="wm-sheet-meta">
                      {t('map.proofs', { count: selected.proofCount })} · {t('map.votes', { count: selected.votes })}
                      {selected.validatedByLocal && <> · <span style={ROW}><Icon name="checkmark" size={13} />{t('map.validated')}</span></>}
                    </span>
                  )}
                  <PhotoCredit cover={selected.cover} className="wm-sheet-meta" />
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
