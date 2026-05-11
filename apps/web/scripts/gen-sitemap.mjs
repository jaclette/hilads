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

const BASE_URL = (process.env.SITEMAP_BASE_URL || 'https://hilads.live').replace(/\/+$/, '')
const API_URL  = process.env.SITEMAP_API_URL  || 'https://api.hilads.live/api/v1/channels'

// Mirrors apps/web/src/App.jsx cityToSlug(). Keep these in sync.
function cityToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
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

async function main() {
  const channels = await fetchChannels()
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

  // De-duplicate by slug (Cities are unique by name in practice, but the API
  // can briefly return duplicates during DB migrations — defensive).
  const seen = new Set()
  for (const ch of channels) {
    const name = ch?.city
    if (!name || typeof name !== 'string') continue
    const slug = cityToSlug(name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    entries.push(urlEntry({
      loc:        `${BASE_URL}/city/${slug}`,
      lastmod:    today,
      changefreq: 'hourly',     // event lists turn over fast
      priority:   '0.8',
    }))
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n')

  await writeFile(OUT_PATH, xml, 'utf8')
  console.log(`[sitemap] wrote ${entries.length} URL${entries.length === 1 ? '' : 's'} to ${OUT_PATH}`)
}

main().catch(err => {
  console.error('[sitemap] failed:', err)
  process.exit(1)
})
