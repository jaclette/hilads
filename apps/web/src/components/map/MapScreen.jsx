import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../lib/leafletGuard'
import { useTranslation } from 'react-i18next'
import SpotPage from './SpotPage'
import MapSheet, { SHEET_PEEK } from './MapSheet'
import { fetchMap, fetchMapCities, searchSpots, fetchDailyToday } from '../../api'
import { track } from '../../lib/analytics'
import { THEME_KEYS, isPlaceTheme, themeName, CITY_ZOOM, MIN_ZOOM, mapTiles, clusterPins, pinLabel, placeLabels, deviceStore, } from './spotsShared'
import { openAppModal } from '../AppModal'
import Icon, { iconHtml } from '../Icon'
import { themeIcon } from '../../lib/icons'
import { useDaily } from '../daily/dailyShared'
import HeaderArt from '../HeaderArt'
import { SeasonalMapSky, setSeasonalEvent, useEventFeature, useSeasonalLive } from '../event/seasonal'
import { shortCityName } from '../../i18n/cityName'
import { thumbFallback } from '../../lib/thumbFallback'
import { PickBadge, PhotoCredit } from './Pick'
import { themeColor } from '../joy/Joy'
import { useBackLayer } from '../../lib/backLayers'
import { CommentButton } from '../daily/PhotoCommentsSheet'
import { thumbUrl } from '../../lib/imageThumb'
import { placeholderStyle } from '../../lib/thumbhash'

const IDLE_MS = 350
const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
/** A selected theme chip wears the theme's color (the pins' color: the Map's legend). */
const chipOn = (k) => { const c = themeColor(k); return { background: c.fill, borderColor: c.line ?? c.fill, color: c.onFill } }
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

// The place themes (the chips, the pins' colors).
const PLACE_THEMES = THEME_KEYS.filter(isPlaceTheme)
/** A pin's color: its theme's (the ring color when the fill is too pale on the map), as on the filter chips. */
// The event's filter (Halloween first): the spots of special-day photos, as pumpkin pins.
const SPECIAL = 'special'
const PUMPKIN = '#FF8A1F'
const pinColor = (k) => { if (k === SPECIAL) return PUMPKIN; const c = themeColor(k); return c.line ?? c.fill }
/** The icon on a theme-colored pin: white on a ring color, else the theme's own text color. */
const pinInk = (k) => { if (k === SPECIAL) return '#FFFFFF'; const c = themeColor(k); return c.line ? '#FFFFFF' : c.onFill }
/** A cluster wears the color of the theme it has most of (the first theme on a tie, like the app). */
function clusterTheme(items, filter) {
  if (filter === SPECIAL) return SPECIAL
  const n = {}
  items.forEach(s => { const k = filter ?? s.themes?.[0] ?? 'taste'; n[k] = (n[k] ?? 0) + 1 })
  return PLACE_THEMES.reduce((best, k) => ((n[k] ?? 0) > (n[best] ?? 0) ? k : best), PLACE_THEMES[0])
}

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
// theme: the pin's color (the filter's theme, else the spot's first); halo: a
// photo of today's challenge under the "Today" chip (its theme's color); grow:
// the first spots grow in.
const spotIcon = (spot, label, side, selected, { theme, halo, grow }) => L.divIcon({
  className: 'wm-pin-wrap',
  // A Hilads pick (editorial): its own gold pin with a star.
  html: (spot.pick
    ? `<span class="wm-pin wm-pin--pick${selected ? ' wm-pin--on' : ''}${grow ? ' wm-grow' : ''}">${iconHtml('star', 20)}</span>`
    : `<span class="wm-pin${selected ? ' wm-pin--on' : ''}${halo ? ' wm-pin--today' : grow ? ' wm-grow' : ''}" style="background: ${pinColor(theme)}; color: ${pinInk(theme)}${halo ? `; --halo: ${halo}` : ''}">${iconHtml(themeIcon(theme), 20)}</span>`)
    + (side ? `<span class="wm-pin-label wm-pin-label--${side}${selected ? ' wm-pin-label--on' : ''}${spot.cover?.thumbUrl ? ' wm-pin-label--photo' : ''}">`
      // The spot's photo before its name (like the app).
      + (spot.cover?.thumbUrl ? `<img class="wm-pin-photo" src="${escapeHtml(thumbUrl(spot.cover.thumbUrl))}" alt="" loading="lazy" /><span class="wm-pin-text">${escapeHtml(label)}</span>` : escapeHtml(label))
      + '</span>' : ''),
  iconSize: [44, 44], iconAnchor: [22, 22],
})
// A World bubble: the city's flag and its spot count.
const bubbleIcon = (b) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-bubble">${/^[A-Z]{2}$/.test(b.city.country ?? '') ? `<img src="/flags/${b.city.country.toLowerCase()}.svg" alt="" width="18" height="14" />` : ''}${b.spots}</span>`,
  iconSize: [64, 36], iconAnchor: [32, 18],
})
const clusterIcon = (n, theme, grow) => L.divIcon({
  className: 'wm-pin-wrap',
  html: `<span class="wm-cluster${grow ? ' wm-grow' : ''}" style="background: ${pinColor(theme)}">${n}</span>`,
  iconSize: [44, 44], iconAnchor: [22, 22],
})
const meIcon = L.divIcon({
  className: 'wm-pin-wrap',
  html: '<span class="wm-me"></span>',
  iconSize: [22, 22], iconAnchor: [11, 11],
})
// A Hi plan as a dated pill: "Birdy, now · 10 going", "Birdy, in 2 hours" (caramel; now: primary).
// A plan card: a pill on a short stem, on the side of its point that hides no pin (planSides).
const PLAN_H = 36
const PLAN_STEM = 10
const planIcon = (text, now, side = 'top') => L.divIcon({
  className: 'wm-pin-wrap wm-plan-wrap',
  html: `<span class="wm-plan-at wm-plan-at--${side}${now ? ' wm-plan-at--now' : ''}"><span class="wm-plan${now ? ' wm-plan--now' : ''}">${iconHtml(now ? 'radio-button-on' : 'calendar-outline', 14)}<span class="wm-plan-text">${escapeHtml(text)}</span></span></span>`,
  iconSize: [0, 0], iconAnchor: [0, 0],
})

/**
 * Where each plan card goes (as in the app): above its point, else below, right, left, the
 * first side whose box covers no pin, cluster or plan already placed (above when all are
 * taken). A pin on the plan's own point stays under its stem. Returns the sides and the
 * cards' boxes (the labels then avoid them).
 */
function planSides(plans, taken, project) {
  const sides = new Map()
  const boxes = []
  for (const { plan, text } of plans) {
    const p = project(plan.lat, plan.lng)
    const w = Math.min(240, labelWidth(text) + 30)
    const cand = {
      top:    { x1: p.x - w / 2, y1: p.y - PLAN_STEM - PLAN_H, x2: p.x + w / 2, y2: p.y - PLAN_STEM },
      bottom: { x1: p.x - w / 2, y1: p.y + PLAN_STEM, x2: p.x + w / 2, y2: p.y + PLAN_STEM + PLAN_H },
      right:  { x1: p.x + PLAN_STEM, y1: p.y - PLAN_H / 2, x2: p.x + PLAN_STEM + w, y2: p.y + PLAN_H / 2 },
      left:   { x1: p.x - PLAN_STEM - w, y1: p.y - PLAN_H / 2, x2: p.x - PLAN_STEM, y2: p.y + PLAN_H / 2 },
    }
    const others = taken.filter(o => Math.hypot((o.x1 + o.x2) / 2 - p.x, (o.y1 + o.y2) / 2 - p.y) > 8).concat(boxes)
    const hits = (b) => others.some(o => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1)
    const side = ['top', 'bottom', 'right', 'left'].find(k => !hits(cand[k])) ?? 'top'
    sides.set(plan.id, side)
    boxes.push({ ...cand[side], id: `plan:${plan.id}` })
  }
  return { sides, boxes }
}

/** A plan's pill text and whether it is on now: soon is relative ("in 2 hours", localized), later the day and time. */
function planLabel(plan, t, lang) {
  const now = Date.now()
  const start = new Date(plan.startsAt * 1000)
  const ongoing = plan.startsAt * 1000 <= now && (plan.endsAt ? plan.endsAt * 1000 > now : true)
  const hours = (plan.startsAt * 1000 - now) / 3_600_000
  const time = ongoing ? t('map.planNow')
    : hours < 6 ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(Math.max(1, Math.round(hours * (hours < 1 ? 60 : 1))), hours < 1 ? 'minute' : 'hour')
    : start.toLocaleString(lang, start.toDateString() === new Date().toDateString()
        ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const going = plan.participantCount > 1 ? t('map.planGoing', { count: plan.participantCount }) : null
  return { text: `${plan.title}, ${time}${going ? ` · ${going}` : ''}`, ongoing }
}

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
function CameraTo({ target, top }) {
  const map = useMap()
  useEffect(() => {
    // The header sits over the map: frame below it.
    if (target?.bounds) map.fitBounds(target.bounds, { paddingTopLeft: [48, 48 + top], paddingBottomRight: [48, 48], maxZoom: CITY_ZOOM + 1, animate: false })
    else if (target?.lift) {
      // The sheet covers the lower half: the pin lands midway between the header and the sheet.
      const h = map.getSize().y
      const p = map.project([target.lat, target.lng], target.zoom).add([0, h / 4 - top / 2])
      map.setView(map.unproject(p, target.zoom), target.zoom, { animate: true })
    } else if (target) map.setView([target.lat, target.lng], target.zoom, { animate: true })
  }, [target, map]) // eslint-disable-line react-hooks/exhaustive-deps
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
function Pins({ spots, zoom, selected, onSpot, onCluster, theme, halo, isToday, grow, plans = [], onPlan }) {
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
    // Plans first (they win over spot labels), on the side that hides no pin; their cards are obstacles for the labels.
    const pinBoxes = pins.map(p => ({ x1: p.x - 22, y1: p.y - 22, x2: p.x + 22, y2: p.y + 22, id: p.id }))
    const planPlaces = planSides(plans, [...obstacles, ...pinBoxes], (lat, lng) => map.project([lat, lng], zoom))
    const sides = placeLabels(pins.filter(p => !p.off), [...obstacles, ...planPlaces.boxes, ...pins.filter(p => p.off).map(p => ({ x1: p.x - 22, y1: p.y - 22, x2: p.x + 22, y2: p.y + 22, id: p.id }))],
                              { view: { x1: vb.min.x, y1: vb.min.y, x2: vb.max.x, y2: vb.max.y } })
    return { text, sides, planSides: planPlaces.sides }
  }, [groups, zoom, map, selected?.id, i18n.language, plans])
  const planMarkers = plans.map(({ plan, text, ongoing }) => (
    <Marker key={`p:${plan.id}`} position={[plan.lat, plan.lng]} icon={planIcon(text, ongoing, labels.planSides.get(plan.id))} title={text}
            zIndexOffset={500} eventHandlers={{ click: () => onPlan?.(plan.id) }} />
  ))
  return groups.map(g => g.items.length === 1 ? (
    <Marker key={g.items[0].id} position={[g.lat, g.lng]} zIndexOffset={g.items[0].id === selected?.id ? 1000 : 0}
            icon={spotIcon(g.items[0], labels.text.get(g.items[0].id), labels.sides.get(g.items[0].id), g.items[0].id === selected?.id,
                           { theme: theme ?? g.items[0].themes?.[0] ?? 'taste', halo: halo && isToday(g.items[0]) ? halo : null, grow })}
            eventHandlers={{ click: () => onSpot(g.items[0]) }} title={g.items[0].name} />
  ) : (
    <Marker key={`c:${g.items.map(s => s.id).join(',')}`} position={[g.lat, g.lng]} icon={clusterIcon(g.items.length, clusterTheme(g.items, theme), grow)}
            eventHandlers={{ click: () => onCluster(g) }} />
  )).concat(planMarkers)
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
export default function MapScreen({ channelId, cityName, onOpenPlan, initialSpotId = null, initialTheme = null, scope = 'city', scopePill = null, onScopeCity }) {
  const { t, i18n } = useTranslation('challenge')
  const [center, setCenter]   = useState(null)
  const [spots, setSpots]     = useState([])
  const [plans, setPlans]     = useState([])
  // The plans' pill texts ("Birdy, in 2 hours · 4 going"): the Pins layer places their cards.
  const planItems = useMemo(() => plans.map(p => ({ plan: p, ...planLabel(p, t, i18n.language) })), [plans, t, i18n.language])
  const [zoom, setZoom]       = useState(CITY_ZOOM)
  const [theme, setTheme]     = useState(initialTheme)   // the challenge screen's "Places pinned": opened on its theme
  // "Today": only the spots of today's challenge photos (a chip after All).
  const [todayOnly, setTodayOnly] = useState(false)
  // The pins grow in once, when the first spots arrive.
  const [grow, setGrow]       = useState(true)
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
  const sheet = useRef(null)
  // The sheet's measured peek: Surprise me and the map's credits sit above it.
  const [peekH, setPeekH] = useState(SHEET_PEEK)
  const [cityEmpty, setCityEmpty] = useState(false)  // the city really has no spot (not just the visible area)
  const [today, setToday]     = useState(null)
  const [bubbles, setBubbles] = useState([])
  // The header over the map: its height keeps the locate button, the list and the framing below it.
  const topRef = useRef(null)
  const [topH, setTopH]       = useState(0)
  useEffect(() => {
    const el = topRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTopH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [openSpotId])  // back from a spot's page: a new header
  const world = scope === 'world'
  const worldView = world && zoom < MIN_ZOOM
  // The map remounts on a scope change: start at its zoom.
  useEffect(() => { setZoom(world ? WORLD_ZOOM : CITY_ZOOM) }, [world])
  const areaRef = useRef(null)
  const cityCenterRef = useRef(null)
  // A seasonal event's live day: the night map (its palette is dark).
  const seasonalLive = useSeasonalLive()
  const mapEvent = useEventFeature('mapPins')
  const pumpkins = mapEvent?.key === 'halloween'
  // The event ended (or its map switch went off) while its filter was on: back to all.
  useEffect(() => { if (!pumpkins && theme === SPECIAL) setTheme(null) }, [pumpkins, theme])
  const dark = !!seasonalLive || (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark')
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
    fetchDailyToday(channelId, i18n.language).then(d => { setSeasonalEvent(d?.event); setToday(d) }).catch(() => {})
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

  useEffect(() => {
    if (!grow || spots.length === 0) return
    const id = setTimeout(() => setGrow(false), 400)
    return () => clearTimeout(id)
  }, [spots.length, grow])

  const pickTheme = (k) => {
    const next = theme === k ? null : k
    setTheme(next)
    setTodayOnly(false)
    setSelected(null)
    if (areaRef.current) loadArea(areaRef.current, next)
  }

  const pickToday = () => {
    setTodayOnly(true)
    setSelected(null)
    if (theme !== null) { setTheme(null); if (areaRef.current) loadArea(areaRef.current, null) }
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
    select(s, true)
  }
  // A pin or a row: its card leads the sheet (half open); from the list or a surprise, the map flies to it.
  const select = (s, fly = false) => {
    setSelected(s)
    sheet.current?.snapTo('half')
    if (fly) setCamera({ scope, lat: s.lat, lng: s.lng, zoom: Math.max(zoom, 16), lift: true })
  }
  // Today's spots: a photo of today's challenge (the spot's latest challenge is today's).
  const todayTheme = today?.challenge?.theme?.key ?? null
  const todayDate = today?.challenge?.date ?? null
  const isToday = (s) => !!todayDate && s.lastProofDate === todayDate
  const shown = todayOnly ? spots.filter(isToday) : spots
  // The list shares the map's state: the search hits (in the theme) or the area's spots.
  const listSpots = results !== null ? results.filter(s => theme === null || theme === SPECIAL || s.themes.includes(theme)) : shown
  // The spot fits today's theme and I haven't played: "Play here today" (the app modal, photos are posted from the app).
  const canPlayHere = !!selected && !!todayTheme && selected.themes.includes(todayTheme) && today?.challenge?.isActive && !today?.myProof
  const areaCentre = areaRef.current ? [(areaRef.current[1] + areaRef.current[3]) / 2, (areaRef.current[0] + areaRef.current[2]) / 2] : center
  const showEmpty = center && !selected && (nearMe ? spots.length === 0 && plans.length === 0 : cityEmpty)
  // Zoomed into a place with no spot (the city has some): "Nothing here yet · Be the pioneer 📍".
  const emptyArea = !!center && !worldView && !showEmpty && !cityEmpty && shown.length === 0 && results === null
  // 🎲 Surprise me: fly to a random good spot of the area (a photo and some likes first) and open its card.
  const surprise = () => {
    const pool = shown.filter(x => x.id !== selected?.id)
    const good = pool.filter(x => (x.cover?.photoUrl || x.cover?.thumbUrl) && x.votes > 0)
    const list = good.length ? good : pool
    if (!list.length) return
    const pick = list[Math.floor(Math.random() * list.length)]
    track('web_map_surprise', { spot: pick.id })
    select(pick, true)
  }

  if (openSpotId) {
    return <SpotPage spotId={openSpotId} onBack={() => setOpenSpotId(null)} />
  }

  return (
    <div className="full-page full-page--tab wm-page">
      <div className="page-header has-art">
        <HeaderArt kind="map" />
        <div className="tab-heading">
          <span className="page-title">{world ? t('scope.world', { ns: 'common' }) : nearMe ? t('map.nearYou') : (cityName || t('map.button'))}</span>
        </div>
      </div>

      <div className="wm-map" style={{ '--wm-top-h': `${topH}px`, '--wm-peek': `${peekH}px` }}>
        {/* The scope, search and chips in one translucent header over the map. */}
        <div ref={topRef} className="wm-top">
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
          {results === null ? (
            <div className="wm-chips" role="toolbar">
              <button type="button" className={`wm-chip${theme === null && !todayOnly ? ' wm-chip--on' : ''}`} onClick={() => pickTheme(null)}>{t('map.all')}</button>
              {todayDate && (
                <button type="button" className={`wm-chip${todayOnly ? ' wm-chip--on' : ''}`} style={{ ...ROW, ...(todayOnly ? chipOn(todayTheme) : null) }}
                        aria-pressed={todayOnly} onClick={pickToday}>
                  <Icon name={themeIcon(todayTheme)} size={15} />{t('map.todayChip')}
                </button>
              )}
              {pumpkins && (
                <button type="button" className={`wm-chip${theme === SPECIAL ? ' wm-chip--on' : ''}`}
                        style={theme === SPECIAL ? { background: PUMPKIN, borderColor: PUMPKIN, color: '#FFFFFF' } : undefined}
                        aria-pressed={theme === SPECIAL} onClick={() => pickTheme(SPECIAL)}>{t('map.halloween')}</button>
              )}
              {PLACE_THEMES.map(k => (
                <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={{ ...ROW, ...(theme === k ? chipOn(k) : null) }}
                        aria-pressed={theme === k} onClick={() => pickTheme(k)}>
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

        {center ? (
          <MapContainer key={`${scope}:${center.join(',')}`} center={world ? [20, center[1]] : center} zoom={world ? WORLD_ZOOM : CITY_ZOOM}
                        minZoom={world ? WORLD_ZOOM : MIN_ZOOM} zoomControl={false} className="wm-leaflet"
                        maxBounds={world ? undefined : [[center[0] - CITY_SPAN, center[1] - CITY_SPAN], [center[0] + CITY_SPAN, center[1] + CITY_SPAN]]}
                        maxBoundsViscosity={world ? undefined : 1}>
            <TileLayer url={tiles.url} attribution={tiles.attribution} tileSize={tiles.tileSize} zoomOffset={tiles.zoomOffset} maxZoom={19} />
            <MapWatcher onArea={bbox => loadArea(bbox)} onZoom={setZoom} />
            {/* A move made in the other scope (the city's frame, a bubble) never replays after the map remounts. */}
            <CameraTo target={camera?.scope === scope ? camera : null} top={topH} />
            {worldView && bubbles.slice(0, 150).map(b => (
              <Marker key={`c:${b.city.id}`} position={[b.city.lat, b.city.lng]} icon={bubbleIcon(b)}
                      title={t('map.cityBubbleA11y', { city: shortCityName(b.city.name), count: b.spots })}
                      eventHandlers={{ click: () => openBubble(b) }} />
            ))}
            <Pins spots={worldView ? [] : shown} zoom={zoom} selected={selected} onSpot={s => select(s)}
                  onCluster={g => setCamera({ scope, lat: g.lat, lng: g.lng, zoom: Math.min(zoom + 2, 18) })}
                  theme={theme} halo={todayOnly ? pinColor(todayTheme ?? 'taste') : null} isToday={isToday} grow={grow}
                  plans={planItems} onPlan={id => onOpenPlan?.(id)} />
            {me && <Marker position={me} icon={meIcon} interactive={false} />}
          </MapContainer>
        ) : (
          <div className="wm-loading">{failed ? t('map.unavailable') : <span className="wm-spinner" aria-hidden="true" />}</div>
        )}
        {center && (
          <button type="button" className="wm-locate" onClick={() => { if (world) onScopeCity?.(); locate(true) }} aria-label={t('map.locate')} title={t('map.locate')}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        )}
        {notice && <div className="wm-notice" role="status">{notice}</div>}
        <SeasonalMapSky />
        {tiles.mapbox && (
          <a className="wm-mapbox-logo" href="https://www.mapbox.com/" target="_blank" rel="noopener noreferrer" aria-label="Mapbox">mapbox</a>
        )}
        {/* Above the sheet: 🎲 Surprise me. */}
        {center && !worldView && shown.length > 0 && (
          <button type="button" className="wm-surprise" style={{ bottom: peekH + 12 }} onClick={surprise} data-testid="map-surprise">🎲 {t('dc.map.surprise')}</button>
        )}
        {/* The sticky sheet: the visible area's spots, a selected pin's card first. */}
        {center && (
          <MapSheet
            ref={sheet}
            onPeek={setPeekH}
            spots={worldView ? [] : listSpots}
            me={me}
            origin={areaCentre}
            km={km}
            place={!world && !nearMe && cityName ? shortCityName(cityName) : null}
            filterLabel={todayOnly ? t('map.todayChip') : theme === SPECIAL ? t('map.halloween') : theme ? themeName(theme) : null}
            emptyArea={emptyArea}
            onPick={s => { track('web_map_list_picked', { spot: s.id }); select(s, true) }}
            topNote={showEmpty ? <EmptyCard today={today} t={t} /> : emptyArea ? (
              <button type="button" className="wm-pioneer"
                      onClick={() => { track('web_today_take_clicked', { store: deviceStore() ?? 'ios', surface: 'map_pioneer' }); openAppModal({ action: 'play', surface: 'map_pioneer' }) }}>
                {t('dc.map.sheet.pioneer')}
              </button>
            ) : null}
            selectedCard={selected ? (
      <div className="wm-sheet">
        <button type="button" className="wm-sheet-close" onClick={() => { setSelected(null); sheet.current?.snapTo('peek') }} aria-label={t('map.closeSpot')}><Icon name="close" size={20} /></button>
        <button type="button" className="wm-sheet-body" onClick={() => setOpenSpotId(selected.id)}>
          {selected.cover?.thumbUrl ? <img className="wm-sheet-photo" src={thumbUrl(selected.cover.thumbUrl)} alt="" /> : <span className="wm-sheet-photo" />}
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
        {canPlayHere && (
          <button type="button" className="wm-sheet-cta"
                  onClick={() => { track('web_today_take_clicked', { store: deviceStore() ?? 'ios', surface: 'map_spot' }); openAppModal({ action: 'play', surface: 'map_spot' }) }}>
            <Icon name="camera-outline" size={18} />{t('map.playHere')}
          </button>
        )}
        <button type="button" className={`wm-sheet-cta${canPlayHere ? ' wm-btn--ghost' : ''}`} onClick={() => setOpenSpotId(selected.id)}>{t('map.openSpot')}</button>
        {/* The cover photo's comments (their header loads from the photo). */}
        {selected.cover?.proofId && <CommentButton target={{ proofId: selected.cover.proofId, thumbUrl: selected.cover.thumbUrl ?? selected.cover.photoUrl }} variant="inline" />}
      </div>
            ) : null}
          />
        )}
      </div>
    </div>
  )
}
