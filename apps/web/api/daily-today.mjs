/**
 * /api/daily-today?cityId=N — today's Daily Challenge for the /today page:
 * the challenge, the city's live flag and, in a live city, its Local Twist.
 *
 * Same rationale as /api/world-challenges: CDN-cached (until the next drop,
 * one copy per city) so a shared link hits the API about once per city per day,
 * not once per visitor. Empty result on any failure; the page just shows what
 * it already has.
 */

import { fetchDailyToday, cacheSeconds, cacheHeader } from './_daily.mjs'

export default async function handler(req, res) {
  const raw = String((req.query && req.query.cityId) || '')
  const cityId = /^\d{1,7}$/.test(raw) ? raw : null

  const data = await fetchDailyToday(cityId)
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', cacheHeader(cacheSeconds(data)))
  res.end(JSON.stringify(data || { challenge: null, nextDropAt: null, city: null, twist: null }))
}
