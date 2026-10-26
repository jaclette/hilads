#!/usr/bin/env node
/**
 * gen-sitemap.mjs - deploy-time IndexNow ping.
 *
 * The sitemap itself is served DYNAMICALLY by apps/web/api/sitemap.mjs
 * (rewritten from /sitemap.xml in vercel.json). This script stays in the build
 * step to ping IndexNow (Bing / Yandex / Naver) on each deploy with the same
 * indexable URLs as the sitemap (home, /challenges, the cities that played,
 * the past challenges with enough countries), nudging a re-crawl. Best-effort:
 * it never fails the build.
 *
 *     npm run gen:sitemap
 *
 * Env vars:
 *   SITEMAP_BASE_URL   - site origin (default: https://hilads.live)
 *   INDEXNOW_SUBMIT=1  - force the ping outside Vercel (defaults on when VERCEL=1)
 */

import { fetchChallenges, indexablePages } from '../api/sitemap.mjs'

const BASE_URL = (process.env.SITEMAP_BASE_URL || 'https://hilads.live').replace(/\/+$/, '')

// IndexNow: pings Bing + Yandex + Naver. The key file at /<INDEXNOW_KEY>.txt
// proves domain ownership. Only POSTs when running on Vercel (or with
// INDEXNOW_SUBMIT=1) to avoid hammering the protocol from local dev runs.
const INDEXNOW_KEY    = process.env.INDEXNOW_KEY    || '1964b95cf0dd14f803702bca498c0d89'
const INDEXNOW_SUBMIT = process.env.INDEXNOW_SUBMIT === '1' || process.env.VERCEL === '1'

async function main() {
  if (!INDEXNOW_SUBMIT) {
    console.log('[indexnow] skipped (set INDEXNOW_SUBMIT=1 or run on Vercel)')
    return
  }
  const data = await fetchChallenges()
  if (!data) {
    console.warn('[indexnow] the API is unreachable; skipped')
    return
  }
  // IndexNow accepts up to 10000 URLs per request; slice() is defensive.
  const urls = indexablePages(data).map(p => `${BASE_URL}${p.path}`).slice(0, 10000)

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
