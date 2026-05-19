/**
 * Vercel serverless function — per-page prerender for shareable URLs.
 *
 * Why this exists
 * ───────────────
 * Hilads is a Vite SPA. Without server rendering, every shared URL
 * (`/event/:id`, `/e/:id`, `/city/:slug`) returns the same generic
 * `index.html` to social crawlers — WhatsApp, iMessage, Twitter, FB,
 * Slack, LinkedIn. None of them execute JavaScript before reading meta
 * tags, so they never see the per-event / per-city OG metadata that the
 * client-side `setPageMeta()` injects after React mounts.
 *
 * This function intercepts those routes on Vercel's edge (via `vercel.json`
 * rewrites), fetches the page-specific data from `api.hilads.live`, replaces
 * the OG / Twitter / canonical / `<title>` tags in the SPA shell, and serves
 * the modified HTML. Humans get the same content — only the meta tags
 * differ. The SPA still hydrates normally.
 *
 * On any failure (API down, slow, malformed payload) the function falls back
 * to the unmodified shell — the page never breaks visibly.
 *
 * Caching
 * ───────
 * Events: s-maxage 5min, SWR 24h — attendee counts change minute-to-minute.
 * Cities: s-maxage 1h,  SWR 24h — city metadata is more stable.
 */

import { readFile }      from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const API_BASE  = process.env.HILADS_API_BASE || 'https://api.hilads.live'
const SITE_BASE = process.env.HILADS_SITE_BASE || 'https://hilads.live'

const API_TIMEOUT_MS   = 1500
const SHELL_TIMEOUT_MS = 2500

// ── Shell loader (cached per cold start) ──────────────────────────────────────
// Tries fs.readFile from several candidate paths (works when vercel.json's
// `functions[*].includeFiles` ships dist/index.html with the function bundle),
// then falls back to an HTTP fetch from the same origin if fs is empty-handed.
// We record where we got the shell from in `shellSource` so the response
// header can surface it for debugging.

let shellCache  = null
let shellSource = null     // 'fs:<path>' | 'http:<url>' | null

const HERE = (() => {
  try { return dirname(fileURLToPath(import.meta.url)) }
  catch { return null }
})()

// Candidates for fs.readFile, ordered most-likely-first on Vercel.
function fsCandidatePaths() {
  const out = []
  if (HERE) {
    // <fn>/dist/index.html (when includeFiles is colocated with the function)
    out.push(join(HERE, 'dist', 'index.html'))
    // <project root>/dist/index.html (when includeFiles is project-relative)
    out.push(join(HERE, '..', 'dist', 'index.html'))
    out.push(join(HERE, '..', '..', 'dist', 'index.html'))
  }
  if (process.cwd) {
    out.push(join(process.cwd(), 'dist', 'index.html'))
  }
  return out
}

async function tryFs() {
  for (const p of fsCandidatePaths()) {
    try {
      const html = await readFile(p, 'utf-8')
      shellSource = `fs:${p}`
      return html
    } catch { /* try next */ }
  }
  return null
}

async function tryHttp(req) {
  const host  = process.env.VERCEL_URL
              || req.headers['x-forwarded-host']
              || req.headers.host
              || 'hilads.live'
  const proto = req.headers['x-forwarded-proto']
              || (host.startsWith('localhost') ? 'http' : 'https')
  const url = `${proto}://${host}/index.html`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), SHELL_TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/html' } })
    if (!r.ok) {
      console.error('[prerender] shell HTTP', r.status, url)
      return null
    }
    shellSource = `http:${url}`
    return await r.text()
  } catch (err) {
    console.error('[prerender] shell HTTP error:', err.message, 'url=', url)
    return null
  } finally {
    clearTimeout(t)
  }
}

async function getShell(req) {
  if (shellCache) return shellCache
  shellCache = await tryFs()
  if (shellCache) return shellCache
  shellCache = await tryHttp(req)
  return shellCache
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mirrors apps/web/src/App.jsx cityToSlug() — keep in sync.
function cityToSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Mirrors apps/web/src/eventUtils.js eventSlug() — keep in sync.
function eventSlug(event) {
  if (!event?.id) return ''
  const titleSlug = String(event.title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return titleSlug ? `${titleSlug}-${event.id}` : event.id
}

// Mirrors apps/web/src/eventUtils.js extractEventHex() — keep in sync.
function extractEventHex(input) {
  const m = String(input || '').match(/([a-f0-9]{16})$/i)
  return m ? m[1].toLowerCase() : null
}

// Slug used for venue URLs: `/venue/<slug>-<series_id_hex>`. Mirrors the
// title-only slug pattern used for events (eventSlug) so the URL shape stays
// consistent across surfaces.
function venueSlugFromName(name, id) {
  const titleSlug = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return titleSlug ? `${titleSlug}-${id}` : id
}

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTime(unixTs, timezone) {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: timezone || 'UTC',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  })
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.warn(`[prerender] fetch failed (${url}):`, err.message)
    return null
  } finally {
    clearTimeout(t)
  }
}

// ── Per-surface metadata composers ────────────────────────────────────────────

function composeEventMeta(payload, canonicalPath, eventId) {
  // Backend shape: { event, cityName, country, timezone }
  const ev = payload?.event
  if (!ev || !ev.title) return null

  const where = ev.location ? ` at ${ev.location}` : ''
  const time  = ev.starts_at ? ` — 🕐 ${formatTime(ev.starts_at, payload.timezone)}` : ''
  const going = (ev.participant_count ?? 0) > 0 ? ` ${ev.participant_count} going.` : ''
  const description = `${ev.title}${where}${time}.${going} See who's there on Hilads.`

  return {
    title:       payload.cityName ? `${ev.title} · ${payload.cityName}` : ev.title,
    description,
    url:         `${SITE_BASE}${canonicalPath}`,
    // Per-event dynamic OG card generated by /api/og (M3). Crawlers fetch
    // this directly when rendering link previews; cached at the CDN.
    image:       `${SITE_BASE}/api/og?type=event&id=${encodeURIComponent(eventId)}`,
  }
}

function composeVenueMeta(payload, canonicalPath, venueId) {
  // Backend shape: { venue: { id, name, address, category, hours, city, ... } }
  const v = payload?.venue
  if (!v || !v.name) return null

  const cityName = v.city?.name || ''
  const where    = v.address ? ` at ${v.address}` : ''
  const description = `${v.name}${where}. See who's around in ${cityName} on Hilads.`

  return {
    title:       cityName ? `${v.name} · ${cityName}` : v.name,
    description,
    url:         `${SITE_BASE}${canonicalPath}`,
    // No dedicated venue OG image yet — reuse the city card so embeds aren't
    // generic. Cheap to swap to /api/og?type=venue&id=... when we ship it.
    image:       v.city?.slug
                  ? `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(v.city.slug)}`
                  : `${SITE_BASE}/og/og-default.png`,
  }
}

function composeCityMeta(payload, canonicalPath, citySlug) {
  // Backend shape: { channelId, city, country, timezone, slug }
  if (!payload?.city) return null
  return {
    title:       `What's happening in ${payload.city} right now`,
    description: `See who's around in ${payload.city} tonight on Hilads. Real-time city activity, no sign-up.`,
    url:         `${SITE_BASE}${canonicalPath}`,
    image:       `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(citySlug)}`,
  }
}

// ── JSON-LD composers ─────────────────────────────────────────────────────────
// Emitted as a single @graph script. Google reads each top-level entry as a
// separate entity. This unlocks Event rich results (carousel, calendar add)
// and ItemList signals on city pages without needing multiple <script> blocks.

const ORG_NODE = {
  '@type': 'Organization',
  name:    'Hilads',
  url:     SITE_BASE,
}

function isoOr(unixTs, fallback) {
  if (typeof unixTs !== 'number' || !Number.isFinite(unixTs)) return fallback
  return new Date(unixTs * 1000).toISOString()
}

function composeEventJsonLd(payload, canonicalUrl) {
  const ev = payload?.event
  if (!ev || !ev.title || !ev.starts_at) return null

  // Place node — venue + address + optional geo. Required by Google for Event
  // rich results to qualify.
  const place = {
    '@type': 'Place',
    name:    ev.venue || ev.location || payload.cityName || 'Hilads',
    address: {
      '@type':          'PostalAddress',
      streetAddress:    ev.location || ev.location_hint || undefined,
      addressLocality:  payload.cityName || undefined,
      addressCountry:   payload.country  || undefined,
    },
  }
  if (typeof ev.venue_lat === 'number' && typeof ev.venue_lng === 'number') {
    place.geo = {
      '@type':   'GeoCoordinates',
      latitude:  ev.venue_lat,
      longitude: ev.venue_lng,
    }
  }

  const event = {
    '@type':              'Event',
    '@id':                canonicalUrl,
    name:                 ev.title,
    startDate:            isoOr(ev.starts_at),
    endDate:              isoOr(ev.ends_at, undefined),
    eventStatus:          'https://schema.org/EventScheduled',
    eventAttendanceMode:  'https://schema.org/OfflineEventAttendanceMode',
    location:             place,
    image:                [payload._ogImage || `${SITE_BASE}/og/og-default.png`],
    description:          payload._descriptionForSchema,
    organizer:            ev.host_nickname
                            ? { '@type': 'Person', name: ev.host_nickname }
                            : ORG_NODE,
    url:                  canonicalUrl,
    // Free events: Google requires an Offer with availability + price=0 to
    // surface in event rich results without warning.
    offers: {
      '@type':         'Offer',
      url:             canonicalUrl,
      price:           '0',
      priceCurrency:   'USD',
      availability:    'https://schema.org/InStock',
      validFrom:       isoOr(ev.created_at ?? ev.starts_at - 86400),
    },
  }

  // Strip nullish fields so the JSON stays clean.
  for (const k of Object.keys(event)) if (event[k] === undefined) delete event[k]
  for (const k of Object.keys(place.address)) if (place.address[k] === undefined) delete place.address[k]

  const breadcrumb = composeBreadcrumb([
    { name: 'Home',                url: `${SITE_BASE}/` },
    payload.cityName && payload.citySlug
      ? { name: payload.cityName,  url: `${SITE_BASE}/city/${payload.citySlug}` }
      : null,
    { name: ev.title,              url: canonicalUrl },
  ].filter(Boolean))

  return {
    '@context': 'https://schema.org',
    '@graph': [event, breadcrumb],
  }
}

function composeVenueJsonLd(payload, canonicalUrl) {
  const v = payload?.venue
  if (!v || !v.name) return null

  // category 'bar' → BarOrPub, anything else (cafe) → CafeOrCoffeeShop.
  // These are well-known schema.org LocalBusiness subtypes Google supports.
  const type = v.category === 'bar' ? 'BarOrPub' : 'CafeOrCoffeeShop'

  const node = {
    '@type': type,
    '@id':   canonicalUrl,
    name:    v.name,
    address: {
      '@type':         'PostalAddress',
      streetAddress:   v.address || undefined,
      addressLocality: v.city?.name || undefined,
      addressCountry:  v.city?.country || undefined,
    },
    url: canonicalUrl,
  }

  // openingHoursSpecification: single window applied to every day, since the
  // seed only captures one open/close pair. Per-weekday data lands later.
  if (v.hours?.opens && v.hours?.closes) {
    node.openingHoursSpecification = [{
      '@type':     'OpeningHoursSpecification',
      dayOfWeek:   Array.isArray(v.hours.daysOfWeek) && v.hours.daysOfWeek.length > 0
                     ? v.hours.daysOfWeek
                     : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
      opens:       v.hours.opens,
      closes:      v.hours.closes,
    }]
  }

  for (const k of Object.keys(node.address)) if (node.address[k] === undefined) delete node.address[k]

  const breadcrumb = composeBreadcrumb([
    { name: 'Home', url: `${SITE_BASE}/` },
    v.city?.name && v.city?.slug
      ? { name: v.city.name, url: `${SITE_BASE}/city/${v.city.slug}` }
      : null,
    { name: v.name, url: canonicalUrl },
  ].filter(Boolean))

  return { '@context': 'https://schema.org', '@graph': [node, breadcrumb] }
}

function composeCityJsonLd(payload, canonicalUrl, upcomingEvents) {
  if (!payload?.city) return null

  const place = {
    '@type': 'Place',
    '@id':   canonicalUrl,
    name:    payload.city,
    address: {
      '@type':         'PostalAddress',
      addressLocality: payload.city,
      addressCountry:  payload.country || undefined,
    },
    url:     canonicalUrl,
  }
  for (const k of Object.keys(place.address)) if (place.address[k] === undefined) delete place.address[k]

  const graph = [place, composeBreadcrumb([
    { name: 'Home',         url: `${SITE_BASE}/` },
    { name: payload.city,   url: canonicalUrl    },
  ])]

  // ItemList signals to Google that the city page is an authoritative index of
  // events in that city — improves ranking on geographic queries. Cap at 10
  // entries to keep the payload light.
  if (Array.isArray(upcomingEvents) && upcomingEvents.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name:    `Upcoming events in ${payload.city}`,
      numberOfItems: upcomingEvents.length,
      itemListElement: upcomingEvents.slice(0, 10).map((ev, i) => ({
        '@type':   'ListItem',
        position:  i + 1,
        url:       `${SITE_BASE}/event/${ev.id}`,
        name:      ev.title,
      })),
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}

function composeBreadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      name:      it.name,
      item:      it.url,
    })),
  }
}

// JSON-LD content can include `</script>` in user data — escape that and the
// `<` to keep parsers happy. Standard recipe.
function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003C')
}

// ── HTML transformation ──────────────────────────────────────────────────────
// Targeted regex per tag — never DOM-parses. If a tag doesn't match (e.g. the
// shell template changed), that tag is left untouched. Self-healing if the
// shell drifts.

// Inject a JSON-LD script tag just before </head>. Schemas drive Google Event
// rich results + ItemList ranking signals; doesn't affect human visitors.
function injectJsonLd(shell, jsonLd) {
  if (!jsonLd) return shell
  const tag = `<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>\n  </head>`
  return shell.replace(/<\/head>/i, tag)
}

function injectMeta(shell, meta) {
  const t   = htmlEscape(meta.title)
  const d   = htmlEscape(meta.description)
  const u   = htmlEscape(meta.url)
  const img = meta.image ? htmlEscape(meta.image) : null

  let out = shell
    .replace(/<title>[^<]*<\/title>/i, `<title>${t}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${d}" />`,
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${t}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${d}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${u}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${t}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${d}" />`,
    )
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${u}" />`,
    )

  if (img) {
    // Replace BOTH og:image variants (regular + secure_url) and twitter:image.
    out = out
      .replace(
        /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:image" content="${img}" />`,
      )
      .replace(
        /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:image:secure_url" content="${img}" />`,
      )
      .replace(
        /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
        `<meta name="twitter:image" content="${img}" />`,
      )
  }

  return out
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const shell = await getShell(req)
  if (!shell) {
    // Both fs and HTTP failed. Surface enough context in the response to
    // diagnose; Vercel function logs will also have the per-attempt errors.
    const fsTried = fsCandidatePaths().join(' | ')
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('x-prerender-error', 'shell-unavailable')
    res.end(`prerender: shell unavailable
fs candidates tried: ${fsTried}
http host: ${process.env.VERCEL_URL || req.headers['x-forwarded-host'] || req.headers.host || '(none)'}
`)
    return
  }

  const { type, id, slug, shortlink } = req.query || {}
  const isShortLink = shortlink === '1'

  let meta          = null
  let jsonLd        = null
  let canonicalPath = '/'
  let cacheMaxAge   = 60     // tiny default; widened only when we actually inject meta

  try {
    if (type === 'event' && typeof id === 'string') {
      // Accept BOTH bare 16-hex IDs (legacy + short-link path) AND the new
      // slug form `kebab-title-<16-hex>`. Always extract the trailing 16-hex
      // as the canonical lookup key.
      const hex = extractEventHex(id)
      if (hex) {
        const inputIsHexOnly = id.toLowerCase() === hex
        const data = await fetchWithTimeout(
          `${API_BASE}/api/v1/events/${encodeURIComponent(hex)}`,
          API_TIMEOUT_MS,
        )

        // SEO: occurrences of seeded venues (coffee shops, bars) MUST 301 to
        // the canonical /venue/<slug>-<series_id> page. Google has thousands
        // of these /event/<...> URLs cached from before the refactor.
        if (data?.event?.is_venue && data.event.series_id) {
          const venueSlugId = venueSlugFromName(data.event.title, data.event.series_id)
          res.statusCode = 301
          res.setHeader('Location', `${SITE_BASE}/venue/${venueSlugId}`)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end()
          return
        }

        // Expired-occurrence fallback: the event 404s but the channel_id
        // might still resolve to a venue (we stopped materializing future
        // occurrences but Google has them cached). One extra hop in the
        // tail of the SEO transition; cheap and correct.
        if (!data?.event && !isShortLink) {
          const redirect = await fetchWithTimeout(
            `${API_BASE}/api/v1/events/${encodeURIComponent(hex)}/venue-redirect`,
            API_TIMEOUT_MS,
          )
          if (redirect?.venue?.id) {
            const venueSlugId = redirect.venue.slug
              ? `${redirect.venue.slug}-${redirect.venue.id}`
              : redirect.venue.id
            res.statusCode = 301
            res.setHeader('Location', `${SITE_BASE}/venue/${venueSlugId}`)
            res.setHeader('Cache-Control', 'public, max-age=3600')
            res.end()
            return
          }
        }

        // 301 from /event/<bare-hex> to /event/<slug>-<hex> when we can resolve
        // the event. Consolidates SEO authority on the slug version. Skipped
        // for /e/<hex> short links (shortlink=1 flag) — those stay short by
        // design; SEO consolidation still happens via <link rel="canonical">.
        if (data?.event && inputIsHexOnly && !isShortLink) {
          const slugId = eventSlug(data.event)
          res.statusCode = 301
          res.setHeader('Location', `${SITE_BASE}/event/${slugId}`)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end()
          return
        }

        // Canonical URL is always the slug version when we have event data.
        canonicalPath = data?.event ? `/event/${eventSlug(data.event)}` : `/event/${hex}`
        meta = composeEventMeta(data, canonicalPath, hex)
        if (meta) {
          cacheMaxAge = 300                  // 5 min — events churn
          const augmented = {
            ...data,
            _descriptionForSchema: meta.description,
            _ogImage:               meta.image,
            citySlug:               data.cityName ? cityToSlug(data.cityName) : undefined,
          }
          jsonLd = composeEventJsonLd(augmented, meta.url)
        }
      }
    } else if (type === 'venue' && typeof id === 'string') {
      const hex = extractEventHex(id)
      if (hex) {
        const inputIsHexOnly = id.toLowerCase() === hex
        const data = await fetchWithTimeout(
          `${API_BASE}/api/v1/venues/${encodeURIComponent(hex)}`,
          API_TIMEOUT_MS,
        )

        // 301 from /venue/<bare-hex> to /venue/<slug>-<hex> — same SEO
        // consolidation move as events.
        if (data?.venue && inputIsHexOnly) {
          const slugId = venueSlugFromName(data.venue.name, data.venue.id)
          res.statusCode = 301
          res.setHeader('Location', `${SITE_BASE}/venue/${slugId}`)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end()
          return
        }

        canonicalPath = data?.venue
          ? `/venue/${venueSlugFromName(data.venue.name, data.venue.id)}`
          : `/venue/${hex}`
        meta = composeVenueMeta(data, canonicalPath, hex)
        if (meta) {
          cacheMaxAge = 3600                 // 1 h — venue info changes rarely
          jsonLd = composeVenueJsonLd(data, meta.url)
        }
      }
    } else if (type === 'city' && typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      canonicalPath = `/city/${slug}`
      const cityData = await fetchWithTimeout(
        `${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`,
        API_TIMEOUT_MS,
      )
      meta = composeCityMeta(cityData, canonicalPath, slug)
      if (meta) {
        cacheMaxAge = 3600                 // 1 h — cities stable
        // Second call: upcoming events in the city, for the ItemList signal.
        // Best-effort — if it fails, JSON-LD still emits Place + Breadcrumb.
        let upcoming = null
        if (cityData?.channelId) {
          const upcomingData = await fetchWithTimeout(
            `${API_BASE}/api/v1/channels/${encodeURIComponent(cityData.channelId)}/events/upcoming?days=7`,
            API_TIMEOUT_MS,
          )
          upcoming = Array.isArray(upcomingData?.events) ? upcomingData.events : null
        }
        jsonLd = composeCityJsonLd(cityData, meta.url, upcoming)
      }
    }
  } catch (err) {
    console.error('[prerender] composer failed:', err)
    meta = null
    jsonLd = null
  }

  let html = shell
  if (meta)   html = injectMeta(html,   meta)
  if (jsonLd) html = injectJsonLd(html, jsonLd)

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Always allow CDN caching, with stale-while-revalidate so users never wait
  // on a cold cache miss.
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${cacheMaxAge}, stale-while-revalidate=86400`,
  )
  // Surface for debugging in DevTools / curl. Helps confirm that crawlers are
  // hitting the prerender path vs the static shell.
  res.setHeader('x-prerender', meta ? `${type}-hit` : `${type ?? 'none'}-miss`)
  if (shellSource) res.setHeader('x-prerender-shell', shellSource)
  res.end(html)
}
