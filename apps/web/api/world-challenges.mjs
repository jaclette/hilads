/**
 * /api/world-challenges — cached list of live INTERNATIONAL (cross-city)
 * challenges for the /join landing's 3rd slide.
 *
 * Same rationale as /api/leaderboard-top: CDN-cached (s-maxage=300) so a paid
 * campaign hits the DB ~once every 5 min, not once per visitor (the DB has no
 * cache layer + an egress cap). Minimal shape; empty list on any failure so the
 * page just hides the slide.
 */

const UPSTREAM = 'https://api.hilads.live/api/v1/world/challenges'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')

  try {
    const r = await fetch(UPSTREAM, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error('upstream ' + r.status)
    const j = await r.json()
    const rows = Array.isArray(j.challenges) ? j.challenges : []
    const items = rows.slice(0, 6).map((e) => ({
      title: e.title || '',
      city: e.city || '',
      country: e.country || '',
      targetCity: e.target_city || '',
      targetCountry: e.target_country || '',
      type: e.challenge_type || '',
      creator: e.creator_display_name || e.creator_username || '',
      avatar: e.creator_thumb_avatar_url || '',
    }))
    res.statusCode = 200
    res.end(JSON.stringify({ items }))
  } catch {
    res.statusCode = 200
    res.end(JSON.stringify({ items: [] }))
  }
}
