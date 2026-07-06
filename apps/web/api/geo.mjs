/**
 * /api/geo — edge IP→city resolver for the stories landing.
 *
 * The client fetches this ONCE on the bare-root landing (never on /c/:id) to
 * pick the featured city: a "city_matched" result drives State A (CTA
 * "Join {city} 🔥", joins that city); anything else → State B (fall back to the
 * featured city; "unknown" additionally flips the CTA to the picker).
 *
 * Source: Vercel's edge geo headers (populated automatically by Vercel's
 * network — no external service, no API key, no browser GPS/permission prompt):
 *   x-vercel-ip-country   ISO-2 country (e.g. "FR")
 *   x-vercel-ip-latitude  approximate visitor latitude
 *   x-vercel-ip-longitude approximate visitor longitude
 *
 * The supported-city coordinates are BUNDLED (api/_cities.mjs) rather than
 * fetched from the backend per request: a cold lambda doing a backend round-trip
 * blew past the client's geo budget and forced everyone to State B. The bundled
 * snapshot answers in ~30ms even cold. Regenerate it with `node api/_gen-cities.mjs`
 * when the city set changes (best-effort: a brand-new city won't match until then).
 *
 * Match: nearest supported city by haversine within MATCH_RADIUS_KM; else, if
 * the visitor's country has exactly one supported city, that city (country
 * fallback — handles "far from the only city in the country"); else unknown.
 *
 * Privacy: the raw IP is NEVER read, returned, or logged. The response carries
 * only the resolved supported-city name (or "unknown") — aggregate analytics.
 */

import { CITIES } from './_cities.mjs'

const MATCH_RADIUS_KM = 150   // nearest-city cutoff for a confident State A

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

function resolve(country, lat, lng) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  // 1) Nearest supported city by proximity (primary signal).
  if (hasCoords) {
    let best = null
    let bestKm = Infinity
    for (const c of CITIES) {
      const km = distanceKm(lat, lng, c.lat, c.lng)
      if (km < bestKm) { bestKm = km; best = c }
    }
    if (best && bestKm <= MATCH_RADIUS_KM) {
      return { state: 'city_matched', city: best, via: 'proximity' }
    }
  }

  // 2) Country fallback: exactly one supported city in the visitor's country.
  if (country) {
    const inCountry = CITIES.filter(c => c.co === country)
    if (inCountry.length === 1) {
      return { state: 'city_matched', city: inCountry[0], via: 'country' }
    }
  }

  // 3) No confident match → State B (client falls back to the featured city).
  return { state: 'city_unknown', city: null, via: 'none' }
}

export default function handler(req, res) {
  const country = (req.headers['x-vercel-ip-country'] || '').toString().toUpperCase()
  const lat = parseFloat(req.headers['x-vercel-ip-latitude'])
  const lng = parseFloat(req.headers['x-vercel-ip-longitude'])

  // Per-visitor result — must NOT be shared across visitors by the CDN.
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', 'application/json')

  try {
    const { state, city, via } = resolve(country, lat, lng)
    res.statusCode = 200
    res.end(JSON.stringify(
      state === 'city_matched'
        ? {
            state,
            city: city.c,
            channelId: city.id,
            country: city.co,
            timezone: city.tz,
            detectedCity: city.c,
            via,
          }
        : { state, detectedCity: 'unknown', via },
    ))
  } catch {
    // Any failure → State B. Never blocks the client.
    res.statusCode = 200
    res.end(JSON.stringify({ state: 'city_unknown', detectedCity: 'unknown', via: 'error' }))
  }
}
