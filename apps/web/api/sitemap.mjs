/**
 * Vercel serverless function — dynamic /sitemap.xml.
 *
 * Replaces the old build-time scripts/gen-sitemap.mjs (which wrote a static
 * public/sitemap.xml that only refreshed on deploy and never listed events).
 * This generates the sitemap ON REQUEST from current backend data, so a newly
 * created event appears automatically — within the CDN cache TTL, no redeploy.
 *
 * Routing: vercel.json rewrites /sitemap.xml → /api/sitemap. The static file
 * was deleted because Vercel serves filesystem matches BEFORE rewrites, so a
 * committed public/sitemap.xml would shadow this function.
 *
 * Cache: s-maxage 3 h + 24 h stale-while-revalidate. Crawler hits are served
 * from the Vercel CDN; the backend is queried only on a cache miss (≈ every
 * 3 h), never per request. A few hours of staleness is fine for SEO.
 *
 * Contents (mirrors gen-sitemap.mjs, plus events):
 *   - home + /cities core pages
 *   - indexable city pages (chat OR active events OR venues — matches the
 *     prerender's noindex criterion; empty cities excluded)
 *   - category × city pages (server-side ≥3 threshold)
 *   - venue pages (/venue/<slug>-<id>)
 *   - EVENT pages (/event/<slug>-<id>) — non-expired, non-deleted, non-venue
 * Hangouts/topics (private, 24 h TTL) are never included.
 *
 * Each entry uses the un-prefixed English URL as the canonical <loc> and lists
 * /fr, /vi, /es + x-default as <xhtml:link> alternates (one <url> per page).
 */

const API_BASE  = process.env.HILADS_API_BASE  || 'https://api.hilads.live'
const SITE_BASE = (process.env.HILADS_SITE_BASE || 'https://hilads.live').replace(/\/+$/, '')

// Venue URLs (/venue/<slug>-<id>) launched 2026-05-20; floor their lastmod
// there so pre-launch-seeded venues report the date the URL actually changed.
// Mirrors gen-sitemap.mjs VENUE_URL_LAUNCH.
const VENUE_URL_LAUNCH = process.env.SITEMAP_VENUE_LAUNCH || '2026-05-20'

const SITEMAP_LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko']

// ── Slug helpers — keep in sync with App.jsx cityToSlug / eventUtils eventSlug
//    / prerender.mjs venueSlug (the repo intentionally mirrors these). ──────────

function cityToSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function venueSlug(name, id) {
  const t = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return t ? `${t}-${id}` : id
}

function eventSlug(title, id) {
  const t = stripDiacritics(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return t ? `${t}-${id}` : id
}

// ── XML builders ────────────────────────────────────────────────────────────

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hreflangLinks(loc) {
  const path = loc.startsWith(SITE_BASE) ? loc.slice(SITE_BASE.length) : null
  if (path === null) return []
  const alt = (l) => `${SITE_BASE}${l === 'en' ? '' : '/' + l}${path}`
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

const dayFromEpoch = (sec) => new Date(sec * 1000).toISOString().slice(0, 10)

// ── Backend fetches (resilient — a failure degrades that section, never 500) ──

async function fetchJson(path, pick) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      console.warn(`[sitemap] ${path} responded ${r.status}`)
      return []
    }
    const data = await r.json()
    const arr = pick(data)
    return Array.isArray(arr) ? arr : []
  } catch (err) {
    console.warn(`[sitemap] could not reach ${path}: ${err.message}`)
    return []
  }
}

// ── Entry assembly ────────────────────────────────────────────────────────────

function buildEntries({ channels, venues, categoryPairs, events }) {
  const today = new Date().toISOString().slice(0, 10)

  const entries = [
    urlEntry({ loc: `${SITE_BASE}/`,       lastmod: today, changefreq: 'daily', priority: '1.0' }),
    urlEntry({ loc: `${SITE_BASE}/cities`, lastmod: today, changefreq: 'daily', priority: '0.9' }),
  ]

  // Indexable cities: chat messages OR active events OR seeded venues — the
  // SAME criterion the prerender uses for the city robots tag. Listing a
  // noindex city here would contradict its meta.
  const venueCitySlugs = new Set(
    venues.map(v => (v?.city_name ? cityToSlug(v.city_name) : null)).filter(Boolean),
  )
  const seen = new Set()
  for (const ch of channels) {
    const name = ch?.city
    if (!name || typeof name !== 'string') continue
    const slug = cityToSlug(name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)

    const messageCount = Number(ch?.messageCount) || 0
    const eventCount   = Number(ch?.eventCount)   || 0
    if (!(messageCount > 0 || eventCount > 0 || venueCitySlugs.has(slug))) continue

    const lastmod = Number.isFinite(ch?.lastActivityAt) && ch.lastActivityAt > 0
      ? dayFromEpoch(ch.lastActivityAt)
      : today
    entries.push(urlEntry({ loc: `${SITE_BASE}/city/${slug}`, lastmod, changefreq: 'hourly', priority: '0.8' }))
  }

  // Category × city pages (≥3 combined events+venues, enforced server-side).
  for (const p of categoryPairs) {
    if (!p?.city_slug || !p?.category) continue
    entries.push(urlEntry({ loc: `${SITE_BASE}/city/${p.city_slug}/${p.category}`, lastmod: today, changefreq: 'daily', priority: '0.7' }))
  }

  // Venue pages — one canonical URL per seeded venue.
  for (const v of venues) {
    if (!v?.id || !v?.name) continue
    const created = v.updated_at ? dayFromEpoch(v.updated_at) : today
    const lastmod = created > VENUE_URL_LAUNCH ? created : VENUE_URL_LAUNCH
    entries.push(urlEntry({ loc: `${SITE_BASE}/venue/${venueSlug(v.name, v.id)}`, lastmod, changefreq: 'weekly', priority: '0.6' }))
  }

  // Event pages — non-expired, non-deleted, non-venue (filtered server-side).
  for (const e of events) {
    if (!e?.id || !e?.title) continue
    const lastmod = e.updated_at ? dayFromEpoch(e.updated_at) : today
    entries.push(urlEntry({ loc: `${SITE_BASE}/event/${eventSlug(e.title, e.id)}`, lastmod, changefreq: 'daily', priority: '0.7' }))
  }

  return entries
}

function renderSitemap(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const [channels, venues, categoryPairs, events] = await Promise.all([
    fetchJson('/api/v1/channels',           d => d?.channels),
    fetchJson('/api/v1/sitemap/venues',     d => d?.venues),
    fetchJson('/api/v1/sitemap/categories', d => d?.pairs),
    fetchJson('/api/v1/sitemap/events',     d => d?.events),
  ])

  const entries = buildEntries({ channels, venues, categoryPairs, events })
  const xml = renderSitemap(entries)

  res.statusCode = 200
  res.setHeader('Content-Type',  'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=10800, stale-while-revalidate=86400')
  res.setHeader('x-sitemap-urls', String(entries.length))
  res.end(xml)
}
