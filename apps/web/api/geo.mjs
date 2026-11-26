/**
 * /api/geo — IP → Hilads city, for the web landing (/, shared challenges) and the app's first launch.
 *
 * Runs at the EDGE, next to the visitor (it used to run in one US data centre, ~0.4-0.6 s from Asia,
 * so the web's 600 ms budget often ran out and everyone was dropped into Saigon).
 *
 * Location: Vercel's edge headers (instant, free) refined by ipinfo.io when it answers within
 * IPINFO_BUDGET_MS (more precise city, plus the network name used to spot data centres). The IP is
 * sent to ipinfo for that lookup only: never logged, returned or stored. IPINFO_TOKEN (optional)
 * raises ipinfo's rate limit.
 *
 * Matching (api/_geo-core.mjs): a Hilads city within 50 km → city_matched; else the nearest Hilads
 * city in the visitor's country → country_matched; else city_unknown (+ reason) → the client shows
 * the city picker. Never a default city. IP never creates a city.
 *
 * City list: the live list from the API (/api/v1/channels), kept per edge instance and refreshed in
 * the background every LIVE_TTL_MS; the bundled snapshot (api/_cities.mjs) answers until then.
 *
 * Response (unchanged fields + new ones): {state, city?, channelId?, country?, timezone?, detectedCity,
 * via, source, reason?, km?, visitorCountry?, ms, list}. Old apps only read state === 'city_matched'.
 */

import { CITIES as BUNDLED } from './_cities.mjs'
import { resolveCity } from './_geo-core.mjs'

export const config = { runtime: 'edge' }

const IPINFO_BUDGET_MS = 600
const LIVE_TTL_MS = 10 * 60 * 1000
const API_BASE = (typeof process !== 'undefined' && process.env?.HILADS_API_BASE) || 'https://api.hilads.live'

// Per edge instance: the live city list and when it was fetched.
let live = null
let liveAt = 0
let refreshing = null

function refreshLive() {
  if (refreshing) return refreshing
  refreshing = fetch(`${API_BASE}/api/v1/channels`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const list = (d?.channels ?? [])
        .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map(c => ({ id: c.channelId, c: c.city, co: String(c.country || '').toUpperCase(), tz: c.timezone || 'UTC', lat: c.lat, lng: c.lng }))
      if (list.length >= 50) { live = list; liveAt = Date.now() }
    })
    .catch(() => {})
    .finally(() => { refreshing = null })
  return refreshing
}

function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') || ''
  return xff.split(',')[0].trim() || (req.headers.get('x-real-ip') || '').trim()
}

async function ipinfo(ip) {
  if (!ip) return null
  const token = typeof process !== 'undefined' ? process.env?.IPINFO_TOKEN : undefined
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${encodeURIComponent(token)}` : ''}`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(IPINFO_BUDGET_MS) })
    if (!r.ok) return null
    const d = await r.json()
    if (typeof d.loc !== 'string' || !d.loc.includes(',')) return null
    const [lat, lng] = d.loc.split(',').map(Number)
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, country: String(d.country || '').toUpperCase(), org: d.org || null }
      : null
  } catch {
    return null   // too slow / network: Vercel's headers are used
  }
}

export default async function handler(req, context) {
  const t0 = Date.now()
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
  try {
    // The live list: refreshed in the background when old; never waited for here.
    if (!live || Date.now() - liveAt > LIVE_TTL_MS) {
      const p = refreshLive()
      if (context && typeof context.waitUntil === 'function') context.waitUntil(p)
    }
    const cities = live ?? BUNDLED

    let loc = {
      lat: parseFloat(req.headers.get('x-vercel-ip-latitude') ?? ''),
      lng: parseFloat(req.headers.get('x-vercel-ip-longitude') ?? ''),
      country: (req.headers.get('x-vercel-ip-country') || '').toUpperCase(),
      org: null,
    }
    let source = 'vercel'
    const precise = await ipinfo(clientIp(req))
    if (precise) { loc = precise; source = 'ipinfo' }

    const r = resolveCity(cities, loc)
    const base = { via: r.via, source, reason: r.reason ?? null, km: r.km ?? null, visitorCountry: loc.country || null,
                   ms: Date.now() - t0, list: live ? 'live' : 'bundled' }
    const body = r.city
      ? { state: r.state, city: r.city.c, channelId: r.city.id, country: r.city.co, timezone: r.city.tz, detectedCity: r.city.c, ...base }
      : { state: r.state, detectedCity: 'unknown', ...base }
    // One line per lookup in Vercel's logs (no IP), for before / after measurement.
    console.log(JSON.stringify({ geo: body.state, via: body.via, source, reason: body.reason, km: body.km, country: body.visitorCountry, ms: body.ms, list: body.list }))
    return new Response(JSON.stringify(body), { status: 200, headers })
  } catch {
    return new Response(JSON.stringify({ state: 'city_unknown', detectedCity: 'unknown', via: 'error', reason: 'error', ms: Date.now() - t0 }), { status: 200, headers })
  }
}
