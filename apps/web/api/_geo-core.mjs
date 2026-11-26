/**
 * IP → Hilads city matching, shared by /api/geo (edge) and its tests. Pure: no I/O.
 *
 * 1. A Hilads city within MATCH_RADIUS_KM of the visitor        → city_matched   (as before)
 * 2. Else the nearest Hilads city IN THE VISITOR'S COUNTRY       → country_matched (new: never
 *    another country's city, never Saigon "by default")
 * 3. Else (no location, no country, no Hilads city in that country,
 *    or a data-centre / cloud network)                           → city_unknown: the client shows
 *    the city picker and joins nothing.
 *
 * IP never creates a city (V5-01): only existing Hilads cities are matched.
 */

export const MATCH_RADIUS_KM = 50

/** Great-circle distance in km. */
export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const r = Math.PI / 180
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Cloud / hosting / data-centre networks: no person lives there (VPN exits, link-preview bots,
 * ad crawlers, proxies). Matched on the ipinfo "org" field ("AS16509 Amazon.com, Inc.").
 */
const DATACENTER_ASNS = new Set([
  'AS16509', 'AS14618', 'AS8987',            // Amazon AWS
  'AS15169', 'AS396982', 'AS19527',          // Google, Google Cloud
  'AS8075', 'AS8068',                        // Microsoft Azure
  'AS150436', 'AS138699', 'AS396986',        // BytePlus / ByteDance
  'AS45102', 'AS37963',                      // Alibaba Cloud
  'AS132203', 'AS45090',                     // Tencent Cloud
  'AS24940', 'AS213230',                     // Hetzner
  'AS16276',                                 // OVH
  'AS14061',                                 // DigitalOcean
  'AS63949',                                 // Linode / Akamai Cloud
  'AS20473',                                 // Vultr / Choopa
  'AS31898',                                 // Oracle Cloud
  'AS51167',                                 // Contabo
  'AS60781', 'AS28753',                      // Leaseweb
  'AS9009',                                  // M247 (VPN exits)
  'AS212238', 'AS136787', 'AS62240',         // Datacamp / CDN77, TEFINCOM (NordVPN), Clouvider
  'AS13335', 'AS209242',                     // Cloudflare (WARP / workers)
])
const DATACENTER_WORDS = /\b(amazon|aws|google cloud|microsoft azure|azure|byteplus|bytedance|alibaba|aliyun|tencent cloud|hetzner|ovh|digitalocean|linode|akamai connected cloud|vultr|choopa|oracle cloud|contabo|leaseweb|m247|datacamp|cdn77|clouvider|nordvpn|expressvpn|surfshark|proton ?vpn|mullvad|hosting|data ?cent(er|re)|colocation|vps|server)\b/i

export function isDatacenter(org) {
  if (!org) return false
  const asn = String(org).split(' ')[0].toUpperCase()
  return DATACENTER_ASNS.has(asn) || DATACENTER_WORDS.test(String(org))
}

/**
 * cities: [{id, c (name), co (ISO2), tz, lat, lng}]. loc: {lat, lng, country, org}.
 * Returns {state, city?, via, reason?, km?}.
 */
export function resolveCity(cities, loc) {
  const lat = Number(loc?.lat)
  const lng = Number(loc?.lng)
  const country = String(loc?.country || '').toUpperCase()
  if (isDatacenter(loc?.org)) return { state: 'city_unknown', via: 'none', reason: 'datacenter' }

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  if (hasCoords) {
    let best = null
    let bestKm = Infinity
    for (const c of cities) {
      const km = distanceKm(lat, lng, c.lat, c.lng)
      if (km < bestKm) { bestKm = km; best = c }
    }
    if (best && bestKm <= MATCH_RADIUS_KM) return { state: 'city_matched', city: best, via: 'proximity', km: Math.round(bestKm) }
  }

  if (!/^[A-Z]{2}$/.test(country)) return { state: 'city_unknown', via: 'none', reason: hasCoords ? 'no_country' : 'no_location' }
  const inCountry = cities.filter(c => c.co === country)
  if (inCountry.length === 0) return { state: 'city_unknown', via: 'none', reason: 'no_city_in_country' }

  // Nearest Hilads city in the visitor's country; without coordinates, its most active one (list order).
  let best = inCountry[0]
  let bestKm = null
  if (hasCoords) {
    bestKm = Infinity
    for (const c of inCountry) {
      const km = distanceKm(lat, lng, c.lat, c.lng)
      if (km < bestKm) { bestKm = km; best = c }
    }
  }
  return { state: 'country_matched', city: best, via: 'country', km: bestKm === null ? null : Math.round(bestKm) }
}
