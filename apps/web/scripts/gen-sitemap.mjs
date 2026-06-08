#!/usr/bin/env node
/**
 * gen-sitemap.mjs - deploy-time IndexNow ping.
 *
 * The sitemap itself is no longer generated here. It is served DYNAMICALLY by
 * the serverless function apps/web/api/sitemap.mjs (rewritten from /sitemap.xml
 * in vercel.json), so newly created events/cities appear automatically within
 * the CDN cache TTL - no rebuild required.
 *
 * This script remains in the build step purely to ping IndexNow (Bing / Yandex
 * / Naver) on each deploy with the indexable URL set, nudging a re-crawl. It is
 * best-effort and never fails the build.
 *
 *     npm run gen:sitemap
 *
 * Env vars:
 *   SITEMAP_BASE_URL   - site origin (default: https://hilads.live)
 *   SITEMAP_API_URL    - channels API endpoint
 *   SITEMAP_VENUES_URL - sitemap venues endpoint
 *   SITEMAP_CATS_URL   - sitemap categories endpoint
 *   INDEXNOW_SUBMIT=1  - force the ping outside Vercel (defaults on when VERCEL=1)
 */

const BASE_URL    = (process.env.SITEMAP_BASE_URL || 'https://hilads.live').replace(/\/+$/, '')
const API_URL     = process.env.SITEMAP_API_URL    || 'https://api.hilads.live/api/v1/channels'
const VENUES_URL  = process.env.SITEMAP_VENUES_URL || 'https://api.hilads.live/api/v1/sitemap/venues'
const CATS_URL    = process.env.SITEMAP_CATS_URL   || 'https://api.hilads.live/api/v1/sitemap/categories'

// IndexNow: pings Bing + Yandex + Naver. The key file at /<INDEXNOW_KEY>.txt
// proves domain ownership. Only POSTs when running on Vercel (or with
// INDEXNOW_SUBMIT=1) to avoid hammering the protocol from local dev runs.
const INDEXNOW_KEY    = process.env.INDEXNOW_KEY    || '1964b95cf0dd14f803702bca498c0d89'
const INDEXNOW_SUBMIT = process.env.INDEXNOW_SUBMIT === '1' || process.env.VERCEL === '1'

// Mirrors apps/web/src/App.jsx cityToSlug() and api/sitemap.mjs. Keep in sync.
function cityToSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Mirrors api/sitemap.mjs venueSlug - venue URLs are /venue/<slug>-<id>.
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

async function fetchList(url, pick, label) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      console.warn(`[indexnow] ${label} responded ${res.status}; skipping those URLs`)
      return []
    }
    const data = await res.json()
    const arr = pick(data)
    return Array.isArray(arr) ? arr : []
  } catch (err) {
    console.warn(`[indexnow] could not reach ${label} (${err.message}); skipping those URLs`)
    return []
  }
}

async function main() {
  if (!INDEXNOW_SUBMIT) {
    console.log('[indexnow] skipped (set INDEXNOW_SUBMIT=1 or run on Vercel)')
    return
  }

  const [channels, venues, categoryPairs] = await Promise.all([
    fetchList(API_URL,    d => d?.channels, 'channels'),
    fetchList(VENUES_URL, d => d?.venues,   'venues'),
    fetchList(CATS_URL,   d => d?.pairs,    'categories'),
  ])

  // Same indexable city criterion as the sitemap: chat OR active events OR
  // seeded venues. Don't ping search engines about noindex cities.
  const venueCitySlugs = new Set(
    venues.map(v => (v?.city_name ? cityToSlug(v.city_name) : null)).filter(Boolean),
  )
  const seen = new Set()
  const cityUrls = []
  for (const ch of channels) {
    const name = ch?.city
    if (!name || typeof name !== 'string') continue
    const slug = cityToSlug(name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const messageCount = Number(ch?.messageCount) || 0
    const eventCount   = Number(ch?.eventCount)   || 0
    if (!(messageCount > 0 || eventCount > 0 || venueCitySlugs.has(slug))) continue
    cityUrls.push(`${BASE_URL}/city/${slug}`)
  }

  // IndexNow accepts up to 10000 URLs per request; slice() is defensive.
  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/cities`,
    ...cityUrls,
    ...categoryPairs.map(p => p?.city_slug && p?.category ? `${BASE_URL}/city/${p.city_slug}/${p.category}` : null).filter(Boolean),
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
}

main().catch(err => {
  // Never fail the build on a best-effort ping.
  console.warn('[indexnow] unexpected error (non-fatal):', err?.message)
})
