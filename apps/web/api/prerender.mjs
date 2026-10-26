/**
 * Vercel serverless function - server-rendered SEO pages over the SPA shell.
 *
 * Why this exists
 * ───────────────
 * Hilads is a Vite SPA. Crawlers (Google, WhatsApp, iMessage, Slack...) read
 * the HTML before any JavaScript runs, so this function serves the app shell
 * with the page's own title, description, Open Graph tags, canonical,
 * hreflang, JSON-LD and a crawlable body inside #root. React replaces the body
 * when it mounts; humans see the same page as before.
 *
 * Pages (vercel.json rewrites, each also under a locale prefix /fr, /ja...):
 *   /                          home (the bare English / is the static index.html)
 *   /city/{slug}               today's challenge and how the city answered
 *   /challenges                every past Daily Challenge
 *   /challenge/{date}-{slug}   a past Daily Challenge: each country's top photo and answer
 * Old-concept pages answer 301 to their city page: /event/{id}, /e/{id},
 * /venue/{id}, /challenge/{slug}-{16hex}; /city/{slug}/past and
 * /city/{slug}/{category} redirect in vercel.json. A gone one answers 410.
 *
 * Indexing: a challenge page is indexable from 3 countries, in English only
 * until it reaches 15 countries (then every language, with hreflang). A city
 * page is indexable once the city has played a challenge. Home and the
 * archive: every language.
 *
 * Data: the public API (DailyWeb: players' approved photos only, username and
 * city, never a suggestion or a demo). On any failure the page falls back to
 * the plain shell (404 noindex for a content page) - it never breaks.
 *
 * Caching (CDN): past challenges a day (they're closed), the archive and city
 * pages until the next drop (at most an hour), home an hour.
 */

import { readFile }      from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// SSR translation source - the SAME locale tree the client uses (single source
// of truth; these keys are SSR-only so the client never imports them). esbuild
// (Vercel's function bundler) inlines these JSON imports at build time.
import en_ssr from '../src/i18n/locales/en/ssr.json' with { type: 'json' }
import fr_ssr from '../src/i18n/locales/fr/ssr.json' with { type: 'json' }
import vi_ssr from '../src/i18n/locales/vi/ssr.json' with { type: 'json' }
import es_ssr from '../src/i18n/locales/es/ssr.json' with { type: 'json' }
import it_ssr from '../src/i18n/locales/it/ssr.json' with { type: 'json' }
import ptbr_ssr from '../src/i18n/locales/pt-br/ssr.json' with { type: 'json' }
import ptpt_ssr from '../src/i18n/locales/pt-pt/ssr.json' with { type: 'json' }
import de_ssr from '../src/i18n/locales/de/ssr.json' with { type: 'json' }
import nl_ssr from '../src/i18n/locales/nl/ssr.json' with { type: 'json' }
import zhhans_ssr from '../src/i18n/locales/zh-hans/ssr.json' with { type: 'json' }
import zhhant_ssr from '../src/i18n/locales/zh-hant/ssr.json' with { type: 'json' }
import ja_ssr from '../src/i18n/locales/ja/ssr.json' with { type: 'json' }
import ko_ssr from '../src/i18n/locales/ko/ssr.json' with { type: 'json' }
import fil_ssr from '../src/i18n/locales/fil/ssr.json' with { type: 'json' }
import th_ssr from '../src/i18n/locales/th/ssr.json' with { type: 'json' }
import id_ssr from '../src/i18n/locales/id/ssr.json' with { type: 'json' }
import hi_ssr from '../src/i18n/locales/hi/ssr.json' with { type: 'json' }
import ru_ssr from '../src/i18n/locales/ru/ssr.json' with { type: 'json' }
import ar_ssr from '../src/i18n/locales/ar/ssr.json' with { type: 'json' }

// City names in each language, by city slug (the client's public/citynames).
import fr_cities from '../public/citynames/fr.json' with { type: 'json' }
import vi_cities from '../public/citynames/vi.json' with { type: 'json' }
import es_cities from '../public/citynames/es.json' with { type: 'json' }
import it_cities from '../public/citynames/it.json' with { type: 'json' }
import ptbr_cities from '../public/citynames/pt-br.json' with { type: 'json' }
import ptpt_cities from '../public/citynames/pt-pt.json' with { type: 'json' }
import de_cities from '../public/citynames/de.json' with { type: 'json' }
import nl_cities from '../public/citynames/nl.json' with { type: 'json' }
import zhhans_cities from '../public/citynames/zh-hans.json' with { type: 'json' }
import zhhant_cities from '../public/citynames/zh-hant.json' with { type: 'json' }
import ja_cities from '../public/citynames/ja.json' with { type: 'json' }
import ko_cities from '../public/citynames/ko.json' with { type: 'json' }
import fil_cities from '../public/citynames/fil.json' with { type: 'json' }
import th_cities from '../public/citynames/th.json' with { type: 'json' }
import id_cities from '../public/citynames/id.json' with { type: 'json' }
import hi_cities from '../public/citynames/hi.json' with { type: 'json' }
import ru_cities from '../public/citynames/ru.json' with { type: 'json' }
import ar_cities from '../public/citynames/ar.json' with { type: 'json' }

const SSR_I18N    = { en: en_ssr, fr: fr_ssr, vi: vi_ssr, es: es_ssr, it: it_ssr, 'pt-br': ptbr_ssr, 'pt-pt': ptpt_ssr, de: de_ssr, nl: nl_ssr, 'zh-hans': zhhans_ssr, 'zh-hant': zhhant_ssr, ja: ja_ssr, ko: ko_ssr, fil: fil_ssr, th: th_ssr, id: id_ssr, hi: hi_ssr, ru: ru_ssr, ar: ar_ssr }
const CITY_NAMES  = { fr: fr_cities, vi: vi_cities, es: es_cities, it: it_cities, 'pt-br': ptbr_cities, 'pt-pt': ptpt_cities, de: de_cities, nl: nl_cities, 'zh-hans': zhhans_cities, 'zh-hant': zhhant_cities, ja: ja_cities, ko: ko_cities, fil: fil_cities, th: th_cities, id: id_cities, hi: hi_cities, ru: ru_cities, ar: ar_cities }
const DATE_LOCALE = { en: 'en-US', fr: 'fr-FR', vi: 'vi-VN', es: 'es-ES', it: 'it-IT', 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', de: 'de-DE', nl: 'nl-NL', 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR', fil: 'fil-PH', th: 'th-TH', id: 'id-ID', hi: 'hi-IN', ru: 'ru-RU', ar: 'ar-SA' }
const OG_LOCALE   = { en: 'en_US', fr: 'fr_FR', vi: 'vi_VN', es: 'es_ES', it: 'it_IT', 'pt-br': 'pt_BR', 'pt-pt': 'pt_PT', de: 'de_DE', nl: 'nl_NL', 'zh-hans': 'zh_CN', 'zh-hant': 'zh_TW', ja: 'ja_JP', ko: 'ko_KR', fil: 'fil_PH', th: 'th_TH', id: 'id_ID', hi: 'hi_IN', ru: 'ru_RU', ar: 'ar_SA' }
// Right-to-left locales - emit dir="rtl" on the SSR <html>.
const RTL_LOCALES = ['ar']

// Locale (Option A: un-prefixed = English canonical; /fr, /vi... additive).
const I18N_LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar']

// A challenge page is indexable from INDEX_MIN countries (thinner pages exist
// but stay noindex), in English only until it reaches ALL_LOCALES_MIN countries:
// the answers aren't translated, so below that the 18 other languages are
// near-duplicates Google refuses to index (it did, ~10k URLs, before).
const INDEX_MIN       = 3
const ALL_LOCALES_MIN = 15

// '' for the default (English) locale; '/fr' | '/vi' otherwise. Keeps SSR
// internal links inside the localized cluster.
function localePrefixFor(locale) { return locale === 'en' ? '' : `/${locale}` }

// Translate an SSR string. `key` is a dot-path (e.g. 'daily.title'); params
// fill {placeholders}. Falls back to English on any missing key/locale so a
// lagging translation never blanks a page. Returns raw text (caller escapes).
function T(locale, key, params = {}) {
  const get = (obj) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  const str = get(SSR_I18N[locale]) ?? get(SSR_I18N.en)
  if (typeof str !== 'string') return ''
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
}

/** "1 photo" / "12 photos" (key + 'One' | 'Many'). */
function Tn(locale, key, count) {
  return T(locale, `${key}${count === 1 ? 'One' : 'Many'}`, { count })
}

const API_BASE  = process.env.HILADS_API_BASE || 'https://api.hilads.live'
const SITE_BASE = process.env.HILADS_SITE_BASE || 'https://hilads.live'

const API_TIMEOUT_MS   = 2000
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

// Mirrors apps/web/src/App.jsx cityToSlug() - keep in sync.
function cityToSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// The trailing 16-hex id of an old event / venue / challenge URL.
function extractHex(input) {
  const m = String(input || '').match(/([a-f0-9]{16})$/i)
  return m ? m[1].toLowerCase() : null
}

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A city's name in the page's language (public/citynames), else the API's. */
function cityName(name, locale) {
  return (locale !== 'en' && CITY_NAMES[locale]?.[cityToSlug(name)]) || name
}

/** A country's name in the page's language ("VN" → "Vietnam" / "Viêt Nam"). */
function countryName(cc, locale) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return ''
  try {
    return new Intl.DisplayNames([DATE_LOCALE[locale] || 'en-US'], { type: 'region' }).of(cc.toUpperCase()) || cc
  } catch {
    return cc
  }
}

function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return ''
  return [...cc.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('')
}

/** "October 24, 2026" in the page's language. */
function dateLabel(date, locale) {
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(DATE_LOCALE[locale] || 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  } catch {
    return date
  }
}

/** The challenge's headline: its comparison question, else its text. */
function headline(c) {
  return c.question || c.text
}

function challengePath(c) {
  return `/challenge/${c.date}-${c.slug}`
}

async function fetchJson(url, ms = API_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    // themes=2 / themesRev=3: the current theme keys (old apps get v1 keys).
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'themes=2&themesRev=3', {
      signal: ctrl.signal, headers: { Accept: 'application/json', 'X-Hilads-SSR': '1' },
    })
    const data = res.ok ? await res.json() : null
    return { status: res.status, data }
  } catch (err) {
    console.warn(`[prerender] fetch failed (${url}):`, err.message)
    return { status: 0, data: null }
  } finally {
    clearTimeout(t)
  }
}

/** CDN seconds until the next daily drop, between 1 min and 1 h. */
function untilNextDrop(today) {
  const left = Number.isFinite(today?.nextDropAt) ? today.nextDropAt - Math.floor(Date.now() / 1000) : 3600
  return Math.max(60, Math.min(3600, left))
}

// ── JSON-LD ───────────────────────────────────────────────────────────────────

const ORG_GRAPH_NODE = {
  '@type': 'Organization',
  '@id':   `${SITE_BASE}/#organization`,
  name:    'Hilads',
  url:     `${SITE_BASE}/`,
  logo:    `${SITE_BASE}/logo/icon.svg`,
  slogan:  'Play local. Compare global.',
  description: 'Hilads is the daily photo challenge for travelers and locals: one challenge a day, the same in every city, and every country\'s answers side by side.',
  sameAs: [
    'https://apps.apple.com/app/id6768905591',
    'https://play.google.com/store/apps/details?id=com.hilads.app',
  ],
}

const WEBSITE_GRAPH_NODE = {
  '@type':   'WebSite',
  '@id':     `${SITE_BASE}/#website`,
  name:      'Hilads',
  url:       `${SITE_BASE}/`,
  publisher: { '@id': `${SITE_BASE}/#organization` },
}

function graph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': [ORG_GRAPH_NODE, WEBSITE_GRAPH_NODE, ...nodes.filter(Boolean)] }
}

function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  }
}

// JSON-LD content can include `</script>` in user data - escape that and the
// `<` to keep parsers happy. Standard recipe.
function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003C')
}

// ── Pages ─────────────────────────────────────────────────────────────────────
// Each returns { meta: {title, description, url, image}, jsonLd, body, indexable,
// hreflang (every language advertised), cache (CDN seconds) }.

// Extra styles for the SSR bodies (the base .ssr-main styles are in index.html).
const SSR_STYLES = `<style>
  .ssr-main .ssr-kicker { font-size: .85rem; font-weight: 800; color: #6E5D4E; margin: 0 0 .25rem; }
  .ssr-main .ssr-crumbs { font-size: .85rem; margin: 0 0 .75rem; }
  .ssr-main .ssr-photos { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .ssr-main .ssr-photos li { margin: 0; }
  .ssr-main .ssr-photos figure { margin: 0; }
  .ssr-main .ssr-photos img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 12px; display: block; background: #F3EAE0; }
  .ssr-main .ssr-photos figcaption { font-size: .85rem; color: #6E5D4E; margin-top: .35rem; }
  .ssr-main .ssr-photos figcaption b { color: #241A12; }
  .ssr-main .ssr-cta { display: inline-block; margin: .25rem 0 1rem; padding: .7rem 1.1rem; border-radius: 14px; background: #C24A38; color: #fff !important; }
</style>`

function homePage(locale) {
  const lp = localePrefixFor(locale)
  return {
    meta: {
      title:       T(locale, 'home.title'),
      description: T(locale, 'home.description'),
      url:         `${SITE_BASE}/`,
      image:       `${SITE_BASE}/og/og-default.png`,
    },
    jsonLd: graph(),
    body: [
      SSR_STYLES,
      `<main class="ssr-main">`,
      `<h1>${htmlEscape(T(locale, 'home.h1'))}</h1>`,
      `<p class="ssr-intro">${htmlEscape(T(locale, 'home.intro'))}</p>`,
      `<p><a class="ssr-cta" href="${lp}/today">${htmlEscape(T(locale, 'home.playCta'))}</a></p>`,
      `<section><h2>${htmlEscape(T(locale, 'home.howHeading'))}</h2><p>${htmlEscape(T(locale, 'home.howBody'))}</p></section>`,
      `<p><a href="${lp}/challenges">${htmlEscape(T(locale, 'home.archiveCta'))}</a></p>`,
      `</main>`,
    ].join('\n'),
    indexable: true,
    hreflang:  true,
    canonicalPath: '/',
    cache:     3600,
  }
}

/** A photo's figure: the image, then "🇻🇳 Vietnam: Một, hai, ba, dzô!", its count and "Photo by @linh in Ho Chi Minh City". */
function photoFigure({ photo, country, answer, photos, question, locale }) {
  const place  = country ? `${flagEmoji(country)} ${countryName(country, locale)}` : cityName(photo.city, locale)
  const city   = cityName(photo.city, locale)
  const credit = T(locale, 'daily.photoBy', { user: `@${photo.username}`, city })
  const alt    = [answer || question, credit].filter(Boolean).join(' - ')
  return `<li><figure><img src="${htmlEscape(photo.url)}" alt="${htmlEscape(alt)}" loading="lazy" width="300" height="400" />`
    + `<figcaption><b>${htmlEscape(place)}${answer ? `: ${htmlEscape(answer)}` : ''}</b><br />`
    + `${photos ? `${htmlEscape(Tn(locale, 'daily.photos', photos))} · ` : ''}${htmlEscape(credit)}</figcaption></figure></li>`
}

async function challengePage(id, locale, localePrefix) {
  const m = String(id).match(/^(\d{4}-\d{2}-\d{2})(?:-([a-z0-9-]*))?$/)
  if (!m) return null
  const { data } = await fetchJson(`${API_BASE}/api/v1/daily/web/challenges/${m[1]}?locale=${encodeURIComponent(locale)}`)
  if (!data?.challenge) return null
  const c     = data.challenge
  const path  = challengePath(c)
  // One URL per challenge: a missing or old slug moves to the current one.
  if (m[2] !== c.slug) return { redirect: `${SITE_BASE}${localePrefix}${path}` }

  const lp        = localePrefixFor(locale)
  const nCountry  = data.totals.countries
  const title     = headline(c)
  const answered  = data.countries.filter(r => r.answer)
  const answers   = answered.slice(0, 6).map(r => `${countryName(r.country, locale) || cityName(r.cities[0]?.name, locale)}: ${r.answer}`).join(' · ')
  const places    = [...new Set(data.countries.flatMap(r => r.cities.map(ci => cityName(ci.name, locale))))].slice(0, 6).join(', ')
  const description = answers ? T(locale, 'daily.descAnswers', { answers: answers.replace(/[.!?]?$/, (p) => p || '.') })
    : places ? T(locale, 'daily.descPhotos', { text: c.text, places })
    : T(locale, 'daily.descEmpty', { text: c.text })
  const url = `${SITE_BASE}${lp}${path}`

  const figures = data.countries.map(r => photoFigure({ photo: r.photo, country: r.country, answer: r.answer, photos: r.photos, question: c.question, locale })).join('\n        ')
  const nav = [
    data.prev ? `<a href="${lp}${challengePath(data.prev)}" rel="prev">← ${htmlEscape(T(locale, 'daily.prev'))}: ${htmlEscape(headline(data.prev))}</a>` : null,
    data.next ? `<a href="${lp}${challengePath(data.next)}" rel="next">${htmlEscape(T(locale, 'daily.next'))}: ${htmlEscape(headline(data.next))} →</a>` : null,
  ].filter(Boolean).map(a => `<p>${a}</p>`).join('\n')

  const body = [
    SSR_STYLES,
    `<main class="ssr-main">`,
    `<p class="ssr-crumbs"><a href="${lp}/">Hilads</a> › <a href="${lp}/challenges">${htmlEscape(T(locale, 'daily.archiveLink'))}</a></p>`,
    `<p class="ssr-kicker">${htmlEscape(T(locale, 'daily.kicker', { date: dateLabel(c.date, locale) }))}</p>`,
    `<h1>${htmlEscape(title)}</h1>`,
    c.question ? `<p class="ssr-intro">${htmlEscape(c.text)}</p>` : '',
    c.context ? `<p>${htmlEscape(c.context)}</p>` : '',
    data.totals.photos ? `<p>${htmlEscape(Tn(locale, 'daily.photos', data.totals.photos))} · ${htmlEscape(Tn(locale, 'daily.countries', nCountry))}</p>` : '',
    `<section><h2>${htmlEscape(T(locale, 'daily.answersHeading'))}</h2>`,
    figures ? `<ul class="ssr-photos">\n        ${figures}\n      </ul>` : `<p>${htmlEscape(T(locale, 'daily.noPhotos'))}</p>`,
    `</section>`,
    nav,
    `<section><h2>${htmlEscape(T(locale, 'daily.playCta'))}</h2><p>${htmlEscape(T(locale, 'daily.playSub'))}</p><p><a class="ssr-cta" href="${lp}/today">${htmlEscape(T(locale, 'daily.playCta'))}</a></p></section>`,
    `</main>`,
  ].join('\n')

  // How the world answered: one image per country (its top photo).
  const list = data.countries.length ? {
    '@type': 'ItemList',
    name: `${title} - ${T(locale, 'daily.answersHeading')}`,
    numberOfItems: data.countries.length,
    itemListElement: data.countries.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'ImageObject',
        contentUrl:   r.photo.url,
        thumbnailUrl: r.photo.thumbUrl,
        name:         [countryName(r.country, locale), r.answer].filter(Boolean).join(': ') || title,
        caption:      T(locale, 'daily.photoBy', { user: `@${r.photo.username}`, city: cityName(r.photo.city, locale) }),
        creator:      { '@type': 'Person', name: r.photo.username },
        creditText:   `@${r.photo.username} on Hilads`,
        contentLocation: { '@type': 'Place', name: [r.photo.city, countryName(r.country, 'en')].filter(Boolean).join(', ') },
        datePublished: c.date,
      },
    })),
  } : null

  return {
    meta: {
      title: nCountry > 0
        ? T(locale, 'daily.title', { question: title, countries: Tn(locale, 'daily.countries', nCountry) })
        : T(locale, 'daily.titleNone', { question: title }),
      description,
      url: `${SITE_BASE}${path}`,
      // The countries' top photos side by side; the static mosaic until a photo exists.
      image: data.totals.photos > 0 ? `${SITE_BASE}/api/og?type=challenge&date=${c.date}` : `${SITE_BASE}/og/og-default.png`,
    },
    jsonLd: graph(
      breadcrumb([
        { name: 'Hilads', url: `${SITE_BASE}${lp}/` },
        { name: T(locale, 'daily.archiveLink'), url: `${SITE_BASE}${lp}/challenges` },
        { name: title, url },
      ]),
      list,
    ),
    body,
    indexable: nCountry >= INDEX_MIN && (locale === 'en' || nCountry >= ALL_LOCALES_MIN),
    hreflang:  nCountry >= ALL_LOCALES_MIN,
    canonicalPath: path,
    cache: 86400,
  }
}

async function archivePage(locale) {
  const { data } = await fetchJson(`${API_BASE}/api/v1/daily/web/challenges?locale=${encodeURIComponent(locale)}`)
  if (!Array.isArray(data?.items)) return null
  const lp    = localePrefixFor(locale)
  const items = data.items.map(c => {
    const stats = c.photos ? ` - ${Tn(locale, 'daily.photos', c.photos)} · ${Tn(locale, 'daily.countries', c.countries)}` : ''
    return `<li><a href="${lp}${challengePath(c)}">${htmlEscape(headline(c))}</a> <small>${htmlEscape(dateLabel(c.date, locale))}${htmlEscape(stats)}</small></li>`
  }).join('\n        ')
  const url = `${SITE_BASE}${lp}/challenges`
  return {
    meta: {
      title:       T(locale, 'daily.archiveTitle'),
      description: T(locale, 'daily.archiveDescription'),
      url:         `${SITE_BASE}/challenges`,
      image:       `${SITE_BASE}/og/og-default.png`,
    },
    jsonLd: graph(
      breadcrumb([{ name: 'Hilads', url: `${SITE_BASE}${lp}/` }, { name: T(locale, 'daily.archiveLink'), url }]),
      data.items.length ? {
        '@type': 'ItemList',
        name: T(locale, 'daily.archiveH1'),
        numberOfItems: data.items.length,
        itemListElement: data.items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_BASE}${lp}${challengePath(c)}`, name: headline(c) })),
      } : null,
    ),
    body: [
      SSR_STYLES,
      `<main class="ssr-main">`,
      `<p class="ssr-crumbs"><a href="${lp}/">Hilads</a></p>`,
      `<h1>${htmlEscape(T(locale, 'daily.archiveH1'))}</h1>`,
      `<p class="ssr-intro">${htmlEscape(T(locale, 'daily.archiveIntro'))}</p>`,
      `<p><a class="ssr-cta" href="${lp}/today">${htmlEscape(T(locale, 'daily.playCta'))}</a></p>`,
      items ? `<ul>\n        ${items}\n      </ul>` : '',
      `</main>`,
    ].join('\n'),
    indexable: true,
    hreflang:  true,
    canonicalPath: '/challenges',
    cache: 3600,
  }
}

async function cityPage(slug, locale) {
  const { data: city } = await fetchJson(`${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`)
  if (!city?.city || !city.channelId) return null
  const [{ data: today }, { data: recentData }] = await Promise.all([
    fetchJson(`${API_BASE}/api/v1/daily/today?locale=${encodeURIComponent(locale)}`),
    fetchJson(`${API_BASE}/api/v1/daily/web/cities/${encodeURIComponent(city.channelId)}?locale=${encodeURIComponent(locale)}`),
  ])
  const lp       = localePrefixFor(locale)
  const name     = cityName(city.city, locale)
  const c        = today?.challenge?.text ? today.challenge : null
  const question = c ? (c.compare?.question || c.text) : null
  const recent   = Array.isArray(recentData?.recent) ? recentData.recent : []

  const figures = recent.map(r => photoFigure({ photo: r.photo, country: null, answer: r.answer, photos: r.photos, question: headline(r), locale })
    .replace('<figcaption>', `<figcaption><a href="${lp}${challengePath(r)}">${htmlEscape(headline(r))}</a><br />`)).join('\n        ')

  return {
    meta: {
      title:       question ? T(locale, 'city.title', { city: name, question }) : T(locale, 'city.titleNoChallenge', { city: name }),
      description: question ? T(locale, 'city.description', { city: name, question }) : T(locale, 'city.descriptionNoChallenge', { city: name }),
      url:         `${SITE_BASE}/city/${slug}`,
      image:       `${SITE_BASE}/og/og-default.png`,
    },
    jsonLd: graph(breadcrumb([
      { name: 'Hilads', url: `${SITE_BASE}${lp}/` },
      { name, url: `${SITE_BASE}${lp}/city/${slug}` },
    ])),
    body: [
      SSR_STYLES,
      `<main class="ssr-main">`,
      `<h1>${htmlEscape(`${flagEmoji(city.country)} ${T(locale, 'city.h1', { city: name })}`.trim())}</h1>`,
      c ? `<section><h2>${htmlEscape(T(locale, 'city.todayHeading'))}</h2><p class="ssr-intro"><b>${htmlEscape(question)}</b></p>${c.compare?.question ? `<p>${htmlEscape(c.text)}</p>` : ''}</section>` : '',
      `<p><a class="ssr-cta" href="${lp}/today">${htmlEscape(T(locale, 'city.playCta', { city: name }))}</a></p>`,
      `<section><h2>${htmlEscape(T(locale, 'city.recentHeading', { city: name }))}</h2>`,
      figures ? `<ul class="ssr-photos">\n        ${figures}\n      </ul>` : `<p>${htmlEscape(T(locale, 'city.recentEmpty', { city: name }))}</p>`,
      `</section>`,
      `<p><a href="${lp}/challenges">${htmlEscape(T(locale, 'city.archiveLink'))}</a></p>`,
      `</main>`,
    ].join('\n'),
    // A city that never played is a thin page: it stays out of the index (and the sitemap).
    indexable: recent.length > 0,
    hreflang:  recent.length > 0,
    canonicalPath: `/city/${slug}`,
    cache: untilNextDrop(today),
  }
}

/**
 * An old-concept URL (event, venue, 1-to-1 challenge): 301 to its city page,
 * else 410 Gone so Google drops it.
 */
async function oldPage(type, id, localePrefix) {
  const hex = extractHex(id)
  if (!hex) return { gone: true }
  if (type === 'venue') {
    const { data } = await fetchJson(`${API_BASE}/api/v1/venues/${hex}`)
    const slug = data?.venue?.city?.slug
    return slug ? { redirect: `${SITE_BASE}${localePrefix}/city/${slug}` } : { gone: true }
  }
  const { data } = await fetchJson(`${API_BASE}/api/v1/${type === 'challenge' ? 'challenges' : 'events'}/${hex}`)
  const slug = data?.cityName ? cityToSlug(data.cityName) : null
  if (slug) return { redirect: `${SITE_BASE}${localePrefix}/city/${slug}` }
  // A cross-city challenge with no origin city: the new challenges.
  if (type === 'challenge' && data?.challenge) return { redirect: `${SITE_BASE}${localePrefix}/challenges` }
  return { gone: true }
}

// ── HTML transformation ──────────────────────────────────────────────────────
// Targeted regex per tag - never DOM-parses. If a tag doesn't match (e.g. the
// shell template changed), that tag is left untouched.

// Inject a JSON-LD script just before </head>, replacing the one baked into
// the shell (the bare-/ home's Organization + WebSite).
function injectJsonLd(shell, jsonLd) {
  if (!jsonLd) return shell
  const stripped = shell.replace(
    /[ \t]*<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi,
    '',
  )
  const tag = `<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>\n  </head>`
  return stripped.replace(/<\/head>/i, tag)
}

// The shell has no robots tag: insert one.
function injectRobotsNoindex(shell) {
  return shell.replace(
    /<\/head>/i,
    '<meta name="robots" content="noindex" />\n  </head>',
  )
}

// Replace the shell's SSR <main> (the bare-/ home's) with the page's body.
// React's createRoot().render() replaces #root's children on mount; Googlebot
// indexes this as the page's content.
function injectBody(shell, body) {
  if (!body) return shell
  if (/<main class="ssr-main"/i.test(shell)) {
    return shell.replace(/[ \t]*<main class="ssr-main"[\s\S]*?<\/main>\s*/i, () => `${body}\n      `)
  }
  return shell.replace(/<div id="root">/i, () => `<div id="root">\n      ${body}`)
}

function injectMeta(shell, meta, locale = 'en') {
  const t   = htmlEscape(meta.title)
  const d   = htmlEscape(meta.description)
  const u   = htmlEscape(meta.url)
  const img = meta.image ? htmlEscape(meta.image) : null
  const set = (re, tag) => (html) => html.replace(re, () => tag)

  let out = [
    set(/<title>[^<]*<\/title>/i, `<title>${t}</title>`),
    set(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${d}" />`),
    set(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${t}" />`),
    set(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${d}" />`),
    set(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${u}" />`),
    set(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${t}" />`),
    set(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${d}" />`),
    set(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${u}" />`),
    // og:locale must match the page language (the shell ships en_US).
    set(/<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:locale" content="${OG_LOCALE[locale] || 'en_US'}" />`),
    set(/<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image:alt" content="${t}" />`),
    set(/<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:image:alt" content="${t}" />`),
  ].reduce((html, f) => f(html), shell)

  if (img) {
    // Both og:image variants (regular + secure_url) and twitter:image.
    out = [
      set(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${img}" />`),
      set(/<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image:secure_url" content="${img}" />`),
      set(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${img}" />`),
    ].reduce((html, f) => f(html), out)
  }
  return out
}

function setHtmlLang(shell, locale) {
  const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'
  return shell.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}" dir="${dir}"`)
}

// Replace the shell's hreflang block. basePath is the un-prefixed path (e.g.
// /city/paris); with all=false the page lists none (an English-only page).
function injectHreflang(shell, basePath, all) {
  const stripped = shell.replace(
    /[ \t]*<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>\s*/gi,
    '',
  )
  if (!all) return stripped
  const alt = (loc) => `${SITE_BASE}${loc === 'en' ? '' : '/' + loc}${basePath === '/' && loc !== 'en' ? '/' : basePath}`
  const links = [
    ...I18N_LOCALES.map((loc) => `<link rel="alternate" hreflang="${loc}" href="${alt(loc)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${alt('en')}" />`,
  ].join('\n  ')
  return stripped.replace(/<\/head>/i, `${links}\n  </head>`)
}

function send(res, status, headers, body = '') {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(body)
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const shell = await getShell(req)
  if (!shell) {
    // Both fs and HTTP failed: enough context to diagnose (function logs have the rest).
    send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8', 'x-prerender-error': 'shell-unavailable' },
      `prerender: shell unavailable\nfs candidates tried: ${fsCandidatePaths().join(' | ')}\n`)
    return
  }

  const { type, id, slug } = req.query || {}
  // Locale from the rewrite (?locale=fr); default English. The prefix goes on
  // the canonical and on every 301 Location below.
  const rawLocale = (req.query || {}).locale
  const locale = I18N_LOCALES.includes(rawLocale) ? rawLocale : 'en'
  const localePrefix = locale === 'en' ? '' : `/${locale}`

  let page = null
  try {
    if (type === 'home') {
      page = homePage(locale)
    } else if (type === 'archive') {
      page = await archivePage(locale)
    } else if (type === 'city' && typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      page = await cityPage(slug, locale)
    } else if (type === 'challenge' && typeof id === 'string' && /^\d{4}-\d{2}-\d{2}/.test(id)) {
      page = await challengePage(id, locale, localePrefix)
    } else if (['event', 'venue', 'challenge'].includes(type) && typeof id === 'string') {
      page = await oldPage(type, id, localePrefix)
    }
  } catch (err) {
    console.error('[prerender] page failed:', err)
    page = null
  }

  if (page?.redirect) {
    send(res, 301, { Location: page.redirect, 'Cache-Control': 'public, max-age=3600' })
    return
  }
  if (page?.gone) {
    send(res, 410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'x-prerender': `${type}-gone` },
      '<!doctype html><title>Hilads</title><meta name="robots" content="noindex" /><p>This page no longer exists. <a href="/">Play today\'s challenge on Hilads</a>.</p>')
    return
  }

  let html = setHtmlLang(shell, locale)

  // No page: no such record (or the API failed). A real 404 + noindex shell,
  // never a 200 generic shell (a soft 404). Short cache: it may be a blip.
  if (!page) {
    send(res, 404, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60',
      'x-prerender': `${type ?? 'none'}-404`, ...(shellSource ? { 'x-prerender-shell': shellSource } : {}),
    }, injectRobotsNoindex(html))
    return
  }

  // Self-referential canonical per locale (Option A). EN keeps the bare URL.
  const meta = localePrefix ? { ...page.meta, url: `${SITE_BASE}${localePrefix}${page.canonicalPath}` } : page.meta
  html = injectMeta(html, meta, locale)
  html = injectHreflang(html, page.canonicalPath, page.hreflang)
  if (!page.indexable) html = injectRobotsNoindex(html)
  html = injectJsonLd(html, page.jsonLd)
  html = injectBody(html, page.body)

  send(res, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    // stale-while-revalidate: crawlers and people never wait on a cold miss.
    'Cache-Control': `public, s-maxage=${page.cache}, stale-while-revalidate=86400`,
    'x-prerender': `${type}-hit`,
    ...(shellSource ? { 'x-prerender-shell': shellSource } : {}),
  }, html)
}
