/**
 * Shared by /api/daily-today and the /today page (api/today.mjs): fetch today's
 * Daily Challenge from the public API and trim it to what the web needs.
 *
 * Counts are left out on purpose: these responses are CDN-cached until the next
 * drop, so a count would freeze at its first value.
 *
 * HILADS_API_BASE (optional) points at another API, for local testing only.
 */

export const API_BASE = process.env.HILADS_API_BASE || 'https://api.hilads.live'

const MIN_TTL = 60
const MAX_TTL = 86400
const NO_CHALLENGE_TTL = 300   // an admin may still publish today's challenge

function trim(j) {
  const c = j.challenge
  const tw = j.twist
  return {
    challenge: c && c.text ? {
      date: c.date, text: c.text, context: c.context || null, endsAt: c.endsAt,
      // V2: the weekly theme and the user whose proposal it was.
      theme: c.theme && c.theme.key ? { key: c.theme.key, name: c.theme.name } : null,
      proposedBy: c.proposedBy && c.proposedBy.user ? {
        name: c.proposedBy.user.displayName || c.proposedBy.user.username || null,
        city: (c.proposedBy.city && c.proposedBy.city.name) || null,
      } : null,
    } : null,
    // Tomorrow's theme as a teaser (never its text).
    tomorrow: j.tomorrow && j.tomorrow.theme ? { date: j.tomorrow.date, theme: { key: j.tomorrow.theme.key, name: j.tomorrow.theme.name } } : null,
    nextDropAt: Number.isFinite(j.nextDropAt) ? j.nextDropAt : null,
    city: j.city ? { id: j.city.id, name: j.city.name || null, isLive: !!j.city.isLive } : null,
    twist: tw && tw.text
      ? { text: tw.text, by: (tw.author && (tw.author.displayName || tw.author.username)) || tw.credit || null }
      : null,
  }
}

/** Today's challenge (cityId = numeric city id, optional). null when the API fails. */
export async function fetchDailyToday(cityId, ms = 2500) {
  const qs = cityId ? `?cityId=${encodeURIComponent(cityId)}` : ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(`${API_BASE}/api/v1/daily/today${qs}`, {
      headers: { accept: 'application/json' }, signal: ctrl.signal,
    })
    if (!r.ok) {
      // Unknown city (400): answer as if no city was given.
      return r.status === 400 && cityId ? fetchDailyToday(null, ms) : null
    }
    return trim(await r.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** CDN TTL: until the next drop, so the cache turns over with the challenge. */
export function cacheSeconds(data, nowMs = Date.now()) {
  if (!data) return 30
  const left = data.nextDropAt ? data.nextDropAt - Math.floor(nowMs / 1000) : MAX_TTL
  const ttl = Math.max(MIN_TTL, Math.min(MAX_TTL, left))
  return data.challenge ? ttl : Math.min(ttl, NO_CHALLENGE_TTL)
}

export function cacheHeader(seconds) {
  return `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=60`
}
