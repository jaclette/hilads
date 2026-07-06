/**
 * Regenerates api/_cities.mjs — the bundled snapshot of supported-city
 * coordinates the edge /api/geo matches against. Keeping the coords IN the
 * function bundle avoids a backend round-trip on every cold lambda (which blew
 * past the client's geo budget and forced everyone to State B).
 *
 * Run when the supported-cities set changes:  node api/_gen-cities.mjs
 * Best-effort: a brand-new city just won't match until this is re-run.
 */
import { writeFileSync } from 'node:fs'

const API_BASE = process.env.HILADS_API_BASE || 'https://api.hilads.live'

const r = await fetch(`${API_BASE}/api/v1/channels`, { headers: { Accept: 'application/json' } })
if (!r.ok) throw new Error(`channels ${r.status}`)
const { channels = [] } = await r.json()

const cities = channels
  .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
  .map(c => ({ id: c.channelId, c: c.city, co: (c.country || '').toUpperCase(), tz: c.timezone || 'UTC', lat: c.lat, lng: c.lng }))

const header =
  `// AUTO-GENERATED — do not edit by hand. Snapshot of supported-city coordinates\n` +
  `// for the edge IP→city match (/api/geo). Regenerate: node api/_gen-cities.mjs\n` +
  `// Compact keys: id=channelId, c=city, co=country(ISO2), tz=timezone.\n` +
  `// ${cities.length} cities · best-effort; new cities won't match until regenerated.\n`

writeFileSync(new URL('./_cities.mjs', import.meta.url), `${header}export const CITIES = ${JSON.stringify(cities)}\n`)
console.log(`wrote api/_cities.mjs with ${cities.length} cities`)
