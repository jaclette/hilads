/**
 * /api/geo — edge IP→city resolver for the stories landing.
 *
 * The client fetches this ONCE on the bare-root landing (never on /c/:id) and
 * races it against a 200ms timeout: a "city_matched" result drives State A
 * (CTA "Join {city} 🔥", joins that city); anything else → State B (fallback to
 * Ho Chi Minh City, CTA "Choose your city 🔥" → picker).
 *
 * Source: Vercel's edge geo headers (populated automatically by Vercel's
 * network — no external service, no API key, no browser GPS/permission prompt):
 *   x-vercel-ip-country   ISO-2 country (e.g. "FR")
 *   x-vercel-ip-latitude  approximate visitor latitude
 *   x-vercel-ip-longitude approximate visitor longitude
 *
 * Match: nearest supported city by haversine within MATCH_RADIUS_KM; else, if
 * the visitor's country has exactly one supported city, that city (country
 * fallback — handles "far from the only city in the country"); else unknown.
 *
 * Privacy: the raw IP is NEVER read, returned, or logged. The response carries
 * only the resolved supported-city name (or "unknown") — aggregate analytics.
 */

const API_BASE = process.env.HILADS_API_BASE || 'https://api.hilads.live'

const MATCH_RADIUS_KM = 150      // nearest-city cutoff for a confident State A
const CITIES_TTL_MS   = 5 * 60_000 // cache the supported-cities list per warm lambda
const FETCH_TIMEOUT_MS = 1200

// Warm-lambda cache of the supported cities (with coords). Protects backend
// egress: one visitor's /api/geo call warms it for everyone on that instance.
let _citiesCache = { at: 0, cities: null }

async function getCities() {
  if (_citiesCache.cities && Date.now() - _citiesCache.at < CITIES_TTL_MS) {
    return _citiesCache.cities
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(`${API_BASE}/api/v1/channels`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`channels ${r.status}`)
    const data = await r.json()
    const cities = (data?.channels ?? [])
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map(c => ({
        channelId: c.channelId,
        city: c.city,
        country: (c.country || '').toUpperCase(),
        timezone: c.timezone || 'UTC',
        lat: c.lat,
        lng: c.lng,
      }))
    if (cities.length) _citiesCache = { at: Date.now(), cities }
    return cities
  } finally {
    clearTimeout(timer)
  }
}

// Haversine great-circle distance in km.
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function resolve(cities, country, lat, lng) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  // 1) Nearest supported city by proximity (primary signal).
  if (hasCoords && cities.length) {
    let best = null
    let bestKm = Infinity
    for (const c of cities) {
      const km = distanceKm(lat, lng, c.lat, c.lng)
      if (km < bestKm) { bestKm = km; best = c }
    }
    if (best && bestKm <= MATCH_RADIUS_KM) {
      return { state: 'city_matched', city: best, via: 'proximity' }
    }
  }

  // 2) Country fallback: exactly one supported city in the visitor's country.
  if (country) {
    const inCountry = cities.filter(c => c.country === country)
    if (inCountry.length === 1) {
      return { state: 'city_matched', city: inCountry[0], via: 'country' }
    }
  }

  // 3) No confident match → State B (client falls back to Ho Chi Minh City).
  return { state: 'city_unknown', city: null, via: 'none' }
}

export default async function handler(req, res) {
  const country = (req.headers['x-vercel-ip-country'] || '').toString().toUpperCase()
  const lat = parseFloat(req.headers['x-vercel-ip-latitude'])
  const lng = parseFloat(req.headers['x-vercel-ip-longitude'])

  // Per-visitor result — must NOT be shared across visitors by the CDN.
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', 'application/json')

  try {
    const cities = await getCities()
    const { state, city, via } = resolve(cities, country, lat, lng)
    res.statusCode = 200
    res.end(JSON.stringify(
      state === 'city_matched'
        ? {
            state,
            city: city.city,
            channelId: city.channelId,
            country: city.country,
            timezone: city.timezone,
            detectedCity: city.city,
            via,
          }
        : { state, detectedCity: 'unknown', via },
    ))
  } catch {
    // Any failure → State B. Never blocks the client (it also has a 200ms race).
    res.statusCode = 200
    res.end(JSON.stringify({ state: 'city_unknown', detectedCity: 'unknown', via: 'error' }))
  }
}
