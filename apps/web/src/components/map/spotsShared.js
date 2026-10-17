// Shared bits of the web map of spots (SPEC 9.5): theme names and icons, the
// map tiles, and links. Theme names are Daily Challenge content: English.

export const THEME_KEYS = ['language', 'street_food', 'coffee', 'market', 'night_out', 'neighborhood', 'traditions']

export const THEME_NAMES = {
  language: 'Language', street_food: 'Street food', coffee: 'Coffee', market: 'Market',
  night_out: 'Night out', neighborhood: 'Neighborhood', traditions: 'Traditions',
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
