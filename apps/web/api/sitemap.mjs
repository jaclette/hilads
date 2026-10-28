/**
 * Vercel serverless function - dynamic /sitemap.xml.
 *
 * Generated on request from the public API (vercel.json rewrites /sitemap.xml
 * here; a static public/sitemap.xml would shadow it, so there is none).
 *
 * Contents - exactly the indexable pages (prerender.mjs decides the robots tag
 * with the same rules; a noindex page listed here would contradict it):
 *   - home and /challenges, every language
 *   - the city pages of the cities that played a Daily Challenge, every language
 *   - past Daily Challenges with 3 countries or more: the English page only,
 *     every language from 15 countries
 * Old-concept pages (venues, events, 1-to-1 challenges, city categories and
 * "past" pages) redirect to their city page and are never listed.
 *
 * Each entry's <loc> is the un-prefixed English URL; pages in every language
 * list their 19 alternates + x-default as <xhtml:link>.
 *
 * Cache: s-maxage 3 h + 24 h stale-while-revalidate. Crawlers get the CDN copy;
 * the API is read on a miss only.
 */

const API_BASE  = process.env.HILADS_API_BASE  || 'https://api.hilads.live'
const SITE_BASE = (process.env.HILADS_SITE_BASE || 'https://hilads.live').replace(/\/+$/, '')

const SITEMAP_LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar']

// Mirrors prerender.mjs INDEX_MIN / ALL_LOCALES_MIN - keep in sync.
const INDEX_MIN       = 3
const ALL_LOCALES_MIN = 15

// Mirrors App.jsx / prerender.mjs cityToSlug - keep in sync.
function cityToSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hreflangLinks(path) {
  const alt = (l) => `${SITE_BASE}${l === 'en' ? '' : '/' + l}${path === '/' && l !== 'en' ? '/' : path}`
  return [
    ...SITEMAP_LOCALES.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(alt(l))}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(alt('en'))}"/>`,
  ]
}

function urlEntry({ path, lastmod, changefreq, priority, alternates }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(SITE_BASE + path)}</loc>`,
    ...(alternates ? hreflangLinks(path) : []),
    lastmod    ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority   ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n')
}

/** The day after a challenge date: when its page last changed (it closes then). */
function dayAfter(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
}

/** The indexable pages: [{path, lastmod, changefreq, priority, alternates}]. Also the IndexNow ping's list (scripts/gen-sitemap.mjs). */
export function indexablePages({ items, cities }) {
  const today  = new Date().toISOString().slice(0, 10)
  const latest = items[0] ? dayAfter(items[0].date) : today
  const pages = [
    { path: '/',           lastmod: today,  changefreq: 'daily', priority: '1.0', alternates: true },
    { path: '/challenges', lastmod: latest, changefreq: 'daily', priority: '0.9', alternates: true },
  ]

  const seen = new Set()
  for (const c of cities) {
    const slug = cityToSlug(c?.name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    pages.push({ path: `/city/${slug}`, lastmod: today, changefreq: 'daily', priority: '0.8', alternates: true })
  }

  for (const c of items) {
    if (!c?.date || !c?.slug || !(c.countries >= INDEX_MIN)) continue
    pages.push({
      path: `/challenge/${c.date}-${c.slug}`, lastmod: dayAfter(c.date), changefreq: 'weekly', priority: '0.7',
      alternates: c.countries >= ALL_LOCALES_MIN,
    })
  }
  return pages
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

export async function fetchChallenges() {
  try {
    const r = await fetch(`${API_BASE}/api/v1/daily/web/challenges?locale=en&themes=2&themesRev=4`, { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      console.warn(`[sitemap] /daily/web/challenges responded ${r.status}`)
      return null
    }
    const d = await r.json()
    return Array.isArray(d?.items) && Array.isArray(d?.cities) ? d : null
  } catch (err) {
    console.warn(`[sitemap] could not reach the API: ${err.message}`)
    return null
  }
}

export default async function handler(req, res) {
  const data = await fetchChallenges()
  const entries = indexablePages(data ?? { items: [], cities: [] }).map(urlEntry)

  res.statusCode = 200
  res.setHeader('Content-Type',  'application/xml; charset=utf-8')
  // The API down: a short cache, so a home-only sitemap doesn't stick for hours.
  res.setHeader('Cache-Control', data ? 'public, s-maxage=10800, stale-while-revalidate=86400' : 'public, s-maxage=300')
  res.setHeader('x-sitemap-urls', String(entries.length))
  res.end(renderSitemap(entries))
}
