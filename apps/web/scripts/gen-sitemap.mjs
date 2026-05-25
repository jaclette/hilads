#!/usr/bin/env node
/**
 * gen-sitemap.mjs — generate apps/web/public/sitemap.xml from the live channel
 * list. Run manually or as a deploy step:
 *
 *     npm run gen:sitemap
 *
 * Env vars:
 *   SITEMAP_BASE_URL   — site origin (default: https://hilads.live)
 *   SITEMAP_API_URL    — channels API endpoint
 *                        (default: https://api.hilads.live/api/v1/channels)
 *
 * Behavior: if the API is unreachable, emit a homepage-only sitemap with a
 *           console warning rather than failing the script. That way the file
 *           always exists and the build never breaks because the API is down.
 */

import { writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH  = resolve(__dirname, '../public/sitemap.xml')

const BASE_URL    = (process.env.SITEMAP_BASE_URL || 'https://hilads.live').replace(/\/+$/, '')
const API_URL     = process.env.SITEMAP_API_URL    || 'https://api.hilads.live/api/v1/channels'
const VENUES_URL  = process.env.SITEMAP_VENUES_URL || 'https://api.hilads.live/api/v1/sitemap/venues'
const CATS_URL    = process.env.SITEMAP_CATS_URL   || 'https://api.hilads.live/api/v1/sitemap/categories'

// The /venue/<slug>-<id> URL format launched 2026-05-20 (commit fa5a1dc,
// "venues as LocalBusiness"). Venues were seeded earlier, so their created_at
// (which the API returns as updated_at) predates the URL change — flooring
// lastmod at the launch date tells Google the URL actually changed then.
// Venues created after launch keep their own (newer) date. event_series has no
// real updated_at column yet; revisit this floor if one is added.
const VENUE_URL_LAUNCH = process.env.SITEMAP_VENUE_LAUNCH || '2026-05-20'

// IndexNow: pings Bing + Yandex + Naver on every sitemap regeneration.
// The key file at /<INDEXNOW_KEY>.txt proves domain ownership.
// Only POSTs when running on Vercel (or with INDEXNOW_SUBMIT=1) to avoid
// hammering the protocol from local dev runs.
const INDEXNOW_KEY    = process.env.INDEXNOW_KEY    || '1964b95cf0dd14f803702bca498c0d89'
const INDEXNOW_SUBMIT = process.env.INDEXNOW_SUBMIT === '1' || process.env.VERCEL === '1'

// Mirrors apps/web/src/App.jsx cityToSlug(). Keep these in sync.
function cityToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Mirrors prerender.mjs venueSlugFromName — venue URLs are /venue/<slug>-<id>.
function venueSlug(name, id) {
  const t = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return t ? `${t}-${id}` : id
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Option A i18n: the sitemap lists the un-prefixed (English) canonical, and
// each entry advertises its /fr and /vi alternates + x-default via xhtml:link
// so Google clusters the language versions. loc is always BASE_URL + path.
const SITEMAP_LOCALES = ['en', 'fr', 'vi']
function hreflangLinks(loc) {
  const path = loc.startsWith(BASE_URL) ? loc.slice(BASE_URL.length) : null
  if (path === null) return []
  const alt = (l) => `${BASE_URL}${l === 'en' ? '' : '/' + l}${path}`
  return [
    ...SITEMAP_LOCALES.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(alt(l))}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(alt('en'))}"/>`,
  ]
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    ...hreflangLinks(loc),
    lastmod    ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority   ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n')
}

async function fetchChannels() {
  try {
    const res = await fetch(API_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      console.warn(`[sitemap] API responded ${res.status}; falling back to homepage-only sitemap`)
      return []
    }
    const data = await res.json()
    return Array.isArray(data?.channels) ? data.channels : []
  } catch (err) {
    console.warn(`[sitemap] could not reach ${API_URL} (${err.message}); falling back to homepage-only sitemap`)
    return []
  }
}

async function fetchVenues() {
  try {
    const res = await fetch(VENUES_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      console.warn(`[sitemap] venues API responded ${res.status}; skipping venue URLs`)
      return []
    }
    const data = await res.json()
    return Array.isArray(data?.venues) ? data.venues : []
  } catch (err) {
    console.warn(`[sitemap] could not reach ${VENUES_URL} (${err.message}); skipping venue URLs`)
    return []
  }
}

async function fetchCategoryPairs() {
  try {
    const res = await fetch(CATS_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      console.warn(`[sitemap] categories API responded ${res.status}; skipping category URLs`)
      return []
    }
    const data = await res.json()
    return Array.isArray(data?.pairs) ? data.pairs : []
  } catch (err) {
    console.warn(`[sitemap] could not reach ${CATS_URL} (${err.message}); skipping category URLs`)
    return []
  }
}

async function main() {
  const [channels, venues, categoryPairs] = await Promise.all([
    fetchChannels(),
    fetchVenues(),
    fetchCategoryPairs(),
  ])
  const today    = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD

  const entries = [
    // Home — highest authority page on the site.
    urlEntry({
      loc:        `${BASE_URL}/`,
      lastmod:    today,
      changefreq: 'daily',
      priority:   '1.0',
    }),
    // /cities — the dedicated index page (S2). Crawl-graph hub linking out
    // to every city URL. Slightly lower priority than home but higher than
    // any individual city.
    urlEntry({
      loc:        `${BASE_URL}/cities`,
      lastmod:    today,
      changefreq: 'daily',
      priority:   '0.9',
    }),
  ]

  // Only index-worthy cities belong in the sitemap, using the SAME criterion
  // the prerender uses for the robots tag: indexable iff the city has chat
  // messages OR active events OR seeded venues. Listing a noindex city here
  // would contradict its robots meta. messageCount / eventCount / lastActivityAt
  // come straight from /channels; venue presence is derived from the venue list.
  const venueCitySlugs = new Set(
    venues
      .map(v => (v?.city_name ? cityToSlug(v.city_name) : null))
      .filter(Boolean),
  )

  // De-duplicate by slug (cities are unique by name in practice, but the API
  // can briefly return duplicates during DB migrations — defensive).
  const seen = new Set()
  const indexableCities = []   // { slug, lastmod }
  for (const ch of channels) {
    const name = ch?.city
    if (!name || typeof name !== 'string') continue
    const slug = cityToSlug(name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)

    const messageCount = Number(ch?.messageCount) || 0
    const eventCount   = Number(ch?.eventCount)   || 0
    const indexable    = messageCount > 0 || eventCount > 0 || venueCitySlugs.has(slug)
    if (!indexable) continue   // noindex city — keep it out of the sitemap

    // lastmod reflects a real change: the city's last activity (most recent
    // message/event). For a city that just crossed 0→1 message that IS the
    // noindex→indexable transition date; ongoing chat keeps bumping it. Fall
    // back to the deploy date only when there's no activity timestamp (e.g.
    // venue-only inclusion). Never hardcoded, never blindly "now".
    const lastmod = Number.isFinite(ch?.lastActivityAt) && ch.lastActivityAt > 0
      ? new Date(ch.lastActivityAt * 1000).toISOString().slice(0, 10)
      : today

    indexableCities.push({ slug, lastmod })
  }

  for (const c of indexableCities) {
    entries.push(urlEntry({
      loc:        `${BASE_URL}/city/${c.slug}`,
      lastmod:    c.lastmod,
      changefreq: 'hourly',     // event lists turn over fast
      priority:   '0.8',
    }))
  }

  // Category × city pages — only pairs that pass the threshold (≥3 combined
  // events + venues, enforced server-side). Long-tail traffic capture.
  for (const p of categoryPairs) {
    if (!p?.city_slug || !p?.category) continue
    entries.push(urlEntry({
      loc:        `${BASE_URL}/city/${p.city_slug}/${p.category}`,
      lastmod:    today,
      changefreq: 'daily',
      priority:   '0.7',
    }))
  }

  // Venue pages — one per seeded venue (coffee shop / bar). One canonical URL
  // per venue; we never put per-day occurrence URLs in the sitemap.
  for (const v of venues) {
    if (!v?.id || !v?.name) continue
    const created = v.updated_at
      ? new Date(v.updated_at * 1000).toISOString().slice(0, 10)
      : today
    // Floor at the URL-launch date: a March-seeded venue whose URL changed in
    // May reports the May date; anything newer keeps its own.
    const lastmod = created > VENUE_URL_LAUNCH ? created : VENUE_URL_LAUNCH
    entries.push(urlEntry({
      loc:        `${BASE_URL}/venue/${venueSlug(v.name, v.id)}`,
      lastmod,
      changefreq: 'weekly',
      priority:   '0.6',
    }))
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')

  await writeFile(OUT_PATH, xml, 'utf8')
  console.log(`[sitemap] wrote ${entries.length} URL${entries.length === 1 ? '' : 's'} to ${OUT_PATH}`)

  // Tell Bing/Yandex/Naver via IndexNow. Best-effort — never fail the build
  // on this. Submission accepts up to 10000 URLs per request; we're nowhere
  // near that cap, but the slice() is defensive.
  if (INDEXNOW_SUBMIT) {
    const urls = [
      `${BASE_URL}/`,
      `${BASE_URL}/cities`,
      // Same indexable set as the sitemap — don't ping search engines about
      // cities we're telling them not to index.
      ...indexableCities.map(c => `${BASE_URL}/city/${c.slug}`),
      ...categoryPairs.map(p => `${BASE_URL}/city/${p.city_slug}/${p.category}`),
      ...venues.map(v => v?.id && v?.name ? `${BASE_URL}/venue/${venueSlug(v.name, v.id)}` : null).filter(Boolean),
    ].slice(0, 10000)

    try {
      const res = await fetch('https://api.indexnow.org/IndexNow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host:        new URL(BASE_URL).host,
          key:         INDEXNOW_KEY,
          keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
          urlList:     urls,
        }),
      })
      console.log(`[indexnow] submitted ${urls.length} URLs → ${res.status} ${res.statusText}`)
    } catch (err) {
      console.warn(`[indexnow] submission failed (${err.message}); non-fatal`)
    }
  } else {
    console.log('[indexnow] skipped (set INDEXNOW_SUBMIT=1 or run on Vercel)')
  }
}

main().catch(err => {
  console.error('[sitemap] failed:', err)
  process.exit(1)
})
