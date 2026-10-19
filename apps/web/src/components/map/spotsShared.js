import i18n from '../../i18n'
import { shortCityName } from '../../i18n/cityName'

// Shared bits of the web map of spots (SPEC 9.5): theme names and icons, the
// map tiles, and links. Theme names show in the reader's language (common.json
// themes.*), English as fallback.

// Themes v2 (SPEC 8.2), Monday first.
export const THEME_KEYS = ['hidden_gem', 'taste', 'ask_local', 'local_find', 'night_out', 'sip', 'only_here']

export const THEME_NAMES = {
  hidden_gem: 'Hidden gem', taste: 'Taste', ask_local: 'Ask a local', local_find: 'Local find',
  night_out: 'Night out', sip: 'Drinks', only_here: 'Only here',
}

/**
 * A theme's name in the reader's language ('' without a key). A special day
 * shows its own name; Only here with a city reads "Only in Saigon" (the card
 * and the Passport stamp; World scope passes no city).
 */
export function themeName(key, opts) {
  if (!key) return ''
  if (key === 'special') return opts?.special?.name ?? i18n.t('themes.special', { ns: 'common', defaultValue: 'Special' })
  if (key === 'only_here' && opts?.city) {
    const city = shortCityName(opts.city)
    return i18n.t('themes.onlyIn', { ns: 'common', city, defaultValue: `Only in ${city}` })
  }
  return i18n.t(`themes.${key}`, { ns: 'common', defaultValue: THEME_NAMES[key] ?? key })
}

/** Every weekly theme but Ask a local is about a place; a special day is not. */
export function isPlaceTheme(key) {
  return !!key && key !== 'ask_local' && key !== 'special'
}

export const CITY_ZOOM = 14
export const MIN_ZOOM  = 9

export const APP_STORE  = 'https://apps.apple.com/app/id6768905591'
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.hilads.app'

/** The store for this device: iOS, Android, or null on desktop. */
export function deviceStore() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return null
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/**
 * Raster tiles of the same Mapbox styles as the app (VITE_MAPBOX_TOKEN, a
 * public token restricted to hilads.live). Without a token (local dev), the
 * standard OpenStreetMap tiles, like the location picker.
 */
export function mapTiles(dark) {
  if (!MAPBOX_TOKEN) {
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      tileSize: 256, zoomOffset: 0, mapbox: false,
    }
  }
  const style = dark ? 'dark-v11' : 'light-v11'
  return {
    url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> '
      + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> '
      + '<a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><strong>Improve this map</strong></a>',
    tileSize: 512, zoomOffset: -1, mapbox: true,
  }
}

/** Directions to a point, on OpenStreetMap (no Google, SPEC 9.5). */
export function directionsUrl(lat, lng) {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}#map=16/${lat}/${lng}`
}

/** "₫35,000–60,000" style price range, in the viewer's language. */
export function formatPriceRange(range, lang) {
  if (!range) return null
  const fmt = n => {
    try { return new Intl.NumberFormat(lang, { style: 'currency', currency: range.currency, maximumFractionDigits: 0 }).format(n) }
    catch { return `${n} ${range.currency}` }
  }
  return range.min === range.max ? fmt(range.min) : `${fmt(range.min)}–${fmt(range.max)}`
}

/** A compact price, like the app: 35000 VND → "35k", 1200000 → "1.2M", 4.5 EUR → "€4.50". */
export function compactPrice(amount, currency, locale) {
  if (amount >= 1000) {
    const n = amount >= 1_000_000 ? amount / 1_000_000 : amount / 1000
    const f = new Intl.NumberFormat(locale, { maximumFractionDigits: n < 10 && !Number.isInteger(n) ? 1 : 0 }).format(n)
    return `${f}${amount >= 1_000_000 ? 'M' : 'k'}`
  }
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${amount} ${currency}` }
}

export const PIN_LABEL_MAX = 18

/** A pin's label, like the app: the name cut at about 18 characters, then the median price paid ("Cơm Tấm Ba Ghiền · 35k"). */
export function pinLabel(name, price, locale) {
  const chars = [...String(name ?? '').trim()]
  const short = chars.length > PIN_LABEL_MAX ? `${chars.slice(0, PIN_LABEL_MAX - 1).join('').trimEnd()}…` : chars.join('')
  const median = price ? (price.median ?? (price.min === price.max ? price.min : null)) : null
  return median != null ? `${short} · ${compactPrice(median, price.currency, locale)}` : short
}

/**
 * Which single pins get a label at this zoom: the selected spot always, then
 * the others by proofs and votes, each on the right of its pin (or the left)
 * where it overlaps no pin, cluster or label already placed; the rest keep
 * their pin only. `pins` = [{ id, x, y, w, selected, rank }] in pixels, `w` the
 * label width; `obstacles` = boxes of clusters; `view` = the visible box: a
 * label that would leave it goes on the other side of its pin (or hides).
 * Returns Map id → 'right'|'left'.
 */
export function placeLabels(pins, obstacles = [], { pin = 22, gap = 4, h = 22, view = null } = {}) {
  const taken = [
    ...obstacles,
    ...pins.map(p => ({ x1: p.x - pin, y1: p.y - pin, x2: p.x + pin, y2: p.y + pin, id: p.id })),
  ]
  const outside = (b) => !!view && (b.x1 < view.x1 + 4 || b.x2 > view.x2 - 4)
  const hits = (b, id) => outside(b) || taken.some(o => o.id !== id && b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1)
  const out = new Map()
  const order = [...pins].sort((a, b) => (b.selected - a.selected) || (a.rank - b.rank))
  for (const p of order) {
    const right = { x1: p.x + pin + gap, y1: p.y - h / 2, x2: p.x + pin + gap + p.w, y2: p.y + h / 2 }
    const left  = { x1: p.x - pin - gap - p.w, y1: p.y - h / 2, x2: p.x - pin - gap, y2: p.y + h / 2 }
    const side = !hits(right, p.id) ? 'right' : !hits(left, p.id) ? 'left'
      : p.selected ? (outside(right) && !outside(left) ? 'left' : 'right') : null
    if (!side) continue
    out.set(p.id, side)
    taken.push({ ...(side === 'right' ? right : left), id: `label:${p.id}` })
  }
  return out
}

/** 350 → "350 m", 1234 → "1.2 km", 25400 → "25 km" (like the app). */
export function formatDistance(m, locale) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || m} m`
  const km = m / 1000
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`
}

/** Spots sorted by distance from `origin` ([lat, lng]) or by this week's votes (like the app). */
export function sortSpots(spots, sort, origin, distanceKm) {
  const out = [...spots]
  if (sort === 'week') out.sort((a, b) => b.votesWeek - a.votesWeek || b.votes - a.votes || b.proofCount - a.proofCount)
  else if (origin) out.sort((a, b) => distanceKm(origin, [a.lat, a.lng]) - distanceKm(origin, [b.lat, b.lng]))
  return out
}

/**
 * Groups pins closer than `cell` pixels at the current zoom: one marker per
 * group, with the count. `project` maps [lat, lng] to container pixels.
 */
export function clusterPins(spots, project, cell = 56) {
  const cells = new Map()
  spots.forEach(s => {
    const p = project(s.lat, s.lng)
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`
    const group = cells.get(key)
    if (group) group.push(s)
    else cells.set(key, [s])
  })
  return [...cells.values()].map(items => ({
    items,
    lat: items.reduce((a, s) => a + s.lat, 0) / items.length,
    lng: items.reduce((a, s) => a + s.lng, 0) / items.length,
  }))
}
