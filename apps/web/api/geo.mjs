/**
 * /api/geo — edge IP→city resolver for the stories landing.
 *
 * The client fetches this ONCE on the bare-root landing (never on /c/:id) to
 * pick the featured city: a "city_matched" result drives State A (CTA
 * "Join {city} 🔥", joins that city); anything else → State B (fall back to the
 * featured city; "unknown" additionally flips the CTA to the picker).
 *
 * Source: a precise IP→coords lookup via ipinfo.io (Vercel's own edge geo
 * headers mislocate some ISP ranges by hundreds of km — e.g. Free SAS in France
 * resolves to Strasbourg instead of the actual Bayonne area). If ipinfo fails or
 * times out we fall back to Vercel's edge headers (x-vercel-ip-country /
 * -latitude / -longitude). No browser GPS/permission prompt either way. The
 * visitor IP is sent to ipinfo for the lookup only — never logged or returned.
 * IPINFO_TOKEN (optional env var) raises the rate limit.
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

// Vercel's edge geo headers mislocate some ISP ranges badly (e.g. Free SAS in
// France → Strasbourg instead of the actual Bayonne/Basque coast), so we prefer
// a dedicated provider (ipinfo.io) and fall back to the edge headers on any
// failure/timeout. The IP is sent to ipinfo for the lookup only — we still never
// log or return it. Set IPINFO_TOKEN (optional) for higher rate limits.
const IPINFO_TIMEOUT_MS = 1500

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').toString()
  const first = xff.split(',')[0].trim()
  return first || (req.headers['x-real-ip'] || '').toString().trim()
}

async function preciseLookup(ip) {
  if (!ip) return null
  const token = process.env.IPINFO_TOKEN
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IPINFO_TIMEOUT_MS)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!r.ok) return null
    const d = await r.json()
    if (typeof d.loc === 'string' && d.loc.includes(',')) {
      const [lat, lng] = d.loc.split(',').map(Number)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng, country: (d.country || '').toString().toUpperCase() }
      }
    }
    return null
  } catch {
    return null // timeout / network / parse → fall back to Vercel headers
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  // Per-visitor result — must NOT be shared across visitors by the CDN.
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Type', 'application/json')

  // Primary: precise ipinfo lookup. Fallback: Vercel's edge geo headers.
  let country = (req.headers['x-vercel-ip-country'] || '').toString().toUpperCase()
  let lat = parseFloat(req.headers['x-vercel-ip-latitude'])
  let lng = parseFloat(req.headers['x-vercel-ip-longitude'])
  let source = 'vercel'
  try {
    const p = await preciseLookup(clientIp(req))
    if (p) { lat = p.lat; lng = p.lng; if (p.country) country = p.country; source = 'ipinfo' }
  } catch { /* keep Vercel values */ }

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
            source,
          }
        : { state, detectedCity: 'unknown', via, source },
    ))
  } catch {
    // Any failure → State B. Never blocks the client.
    res.statusCode = 200
    res.end(JSON.stringify({ state: 'city_unknown', detectedCity: 'unknown', via: 'error' }))
  }
}
