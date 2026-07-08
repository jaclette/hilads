/**
 * /api/leaderboard-top — cached top-10 worldwide "Most Local" board for the
 * /join conversion landing (social proof + the "dethrone the #1" hook).
 *
 * WHY A PROXY (not a direct client call to the API): the PHP API has no cache
 * layer and the DB has a hard egress cap. A paid Instagram campaign can send a
 * lot of /join views; if each fetched /leaderboard directly, that's one fresh
 * Postgres scan per visitor. This function is CDN-cached (s-maxage=300), so all
 * that traffic reads the cached copy and the backend is hit ~once every 5 min.
 *
 * Returns a MINIMAL shape (only what the card renders). Any failure → empty
 * list, and the page simply hides the leaderboard section (never blocks).
 */

const UPSTREAM =
  'https://api.hilads.live/api/v1/leaderboard?scope=world&period=alltime&limit=10'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  // Shared across all visitors → CDN-cacheable. 5 min fresh, then serve stale
  // while revalidating so a cache miss never waits on the backend.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')

  try {
    const r = await fetch(UPSTREAM, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error('upstream ' + r.status)
    const j = await r.json()
    const entries = Array.isArray(j.entries) ? j.entries : []
    const items = entries.slice(0, 10).map((e) => ({
      rank: e.rank,
      name: e.displayName || '',
      city: e.cityName || '',
      country: e.cityCountry || '',
      points: e.points ?? 0,
      avatar: e.thumbAvatarUrl || '',
    }))
    res.statusCode = 200
    res.end(JSON.stringify({ items }))
  } catch {
    res.statusCode = 200
    res.end(JSON.stringify({ items: [] }))
  }
}
