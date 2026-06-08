/**
 * Vercel serverless function - /cities index page.
 *
 * Standalone server-rendered HTML at https://hilads.live/cities. Lists every
 * active Hilads city with its country flag + activity stats. Each entry links
 * to the city's chat page (/city/<slug>) which boots the SPA.
 *
 * Why a standalone page (not the SPA shell)?
 *   - Pure SEO play: crawlers want a real HTML page with internal links to
 *     345 city URLs. The SPA's homepage renders an empty <div id="root"></div>
 *     until JS executes, which means Googlebot can find city links but
 *     non-JS crawlers (most social bots) cannot.
 *   - This page is for discovery, not interactivity. Tapping a city link
 *     takes the user to the SPA at /city/<slug> where the full chat
 *     experience lives.
 *
 * Cache: 1 h s-maxage + 24 h SWR. The city list shifts slowly (a city is
 * added every few weeks), so aggressive caching is fine.
 */

import { Buffer } from 'node:buffer'

const API_BASE  = process.env.HILADS_API_BASE  || 'https://api.hilads.live'
const SITE_BASE = process.env.HILADS_SITE_BASE || 'https://hilads.live'

// ── Helpers ───────────────────────────────────────────────────────────────────

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cityToSlug(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cityFlag(country) {
  if (!country || country.length !== 2) return ''
  const cc = country.toUpperCase()
  return [...cc].map(c => String.fromCodePoint(0x1F1E6 + (c.charCodeAt(0) - 65))).join('')
}

async function fetchChannels() {
  try {
    const r = await fetch(`${API_BASE}/api/v1/channels`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return []
    const data = await r.json()
    return Array.isArray(data?.channels) ? data.channels : []
  } catch (err) {
    console.warn('[cities-index] could not reach API:', err.message)
    return []
  }
}

function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003C')
}

// ── Page renderer ─────────────────────────────────────────────────────────────

function renderPage(channels) {
  // Sort:
  //   1. Active users (descending) - live cities first
  //   2. Event count (descending)  - cities with upcoming things ahead of dead ones
  //   3. Alphabetical city name    - long tail
  // Without the eventCount tiebreaker, the long tail of cities with 0
  // online users falls back to alphabetical and drowns the active cities
  // when there's no live presence (e.g. weekday afternoons).
  const sorted = [...channels].sort((a, b) => {
    const aA = a.activeUsers ?? 0;
    const bA = b.activeUsers ?? 0;
    if (aA !== bA) return bA - aA
    const aE = a.eventCount ?? 0;
    const bE = b.eventCount ?? 0;
    if (aE !== bE) return bE - aE
    return String(a.city || '').localeCompare(String(b.city || ''))
  })

  const totalCities  = sorted.length
  const totalOnline  = sorted.reduce((s, c) => s + (c.activeUsers ?? 0), 0)
  const totalEvents  = sorted.reduce((s, c) => s + (c.eventCount  ?? 0), 0)

  const cityListItems = sorted.map(ch => {
    const flag    = cityFlag(ch.country)
    const slug    = cityToSlug(ch.city)
    const online  = ch.activeUsers ?? 0
    const events  = ch.eventCount  ?? 0
    const activity = online > 0
      ? `${online} online${events > 0 ? ` · ${events} events` : ''}`
      : (events > 0 ? `${events} events` : 'Quiet right now')
    const className = online === 0 && events === 0 ? 'city city--quiet' : 'city'
    return `<li><a class="${className}" href="/city/${slug}">
      <span class="city__flag" aria-hidden="true">${flag}</span>
      <span class="city__name">${htmlEscape(ch.city)}</span>
      <span class="city__activity">${htmlEscape(activity)}</span>
    </a></li>`
  }).join('')

  const itemList = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type':       'WebPage',
        '@id':         `${SITE_BASE}/cities`,
        name:          'All Hilads cities',
        description:   `See live activity in ${totalCities || '345+'} cities worldwide. Real-time city activity, no sign-up.`,
        url:           `${SITE_BASE}/cities`,
        isPartOf:      { '@type': 'WebSite', name: 'Hilads', url: SITE_BASE },
      },
      {
        '@type':         'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home',   item: `${SITE_BASE}/` },
          { '@type': 'ListItem', position: 2, name: 'Cities', item: `${SITE_BASE}/cities` },
        ],
      },
      ...(sorted.length > 0 ? [{
        '@type':         'ItemList',
        name:            'All Hilads cities',
        numberOfItems:   sorted.length,
        itemListElement: sorted.map((ch, i) => ({
          '@type':  'ListItem',
          position: i + 1,
          url:      `${SITE_BASE}/city/${cityToSlug(ch.city)}`,
          name:     ch.city,
        })),
      }] : []),
    ],
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>All Hilads cities - feel local, anywhere</title>
  <meta name="description" content="See live activity in ${totalCities || '345+'} Hilads cities worldwide. Real-time city activity, no sign-up." />
  <meta name="theme-color" content="#161210" />
  <link rel="canonical" href="${SITE_BASE}/cities" />
  <link rel="icon" type="image/svg+xml" href="/logo/icon.svg" />

  <!-- Open Graph -->
  <meta property="og:type"        content="website" />
  <meta property="og:site_name"   content="Hilads" />
  <meta property="og:url"         content="${SITE_BASE}/cities" />
  <meta property="og:title"       content="All Hilads cities - feel local, anywhere" />
  <meta property="og:description" content="See live activity in ${totalCities || '345+'} cities worldwide. Real-time, no sign-up." />
  <meta property="og:image"       content="${SITE_BASE}/og/og-default.png" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="All Hilads cities - feel local, anywhere" />
  <meta name="twitter:description" content="See live activity in ${totalCities || '345+'} cities worldwide." />
  <meta name="twitter:image"       content="${SITE_BASE}/og/og-default.png" />

  <style>
    :root {
      --bg: #0d0b09; --surface: #161210; --surface2: #1e1812;
      --text: #ede9e5; --muted: #968880; --muted2: #635650;
      --accent: #FF7A3C; --accent2: #C24A38; --accent3: #B87228;
      --green: #3DDC84; --border: #272018;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      background: var(--bg); color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
                   Helvetica, Arial, sans-serif;
      font-size: 16px; line-height: 1.5;
    }
    a { color: inherit; text-decoration: none; }
    img { display: block; max-width: 100%; }
    ul { list-style: none; }

    .container { max-width: 920px; margin: 0 auto; padding: 24px 20px 64px; }

    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .header__brand {
      display: inline-flex; align-items: center; gap: 12px;
      font-size: 17px; font-weight: 700; letter-spacing: -0.2px;
    }
    .header__brand img { width: 36px; height: 36px; border-radius: 9px; }
    .header__cta {
      padding: 9px 18px; border-radius: 999px;
      background: linear-gradient(135deg, var(--accent2), var(--accent3));
      color: #fff; font-size: 14px; font-weight: 700;
      box-shadow: 0 6px 18px rgba(194,74,56,0.32);
      transition: transform 0.12s;
    }
    .header__cta:hover { transform: translateY(-1px); }

    .hero { padding: 56px 0 32px; text-align: center; }
    .hero__title {
      font-size: clamp(32px, 6vw, 48px);
      font-weight: 800; letter-spacing: -1.2px;
      margin-bottom: 16px;
      background: linear-gradient(90deg, var(--accent2), var(--accent3));
      -webkit-background-clip: text; background-clip: text;
      color: transparent;
    }
    .hero__sub {
      color: var(--muted); font-size: 17px;
      max-width: 580px; margin: 0 auto; line-height: 1.55;
    }

    .stats {
      display: flex; justify-content: center; gap: 36px;
      margin: 32px 0 16px;
    }
    .stat { text-align: center; }
    .stat__num { font-size: 28px; font-weight: 800; color: var(--accent); }
    .stat__label {
      font-size: 11px; color: var(--muted2);
      text-transform: uppercase; letter-spacing: 0.6px; margin-top: 2px;
    }

    .section-label {
      font-size: 11px; font-weight: 700; color: var(--muted2);
      text-transform: uppercase; letter-spacing: 1.1px;
      padding: 32px 4px 12px;
    }

    .city-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 8px;
    }
    .city {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      min-height: 56px;
      transition: background 0.12s, border-color 0.12s, transform 0.12s;
    }
    .city:hover {
      background: rgba(194,74,56,0.06);
      border-color: rgba(194,74,56,0.28);
      transform: translateY(-1px);
    }
    .city__flag { font-size: 22px; line-height: 1; flex-shrink: 0; }
    .city__name {
      flex: 1; font-size: 15px; font-weight: 600; color: var(--text);
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .city__activity {
      font-size: 11px; color: var(--green); font-weight: 700;
      flex-shrink: 0; white-space: nowrap;
    }
    .city--quiet .city__activity { color: var(--muted2); }

    .footer {
      padding: 48px 0 0;
      text-align: center; color: var(--muted2); font-size: 13px;
    }
    .footer a {
      color: var(--muted); text-decoration: underline;
      text-underline-offset: 3px;
    }
    .footer a + a { margin-left: 18px; }
    .footer__tagline { margin-top: 16px; color: var(--muted2); font-size: 12px; }

    @media (max-width: 600px) {
      .stats { gap: 22px; }
      .stat__num { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <a class="header__brand" href="/" aria-label="Hilads home">
        <img src="/logo/icon.svg" alt="" width="36" height="36" />
        <span>Hilads</span>
      </a>
      <a class="header__cta" href="/">Open Hilads →</a>
    </header>

    <section class="hero">
      <h1 class="hero__title">All Hilads cities</h1>
      <p class="hero__sub">
        See who's around in ${totalCities || '345+'} cities worldwide.
        Real-time city activity, no sign-up. Tap a city to jump into
        what's happening tonight.
      </p>
    </section>

    ${totalOnline + totalEvents > 0 ? `
    <div class="stats">
      <div class="stat">
        <div class="stat__num">${totalCities}</div>
        <div class="stat__label">Cities live</div>
      </div>
      ${totalOnline > 0 ? `<div class="stat">
        <div class="stat__num">${totalOnline}</div>
        <div class="stat__label">People online</div>
      </div>` : ''}
      ${totalEvents > 0 ? `<div class="stat">
        <div class="stat__num">${totalEvents}</div>
        <div class="stat__label">Events scheduled</div>
      </div>` : ''}
    </div>
    ` : ''}

    <p class="section-label">${totalCities ? `${totalCities} cities · most active first` : 'Cities'}</p>

    <ul class="city-grid">
      ${cityListItems || '<li class="city city--quiet"><span>Loading cities…</span></li>'}
    </ul>

    <footer class="footer">
      <p>
        <a href="/">Hilads home</a>
        <a href="/privacy">Privacy</a>
        <a href="/child-safety">Safety</a>
      </p>
      <p class="footer__tagline">Hilads - feel local, anywhere.</p>
    </footer>
  </div>

  <script type="application/ld+json">${jsonLdSafe(itemList)}</script>
</body>
</html>
`
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const channels = await fetchChannels()
  const html     = renderPage(channels)

  res.statusCode = 200
  res.setHeader('Content-Type',  'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  // Surface for debugging / CDN cache verification.
  res.setHeader('x-prerender',   `cities-index-${channels.length}`)
  res.end(Buffer.from(html, 'utf-8'))
}
