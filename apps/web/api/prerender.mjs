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

// SSR translation source — the SAME locale tree the client uses (single source
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

const SSR_I18N    = { en: en_ssr, fr: fr_ssr, vi: vi_ssr, es: es_ssr, it: it_ssr, 'pt-br': ptbr_ssr, 'pt-pt': ptpt_ssr, de: de_ssr, nl: nl_ssr, 'zh-hans': zhhans_ssr, 'zh-hant': zhhant_ssr, ja: ja_ssr, ko: ko_ssr, fil: fil_ssr }
const DATE_LOCALE = { en: 'en-US', fr: 'fr-FR', vi: 'vi-VN', es: 'es-ES', it: 'it-IT', 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', de: 'de-DE', nl: 'nl-NL', 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR', fil: 'fil-PH' }
const OG_LOCALE   = { en: 'en_US', fr: 'fr_FR', vi: 'vi_VN', es: 'es_ES', it: 'it_IT', 'pt-br': 'pt_BR', 'pt-pt': 'pt_PT', de: 'de_DE', nl: 'nl_NL', 'zh-hans': 'zh_CN', 'zh-hant': 'zh_TW', ja: 'ja_JP', ko: 'ko_KR', fil: 'fil_PH' }

// '' for the default (English) locale; '/fr' | '/vi' otherwise. Used to keep SSR
// internal links inside the localized cluster (mirrors the redirect/canonical prefixing).
function localePrefixFor(locale) { return locale === 'en' ? '' : `/${locale}` }

// Localized category label by slug. EN keeps the backend-supplied label (canonical,
// no regression); non-EN uses the ssr.json label, falling back to the backend label.
const CAT_KEY = { coffee: 'catCoffee', drinks: 'catDrinks', music: 'catMusic', food: 'catFood', meetup: 'catMeetup', party: 'catParty' }
function catLabel(locale, slug, fallback) {
  if (locale === 'en') return fallback
  const k = CAT_KEY[slug]
  return k ? T(locale, `city.${k}`) : fallback
}

// Translate an SSR string. `key` is a dot-path (e.g. 'event.labelWhen'); params
// fill {placeholders}. Falls back to English on any missing key/locale so a
// lagging translation never blanks a page. Returns raw text (caller escapes).
function T(locale, key, params = {}) {
  const get = (obj) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  const str = get(SSR_I18N[locale]) ?? get(SSR_I18N.en)
  if (typeof str !== 'string') return ''
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
}

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

function formatTime(unixTs, timezone, locale = 'en') {
  return new Date(unixTs * 1000).toLocaleTimeString(DATE_LOCALE[locale] || 'en-US', {
    timeZone: timezone || 'UTC',
    hour:     'numeric',
    minute:   '2-digit',
    // Omit hour12 so each locale uses its own convention (en → 12h, fr/vi → 24h).
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

// Status-aware variant — returns { status, data }. Used by the event branch
// so it can pass through a 410 (moderated/removed event) to the crawler
// instead of silently serving the generic shell as a soft-404.
async function fetchWithStatus(url, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    const data = res.ok ? await res.json() : null
    return { status: res.status, data }
  } catch (err) {
    console.warn(`[prerender] fetch failed (${url}):`, err.message)
    return { status: 0, data: null }
  } finally {
    clearTimeout(t)
  }
}

// ── Per-surface metadata composers ────────────────────────────────────────────

// Format a past event date as "Friday, May 15, 2026" in the city's timezone.
function formatPastDate(unixTs, timezone, locale = 'en') {
  return new Date(unixTs * 1000).toLocaleDateString(DATE_LOCALE[locale] || 'en-US', {
    timeZone: timezone || 'UTC',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

function composeEventMeta(payload, canonicalPath, eventId, locale = 'en') {
  // Backend shape: { event, cityName, country, timezone }
  const ev = payload?.event
  if (!ev || !ev.title) return null

  const where = ev.location ? T(locale, 'event.atFrag', { location: ev.location }) : ''

  let title, description
  if (ev.is_past) {
    // Past-event framing: honest, no "join now" CTA. Still indexable — past
    // events carry SEO content mass and answer "did X happen" queries.
    const whenDate = ev.starts_at ? formatPastDate(ev.starts_at, payload.timezone, locale) : ''
    const when     = whenDate ? T(locale, 'event.happenedOnFrag', { date: whenDate }) : ''
    const attended = (ev.participant_count ?? 0) > 0 ? T(locale, 'event.attendedFrag', { count: ev.participant_count }) : ''
    const city     = payload.cityName || T(locale, 'event.cityFallback')
    title       = payload.cityName
      ? T(locale, 'event.titlePastCity', { title: ev.title, city: payload.cityName })
      : T(locale, 'event.titlePast', { title: ev.title })
    description = T(locale, 'event.descPast', { title: ev.title, where, when, attended, city })
  } else {
    const time  = ev.starts_at ? T(locale, 'event.timeFrag', { time: formatTime(ev.starts_at, payload.timezone, locale) }) : ''
    const going = (ev.participant_count ?? 0) > 0 ? T(locale, 'event.goingFrag', { count: ev.participant_count }) : ''
    title       = payload.cityName
      ? T(locale, 'event.titleCity', { title: ev.title, city: payload.cityName })
      : ev.title
    description = T(locale, 'event.descUpcoming', { title: ev.title, where, time, going })
  }

  return {
    title,
    description,
    url:         `${SITE_BASE}${canonicalPath}`,
    // Per-event dynamic OG card generated by /api/og (M3). Crawlers fetch
    // this directly when rendering link previews; cached at the CDN.
    image:       `${SITE_BASE}/api/og?type=event&id=${encodeURIComponent(eventId)}`,
  }
}

// Category × city meta — adapts to actual bucket size (events + venues).
function composeCategoryMeta(payload, canonicalPath, locale = 'en') {
  if (!payload?.city?.name || !payload?.category?.label) return null
  const city  = payload.city.name
  const slug  = payload.category.slug
  const label = catLabel(locale, slug, payload.category.label)
  const labelCap = label[0].toUpperCase() + label.slice(1)
  const evN   = payload.total_events ?? 0
  const venN  = payload.total_venues ?? 0
  const total = evN + venN

  let title, description
  if (total >= 10) {
    title       = T(locale, 'category.titleCount', { label: labelCap, city, total })
    description = T(locale, 'category.descMany', { total, label, city })
  } else if (total >= 3) {
    title       = T(locale, 'category.title', { label: labelCap, city })
    description = evN > 0
      ? T(locale, 'category.descSomeUpcoming', { label, city, count: evN })
      : T(locale, 'category.descSomeBrowse', { label, city })
  } else {
    title       = T(locale, 'category.title', { label: labelCap, city })
    description = T(locale, 'category.descFew', { label, city })
  }

  return {
    title,
    description,
    url:   `${SITE_BASE}${canonicalPath}`,
    // Reuse the city OG card. Future: dedicated /api/og?type=category card.
    image: `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(payload.city.slug ?? slug)}`,
  }
}

function composeCategoryJsonLd(payload, canonicalUrl) {
  if (!payload?.city?.name) return null
  const events = Array.isArray(payload.events) ? payload.events : []
  const venues = Array.isArray(payload.venues) ? payload.venues : []
  const items  = []

  // Events first (real activity), venues second. Cap at 20 total.
  for (const e of events.slice(0, 20)) {
    items.push({ type: 'event', name: e.title, url: `${SITE_BASE}/event/${eventSlug(e)}` })
  }
  for (const v of venues.slice(0, 20 - items.length)) {
    items.push({ type: 'venue', name: v.name, url: `${SITE_BASE}/venue/${venueSlugFromName(v.name, v.id)}` })
  }

  const itemList = {
    '@type':         'ItemList',
    name:            `${payload.category.label} in ${payload.city.name}`,
    numberOfItems:   items.length,
    itemListElement: items.map((it, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      url:       it.url,
      name:      it.name,
    })),
  }

  const breadcrumb = composeBreadcrumb([
    { name: 'Home',                       url: `${SITE_BASE}/` },
    { name: payload.city.name,            url: `${SITE_BASE}/city/${payload.city.slug}` },
    { name: payload.category.label,       url: canonicalUrl },
  ])

  return {
    '@context': 'https://schema.org',
    '@graph': [...siteGraphNodes(), itemList, breadcrumb],
  }
}

function composeCategoryBody(payload, locale = 'en') {
  const lp       = localePrefixFor(locale)
  const city     = payload.city.name
  const citySlug = payload.city.slug
  const category = payload.category
  const label    = catLabel(locale, category.slug, category.label)
  const labelCap = label[0].toUpperCase() + label.slice(1)
  const events   = Array.isArray(payload.events) ? payload.events : []
  const venues   = Array.isArray(payload.venues) ? payload.venues : []

  const breadcrumb = `<nav class="ssr-breadcrumb"><a href="${lp}/">${T(locale, 'brand')}</a> › <a href="${lp}/city/${citySlug}">${htmlEscape(city)}</a> › <span>${htmlEscape(label)}</span></nav>`

  let intro
  if (events.length > 0 || venues.length > 0) {
    const bits = []
    if (events.length > 0) {
      const evLabel = (events.length === 1 && locale === 'en') ? label.replace(/s$/, '') : label
      bits.push(T(locale, 'category.introEvents', { count: events.length, label: evLabel }))
    }
    if (venues.length > 0) {
      bits.push(venues.length === 1 ? T(locale, 'category.introVenuesOne') : T(locale, 'category.introVenuesMany', { count: venues.length }))
    }
    intro = bits.join(T(locale, 'category.introJoiner')) + T(locale, 'category.introSuffix', { city })
  } else {
    intro = T(locale, 'category.introBrowse', { label, city })
  }

  const eventsSection = events.length > 0
    ? `<section><h2>${T(locale, 'category.upcomingHeading', { label: htmlEscape(label), city: htmlEscape(city) })}</h2><ul>${events.slice(0, 20).map(e => {
        const slug = eventSlug(e)
        const t = e.starts_at ? formatTime(e.starts_at, payload.city.timezone, locale) : ''
        const w = e.location ? ` · ${htmlEscape(e.location)}` : ''
        return `<li><a href="${lp}/event/${slug}">${htmlEscape(e.title)}</a>${t ? ` — ${htmlEscape(t)}` : ''}${w}</li>`
      }).join('')}</ul></section>`
    : ''

  const venuesHeading = category.slug === 'coffee'
    ? T(locale, 'category.venuesHeadingCoffee', { city: htmlEscape(city) })
    : category.slug === 'drinks'
      ? T(locale, 'category.venuesHeadingBars', { city: htmlEscape(city) })
      : T(locale, 'category.venuesHeadingGeneric', { city: htmlEscape(city) })
  const venuesSection = venues.length > 0
    ? `<section><h2>${venuesHeading}</h2><ul>${venues.slice(0, 20).map(v => {
        const slug = venueSlugFromName(v.name, v.id)
        const icon = v.category === 'bar' ? '🍻' : '☕'
        const a    = v.address ? ` — ${htmlEscape(v.address)}` : ''
        return `<li>${icon} <a href="${lp}/venue/${slug}">${htmlEscape(v.name)}</a>${a}</li>`
      }).join('')}</ul></section>`
    : ''

  const evergreen = `<section><h2>${T(locale, 'common.aboutHiladsInHeading', { city: htmlEscape(city) })}</h2><p>${T(locale, 'category.aboutBody', { label: htmlEscape(label), city: htmlEscape(city) })}</p><p>${T(locale, 'common.seeOnHilads', { link: `<a href="${lp}/city/${citySlug}">${T(locale, 'category.everythingElseLink', { city: htmlEscape(city) })}</a>` })}</p></section>`

  return [
    `<style>${SSR_CITY_STYLES} .ssr-breadcrumb { font-size: 0.9rem; opacity: 0.7; margin-bottom: 0.5rem; }</style>`,
    `<main class="ssr-main">`,
    breadcrumb,
    `<h1>${htmlEscape(T(locale, 'category.title', { label: labelCap, city }))}</h1>`,
    `<p class="ssr-intro">${htmlEscape(intro)}</p>`,
    eventsSection,
    venuesSection,
    evergreen,
    `</main>`,
  ].filter(Boolean).join('\n')
}

// ── Past archive (per-city) ───────────────────────────────────────────────────
// Server-rendered index of finished one-off hangouts + expired pulses for a
// city. Indexable ONLY when there's real content — empty archives are noindex
// so we never publish thin pages. Past hangouts link to their existing
// /event/<slug> pages (which stay indexable); pulses have no detail page so
// they're listed as plain text for content mass.

function composePastMeta(payload, canonicalPath, citySlug, itemCount, locale = 'en') {
  if (!payload?.city) return null
  const city  = payload.city
  const title = T(locale, 'past.title', { city })
  const description = itemCount > 0
    ? T(locale, 'past.descItems', { city })
    : T(locale, 'past.descEmpty', { city })
  return {
    title,
    description,
    url:     `${SITE_BASE}${canonicalPath}`,
    image:   `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(citySlug)}`,
    noindex: itemCount === 0,   // no thin archive pages
  }
}

function composePastJsonLd(payload, items, citySlug, canonicalUrl) {
  if (!payload?.city) return null
  const events    = items.filter(it => it.kind === 'event')
  const listItems = events.slice(0, 20).map((e, i) => ({
    '@type':  'ListItem',
    position: i + 1,
    url:      `${SITE_BASE}/event/${eventSlug(e)}`,
    name:     e.title,
  }))
  const itemList = {
    '@type':         'ItemList',
    name:            `Past hangouts in ${payload.city}`,
    numberOfItems:   listItems.length,
    itemListElement: listItems,
  }
  const breadcrumb = composeBreadcrumb([
    { name: 'Home',        url: `${SITE_BASE}/` },
    { name: payload.city,  url: `${SITE_BASE}/city/${citySlug}` },
    { name: 'Past',        url: canonicalUrl },
  ])
  return {
    '@context': 'https://schema.org',
    '@graph':   [...siteGraphNodes(), itemList, breadcrumb],
  }
}

function composePastBody(payload, items, citySlug, locale = 'en') {
  const lp     = localePrefixFor(locale)
  const city   = payload.city
  const tz     = payload.timezone
  const events = items.filter(it => it.kind === 'event')
  const pulses = items.filter(it => it.kind === 'topic')

  const breadcrumb = `<nav class="ssr-breadcrumb"><a href="${lp}/">${T(locale, 'brand')}</a> › <a href="${lp}/city/${citySlug}">${htmlEscape(city)}</a> › <span>${T(locale, 'past.breadcrumb')}</span></nav>`
  const intro = items.length > 0
    ? T(locale, 'past.introItems', { city })
    : T(locale, 'past.introEmpty', { city })

  const eventsSection = events.length > 0
    ? `<section><h2>${T(locale, 'past.pastHangoutsHeading', { city: htmlEscape(city) })}</h2><ul>${events.slice(0, 20).map(e => {
        const slug = eventSlug(e)
        const when = e.starts_at ? formatPastDate(e.starts_at, tz, locale) : ''
        const loc  = e.location || e.venue
        const w    = loc ? ` · ${htmlEscape(loc)}` : ''
        return `<li><a href="${lp}/event/${slug}">${htmlEscape(e.title)}</a>${when ? ` — ${htmlEscape(when)}` : ''}${w}</li>`
      }).join('')}</ul></section>`
    : ''

  const pulsesSection = pulses.length > 0
    ? `<section><h2>${T(locale, 'past.pastPulsesHeading', { city: htmlEscape(city) })}</h2><ul>${pulses.slice(0, 20).map(p => {
        const replies = p.message_count ?? 0
        const repliesTxt = replies > 0 ? ` — ${T(locale, replies === 1 ? 'past.replyOne' : 'past.replyMany', { count: replies })}` : ''
        return `<li>${htmlEscape(p.title)}${repliesTxt}</li>`
      }).join('')}</ul></section>`
    : ''

  const evergreen = `<section><h2>${T(locale, 'past.whatsNextHeading', { city: htmlEscape(city) })}</h2><p>${T(locale, 'past.whatsNextBody', { city: htmlEscape(city), link: `<a href="${lp}/city/${citySlug}">${T(locale, 'past.whatsHappeningNowLink')}</a>` })}</p></section>`

  return [
    `<style>${SSR_CITY_STYLES} .ssr-breadcrumb { font-size: 0.9rem; opacity: 0.7; margin-bottom: 0.5rem; }</style>`,
    `<main class="ssr-main">`,
    breadcrumb,
    `<h1>${htmlEscape(T(locale, 'past.h1', { city }))}</h1>`,
    `<p class="ssr-intro">${htmlEscape(intro)}</p>`,
    eventsSection,
    pulsesSection,
    evergreen,
    `</main>`,
  ].filter(Boolean).join('\n')
}

function composeVenueMeta(payload, canonicalPath, venueId, locale = 'en') {
  // Backend shape: { venue: { id, name, address, category, hours, city, ... } }
  const v = payload?.venue
  if (!v || !v.name) return null

  const cityName = v.city?.name || ''
  const where    = v.address ? T(locale, 'venue.atFrag', { address: v.address }) : ''
  const description = T(locale, 'venue.desc', { name: v.name, where, city: cityName })

  return {
    title:       cityName ? T(locale, 'venue.titleCity', { name: v.name, city: cityName }) : v.name,
    description,
    url:         `${SITE_BASE}${canonicalPath}`,
    // No dedicated venue OG image yet — reuse the city card so embeds aren't
    // generic. Cheap to swap to /api/og?type=venue&id=... when we ship it.
    image:       v.city?.slug
                  ? `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(v.city.slug)}`
                  : `${SITE_BASE}/og/og-default.png`,
  }
}

// Pick the timeframe phrase for a city based on its local hour + day of week.
// Weekend windows (Fri 18+, Sat <18, Sun <18) override the time-of-day rule.
// Sun 18+ pivots to "This week" (looking ahead to Monday onward).
// Falls back to "Today" if the timezone is malformed.
function cityTimeframe(timezone, locale = 'en') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour:     'numeric',
      hour12:   false,
      weekday:  'short',
    }).formatToParts(new Date())
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10)
    const day  = parts.find(p => p.type === 'weekday').value  // 'Mon'..'Sun'

    if (day === 'Fri' && hour >= 18) return T(locale, 'timeframe.thisWeekend')
    if (day === 'Sat' && hour <  18) return T(locale, 'timeframe.thisWeekend')
    if (day === 'Sun' && hour <  18) return T(locale, 'timeframe.thisWeekend')
    if (day === 'Sun' && hour >= 18) return T(locale, 'timeframe.thisWeek')

    if (hour >= 2  && hour <= 4 ) return T(locale, 'timeframe.tomorrow')
    if (hour >= 5  && hour <= 11) return T(locale, 'timeframe.today')
    if (hour >= 12 && hour <= 17) return T(locale, 'timeframe.afternoonTonight')
    return T(locale, 'timeframe.tonight')  // 18-23 or 0-1
  } catch {
    return T(locale, 'timeframe.today')
  }
}

// City meta tags. The title and description are intent-matched to "what's
// happening in X" queries (events + meetups), not the vague "see who's
// around" copy we used to ship. Three description tiers based on actual
// event volume; the ≥30 tier exposes the count as social proof. Timeframe
// prefix in the title reflects the city's local hour + day of week so the
// snippet feels live across time zones. Returns {noindex:true} for cities
// with literally zero indexable content (no events AND no venues AND no chat).
function composeCityMeta(payload, canonicalPath, citySlug, upcomingCount = 0, venueCount = 0, messageCount = 0, locale = 'en') {
  if (!payload?.city) return null
  const city      = payload.city
  const timeframe = cityTimeframe(payload.timezone, locale)
  const title     = T(locale, 'city.title', { timeframe, city })

  let description
  if (upcomingCount >= 30) {
    description = T(locale, 'city.descHigh', { city, count: upcomingCount })
  } else if (upcomingCount >= 10) {
    description = T(locale, 'city.descMid', { city })
  } else {
    description = T(locale, 'city.descLow', { city })
  }

  // noindex only when there's truly nothing of substance: zero upcoming
  // events AND zero seeded venues AND zero chat messages. Any one of these
  // makes the page worth indexing — events/venues add unique content, and a
  // city with real chat activity is a live page worth surfacing.
  const noindex = upcomingCount === 0 && venueCount === 0 && messageCount === 0

  return {
    title,
    description,
    url:     `${SITE_BASE}${canonicalPath}`,
    image:   `${SITE_BASE}/api/og?type=city&slug=${encodeURIComponent(citySlug)}`,
    noindex,
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

// Site-level entities emitted on every prerendered page. Organization gives
// Google's brand panel; WebSite establishes site identity. SearchAction is
// omitted because there's no functional /?q= search endpoint yet — adding it
// without a backing route would trigger a structured-data warning in GSC.
const ORG_GRAPH_NODE = {
  '@type': 'Organization',
  '@id':   `${SITE_BASE}/#organization`,
  name:    'Hilads',
  url:     SITE_BASE,
  logo:    `${SITE_BASE}/og/og-default.png`,
}

const WEBSITE_GRAPH_NODE = {
  '@type':   'WebSite',
  '@id':     `${SITE_BASE}/#website`,
  name:      'Hilads',
  url:       SITE_BASE,
  publisher: { '@id': `${SITE_BASE}/#organization` },
}

function siteGraphNodes() {
  return [ORG_GRAPH_NODE, WEBSITE_GRAPH_NODE]
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
    '@graph': [...siteGraphNodes(), event, breadcrumb],
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

  // GeoCoordinates — emitted only when both coordinates exist. Unlocks the
  // map preview in Google's rich result for LocalBusiness types. Falls back
  // gracefully (no map preview) when nulls — never errors.
  if (typeof v.lat === 'number' && typeof v.lng === 'number') {
    node.geo = {
      '@type':   'GeoCoordinates',
      latitude:  v.lat,
      longitude: v.lng,
    }
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

  return {
    '@context': 'https://schema.org',
    '@graph': [...siteGraphNodes(), node, breadcrumb],
  }
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

  return {
    '@context': 'https://schema.org',
    '@graph': [...siteGraphNodes(), ...graph],
  }
}

// ── SSR body composers ───────────────────────────────────────────────────────
// Inject crawlable HTML into <div id="root"> before React mounts. React
// (createRoot().render) replaces the contents on hydration, so humans see
// this content for ~200-800ms (perceived as fast LCP, then interactive),
// while Googlebot indexes it as the canonical page body.

function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return ''
  return [...cc.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('')
}

// H1 mirrors the title's leading phrase so the searcher's "events in X"
// query keeps reading consistently from SERP → page. Timeframe-led, same
// timezone-aware logic as composeCityMeta. Branded suffix dropped — the
// title's "| Hilads" is enough; H1 should stay topical.
function cityH1(city, timeframe, locale = 'en') {
  return T(locale, 'city.h1', { timeframe, city })
}

// Country-name resolver (ISO-2 → full English name) via Intl, with a small
// regional flavour map layered on top so popular markets get more specific
// copy than just "in France". Unmapped countries fall back to the country
// name alone. Keep this list short and edit by hand — it's the per-city
// differentiation hook for ~80% of traffic.
const COUNTRY_FLAVOUR = {
  FR: 'café culture, late dinners, after-work apéros',
  GB: 'pub nights, weekend brunches, festival season',
  US: 'bar-hopping, food meetups, sports nights',
  CA: 'cosy bars, indie shows, weekend trail meetups',
  ES: 'late dinners, terrazas, all-night neighborhoods',
  IT: 'aperitivo hour, slow dinners, piazza nights',
  DE: 'beer-garden afternoons, club nights, weekend markets',
  NL: 'canal walks, café terraces, club crawls',
  PT: 'sunset miradouros, fado nights, late-summer evenings',
  AU: 'beach BBQs, coffee culture, sundowner sessions',
  NZ: 'craft beer, hiking meetups, coffee-shop hangouts',
  JP: 'izakaya runs, neighborhood crawls, after-work drinks',
  KR: 'food crawls, late-night soju, K-indie shows',
  TH: 'street-food tours, beach parties, sunset cocktails',
  VN: 'cà phê early, beer late, motorbike crews',
  ID: 'beach hangouts, warung dinners, surf meetups',
  PH: 'karaoke nights, beach trips, food crawls',
  MY: 'mamak runs, café culture, weekend hawker tours',
  SG: 'hawker dinners, rooftop drinks, weekend brunches',
  IN: 'food walks, chai meetups, evening street crawls',
  BR: 'beach hangouts, samba nights, all-day food culture',
  MX: 'taquería nights, mezcal crawls, weekend rooftops',
  AR: 'late dinners, asado weekends, milonga nights',
  CO: 'salsa nights, café culture, weekend trails',
  CL: 'pisco nights, hiking weekends, café meetups',
  PE: 'food crawls, pisco bars, weekend day-trips',
  EG: 'late-night cafés, Nile sunset walks, weekend trips',
  MA: 'rooftop sunsets, medina walks, mint-tea afternoons',
  ZA: 'braai weekends, wine-region trips, beachfront nights',
  TR: 'rooftop dinners, ferry rides, late-night meyhane',
  AE: 'rooftop bars, brunch culture, desert weekends',
  CN: 'late food crawls, KTV nights, neighborhood meetups',
  TW: 'night markets, café crawls, mountain weekends',
  HK: 'rooftop bars, late dim sum, weekend hikes',
}

function regionLine(country) {
  if (!country || country.length !== 2) return ''
  try {
    const cn = new Intl.DisplayNames(['en'], { type: 'region' })
    const name = cn.of(country.toUpperCase())
    const flavour = COUNTRY_FLAVOUR[country.toUpperCase()]
    return flavour
      ? `In ${name} you'll find ${flavour}.`
      : `Live in ${name} or just visiting? Hilads brings the people out.`
  } catch {
    return ''
  }
}

// Count event_type distribution after filtering out venue-derived rows.
function categoryCounts(events) {
  const out = {}
  for (const ev of events) {
    const t = ev?.type
    if (!t) continue
    out[t] = (out[t] || 0) + 1
  }
  return out
}

// City-page category cards (must match backend categoryMeta() allowlist).
const CITY_CATEGORIES = [
  { slug: 'coffee', label: 'Coffee meetups',     venueCat: 'cafe', icon: '☕' },
  { slug: 'drinks', label: 'Drinks & nightlife', venueCat: 'bar',  icon: '🍻' },
  { slug: 'music',  label: 'Music',              venueCat: null,   icon: '🎵' },
  { slug: 'food',   label: 'Food meetups',       venueCat: null,   icon: '🍽️' },
  { slug: 'meetup', label: 'Meetups',            venueCat: null,   icon: '👥' },
  { slug: 'party',  label: 'Parties',            venueCat: null,   icon: '🎉' },
]

// Render a "Browse by category in <city>" block on the city page. Each link
// goes to /city/<slug>/<category> which the prerender serves with its own
// content. Only categories with ≥3 events+venues are shown — same threshold
// the backend uses to gate the sitemap so we never link to a 404.
function categoryLinksHtml(city, citySlug, events, venues, locale = 'en') {
  const lp = localePrefixFor(locale)
  const evCounts = {}
  for (const e of events) {
    const t = e?.type
    if (t) evCounts[t] = (evCounts[t] || 0) + 1
  }
  let cafes = 0, bars = 0
  for (const v of venues) {
    if (v.category === 'bar') bars++
    else cafes++
  }

  const eligible = CITY_CATEGORIES.filter(c => {
    const ev = evCounts[c.slug] ?? 0
    const vn = c.venueCat === 'cafe' ? cafes : c.venueCat === 'bar' ? bars : 0
    return (ev + vn) >= 3
  })

  if (eligible.length === 0) return ''
  return `<section><h2>${T(locale, 'city.browseByCategoryHeading', { city: htmlEscape(city) })}</h2><ul>${
    eligible.map(c =>
      `<li>${c.icon} <a href="${lp}/city/${citySlug}/${c.slug}">${T(locale, 'city.categoryLink', { label: htmlEscape(catLabel(locale, c.slug, c.label)), city: htmlEscape(city) })}</a></li>`
    ).join('')
  }</ul></section>`
}

// Human label for an event_type. Mirrors apps/web/src/cityMeta.js EVENT_TYPES;
// keep in sync.
const CATEGORY_LABEL = {
  drinks: 'drinks',
  party:  'parties',
  music:  'music nights',
  food:   'food meetups',
  coffee: 'coffee meetups',
  sport:  'sport',
  meetup: 'meetups',
  other:  'other',
}

function topCategoriesLine(counts) {
  const sorted = Object.entries(counts)
    .filter(([k]) => k !== 'other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (sorted.length === 0) return ''
  const parts = sorted.map(([k, n]) => `${CATEGORY_LABEL[k] || k} (${n})`)
  if (parts.length === 1) return `Most active right now: ${parts[0]}.`
  if (parts.length === 2) return `Most active right now: ${parts[0]} and ${parts[1]}.`
  return `Most active right now: ${parts[0]}, ${parts[1]}, and ${parts[2]}.`
}

function venueMixLine(venues) {
  if (!Array.isArray(venues) || venues.length === 0) return ''
  let cafes = 0, bars = 0
  for (const v of venues) {
    if (v.category === 'bar') bars++
    else cafes++
  }
  const bits = []
  if (cafes) bits.push(`${cafes} ${cafes === 1 ? 'coffee spot' : 'coffee spots'}`)
  if (bars)  bits.push(`${bars} ${bars === 1 ? 'bar' : 'bars'}`)
  if (bits.length === 0) return ''
  if (bits.length === 1) return `Venue scene: ${bits[0]}.`
  return `Venue scene: ${bits[0]} and ${bits[1]}.`
}

function daysAgo(unixTs) {
  if (!unixTs) return null
  const ms = Date.now() - unixTs * 1000
  if (ms < 0) return 0
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function freshnessLine(events) {
  if (!Array.isArray(events) || events.length === 0) return ''
  const latest = events
    .map(e => e?.created_at)
    .filter(t => typeof t === 'number')
    .sort((a, b) => b - a)[0]
  const d = daysAgo(latest)
  if (d === null) return ''
  if (d === 0) return 'Latest activity: today.'
  if (d === 1) return 'Latest activity: yesterday.'
  if (d <= 7)  return `Latest activity: ${d} days ago.`
  return ''  // older than a week — don't advertise stale freshness
}

// Minimal inline CSS so the SSR body doesn't look broken during the brief
// window before React mounts. Scoped under `.ssr-main` so it can't bleed into
// SPA styles. The SPA's own stylesheet renders the real interactive UI.
const SSR_CITY_STYLES = `
  .ssr-main { max-width: 720px; margin: 0 auto; padding: 16px; font-family: system-ui, -apple-system, sans-serif; color: #e0e0e0; background: #161210; line-height: 1.5; }
  .ssr-main h1 { font-size: 1.6rem; margin: 0 0 0.5rem; color: #fff; }
  .ssr-main h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; color: #fff; }
  .ssr-main p  { margin: 0 0 0.75rem; }
  .ssr-main ul { padding-left: 1.25rem; margin: 0 0 1rem; }
  .ssr-main li { margin: 0.25rem 0; }
  .ssr-main a  { color: #FF7A3C; text-decoration: none; }
  .ssr-intro   { font-size: 1.05rem; }
`.replace(/\s+/g, ' ').trim()

function composeCityBody(payload, upcomingEvents, venues, locale = 'en') {
  const city  = payload.city || ''
  if (!city) return null
  const lp          = localePrefixFor(locale)
  const country     = payload.country || ''
  const flag        = flagEmoji(country)
  const events      = Array.isArray(upcomingEvents) ? upcomingEvents : []
  const venueList   = Array.isArray(venues) ? venues : []
  const eventCount  = events.length
  const venueCount  = venueList.length

  const introBits = []
  if (eventCount > 0) introBits.push(eventCount === 1 ? T(locale, 'city.introEventsOne') : T(locale, 'city.introEventsMany', { count: eventCount }))
  if (venueCount > 0) introBits.push(venueCount === 1 ? T(locale, 'city.introVenuesOne') : T(locale, 'city.introVenuesMany', { count: venueCount }))
  const introSuffix = introBits.length > 0
    ? T(locale, 'city.introSuffix', { bits: introBits.join(', ') })
    : T(locale, 'city.introEmpty')
  const intro = `${flag} ${htmlEscape(city)}${country ? `, ${htmlEscape(country)}` : ''}${htmlEscape(introSuffix)}`

  // Events list — up to 20, each linking to /event/<slug>-<id> (slug form for
  // SEO authority; prerender 301s bare hex anyway).
  const eventItems = events.slice(0, 20).map(ev => {
    const slug  = eventSlug(ev)
    const when  = ev.starts_at ? formatTime(ev.starts_at, payload.timezone, locale) : ''
    const where = ev.location ? ` · ${htmlEscape(ev.location)}` : ''
    return `<li><a href="${lp}/event/${slug}">${htmlEscape(ev.title)}</a>${when ? ` — ${htmlEscape(when)}` : ''}${where}</li>`
  }).join('\n        ')
  const eventsHeading = T(locale, 'city.upcomingEventsHeading', { city: htmlEscape(city) })
  const eventsSection = eventCount > 0
    ? `<section><h2>${eventsHeading}</h2><ul>\n        ${eventItems}\n      </ul></section>`
    : `<section><h2>${eventsHeading}</h2><p>${T(locale, 'city.noEvents')}</p></section>`

  // Venues showcase — up to 6
  let venuesSection = ''
  if (venueCount > 0) {
    const venueItems = venueList.slice(0, 6).map(v => {
      const slug = venueSlugFromName(v.name, v.id)
      const cat  = v.category === 'bar' ? '🍻' : '☕'
      return `<li>${cat} <a href="${lp}/venue/${slug}">${htmlEscape(v.name)}</a>${v.address ? ` — ${htmlEscape(v.address)}` : ''}</li>`
    }).join('\n        ')
    venuesSection = `<section><h2>${T(locale, 'city.popularVenuesHeading', { city: htmlEscape(city) })}</h2><ul>\n        ${venueItems}\n      </ul></section>`
  }

  // City-specific signals (event mix / venue split / freshness / country
  // flavour). These are EN-only curated micro-copy — on non-default locales we
  // omit the block entirely rather than leak English, keeping the page fully
  // in-language. The localized core content above carries the page.
  let signalsBlock = ''
  if (locale === 'en') {
    const signals = [
      topCategoriesLine(categoryCounts(events)),
      venueMixLine(venueList),
      freshnessLine(events),
      regionLine(country),
    ].filter(Boolean)
    signalsBlock = signals.length > 0
      ? `<p class="ssr-signals">${signals.map(htmlEscape).join(' ')}</p>`
      : ''
  }

  // Evergreen copy — two paragraphs, city-specific.
  const evergreen = `<section><h2>${T(locale, 'common.aboutHiladsInHeading', { city: htmlEscape(city) })}</h2><p>${T(locale, 'city.aboutBody1', { city: htmlEscape(city) })}</p><p>${T(locale, 'city.aboutBody2', { city: htmlEscape(city) })}</p></section>`

  const citySlug = cityToSlug(city)
  const categoriesSection = categoryLinksHtml(city, citySlug, events, venueList, locale)
  const timeframe = cityTimeframe(payload.timezone, locale)

  return [
    `<style>${SSR_CITY_STYLES}</style>`,
    `<main class="ssr-main">`,
    `<h1>${htmlEscape(cityH1(city, timeframe, locale))}</h1>`,
    `<p class="ssr-intro">${intro}</p>`,
    signalsBlock,
    eventsSection,
    categoriesSection,
    venuesSection,
    evergreen,
    `</main>`,
  ].join('\n')
}

// Body for /event/<id> — H1 + when/where/host + breadcrumb + related events
// in the same city + evergreen. Filters venue-tagged events out of the
// "Other events" list so we don't link into the redirect chain to /venue/.
function composeEventBody(payload, otherEvents, locale = 'en') {
  const ev = payload?.event
  if (!ev || !ev.title) return null
  const lp       = localePrefixFor(locale)
  const city     = payload.cityName || ''
  const country  = payload.country  || ''
  const citySlug = city ? cityToSlug(city) : ''

  const when  = ev.starts_at ? formatTime(ev.starts_at, payload.timezone, locale) : ''
  const dateStr = ev.starts_at
    ? new Date(ev.starts_at * 1000).toLocaleDateString(DATE_LOCALE[locale] || 'en-US', {
        timeZone: payload.timezone || 'UTC',
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : ''
  // Past events: show a badge + past-tense date + attendee count instead of
  // the upcoming "When:" line. Still fully indexable.
  const pastBadge = ev.is_past ? `<p class="ssr-past-badge">${T(locale, 'event.pastBadge')}</p>` : ''
  const attendedLine = ev.is_past && (ev.participant_count ?? 0) > 0
    ? `<p class="ssr-attended">${T(locale, ev.participant_count === 1 ? 'event.attendedOne' : 'event.attendedMany', { count: `<strong>${ev.participant_count}</strong>` })}</p>`
    : ''
  const whereLine = ev.location ? `<p class="ssr-where"><strong>${T(locale, 'event.labelWhere')}</strong> ${htmlEscape(ev.location)}</p>` : ''
  const whenLine  = ev.is_past
    ? (dateStr ? `<p class="ssr-when"><strong>${T(locale, 'event.labelHappenedOn')}</strong> ${htmlEscape(dateStr)}${when ? ` · ${htmlEscape(when)}` : ''}</p>` : '')
    : (dateStr ? `<p class="ssr-when"><strong>${T(locale, 'event.labelWhen')}</strong> ${htmlEscape(dateStr)}${when ? ` · ${htmlEscape(when)}` : ''}</p>` : '')
  const hostLine  = ev.host_nickname ? `<p class="ssr-host"><strong>${T(locale, 'event.labelHostedBy')}</strong> ${htmlEscape(ev.host_nickname)}</p>` : ''
  const recur     = ev.recurrence_label ? `<p class="ssr-recur"><strong>${T(locale, 'event.labelRecurs')}</strong> ${htmlEscape(ev.recurrence_label)}</p>` : ''

  const breadcrumb = city && citySlug
    ? `<nav class="ssr-breadcrumb"><a href="${lp}/">${T(locale, 'brand')}</a> › <a href="${lp}/city/${citySlug}">${htmlEscape(city)}</a> › <span>${htmlEscape(ev.title)}</span></nav>`
    : ''

  // Related — other events in the same city, exclude self + venue rows.
  // For a past event this becomes a "Similar upcoming events" funnel back to
  // live content; for a live event it's just "Other events".
  const related = (Array.isArray(otherEvents) ? otherEvents : [])
    .filter(e => e.id !== ev.id && !e.is_venue)
    .slice(0, 8)
  const relatedHeading = ev.is_past
    ? T(locale, 'event.upcomingEventsIn', { city: htmlEscape(city) })
    : T(locale, 'event.otherEventsIn', { city: htmlEscape(city) })
  const relatedSection = related.length > 0
    ? `<section><h2>${relatedHeading}</h2><ul>${related.map(e => {
        const slug = eventSlug(e)
        const t = e.starts_at ? formatTime(e.starts_at, payload.timezone, locale) : ''
        return `<li><a href="${lp}/event/${slug}">${htmlEscape(e.title)}</a>${t ? ` — ${htmlEscape(t)}` : ''}</li>`
      }).join('')}</ul></section>`
    : ''

  const cityLink = city && citySlug
    ? `<p>${T(locale, 'common.seeOnHilads', { link: `<a href="${lp}/city/${citySlug}">${T(locale, 'event.otherThingsLink', { city: htmlEscape(city) })}</a>` })}</p>`
    : ''

  const evergreen = `<section><h2>${T(locale, 'common.aboutHiladsHeading')}</h2><p>${T(locale, 'common.aboutHiladsBody')}</p>${cityLink}</section>`

  return [
    `<style>${SSR_CITY_STYLES} .ssr-breadcrumb { font-size: 0.9rem; opacity: 0.7; margin-bottom: 0.5rem; } .ssr-past-badge { display: inline-block; background: #2a2a2a; color: #bbb; font-size: 0.8rem; padding: 2px 8px; border-radius: 4px; margin: 0 0 0.5rem; }</style>`,
    `<main class="ssr-main">`,
    breadcrumb,
    pastBadge,
    `<h1>${htmlEscape(ev.title)}</h1>`,
    whenLine,
    whereLine,
    hostLine,
    attendedLine,
    recur,
    relatedSection,
    evergreen,
    `</main>`,
  ].filter(Boolean).join('\n')
}

// Body for /venue/<id> — H1 + address/hours + breadcrumb + related venues
// in the same city + evergreen with venue-type context.
function composeVenueBody(payload, otherVenues, locale = 'en') {
  const v = payload?.venue
  if (!v || !v.name) return null
  const lp = localePrefixFor(locale)
  const city = v.city?.name || ''
  const citySlug = v.city?.slug || ''
  const isBar = v.category === 'bar'

  const breadcrumb = city && citySlug
    ? `<nav class="ssr-breadcrumb"><a href="${lp}/">${T(locale, 'brand')}</a> › <a href="${lp}/city/${citySlug}">${htmlEscape(city)}</a> › <span>${htmlEscape(v.name)}</span></nav>`
    : ''

  const addrLine  = v.address ? `<p class="ssr-where"><strong>${T(locale, 'venue.labelAddress')}</strong> ${htmlEscape(v.address)}</p>` : ''
  const hoursLine = v.hours?.opens && v.hours?.closes
    ? `<p class="ssr-when"><strong>${T(locale, 'venue.labelHours')}</strong> ${T(locale, 'venue.hoursValue', { opens: htmlEscape(v.hours.opens), closes: htmlEscape(v.hours.closes) })}</p>`
    : ''
  const catLine = `<p class="ssr-cat"><strong>${T(locale, 'venue.labelType')}</strong> ${isBar ? T(locale, 'venue.typeBar') : T(locale, 'venue.typeCafe')}</p>`

  const related = (Array.isArray(otherVenues) ? otherVenues : [])
    .filter(o => o.id !== v.id)
    .slice(0, 6)
  const relatedSection = related.length > 0 && city
    ? `<section><h2>${T(locale, 'venue.otherVenuesIn', { city: htmlEscape(city) })}</h2><ul>${related.map(o => {
        const slug = venueSlugFromName(o.name, o.id)
        const cat = o.category === 'bar' ? '🍻' : '☕'
        return `<li>${cat} <a href="${lp}/venue/${slug}">${htmlEscape(o.name)}</a></li>`
      }).join('')}</ul></section>`
    : ''

  const cityLink = city && citySlug
    ? `<p>${T(locale, 'venue.whatsHappeningSentence', { link: `<a href="${lp}/city/${citySlug}">${T(locale, 'venue.whatsHappeningLink', { city: htmlEscape(city) })}</a>` })}</p>`
    : ''

  const evergreen = isBar
    ? `<section><h2>${T(locale, 'venue.aboutHeading')}</h2><p>${T(locale, 'venue.aboutBar', { name: htmlEscape(v.name), city: htmlEscape(city) })}</p>${cityLink}</section>`
    : `<section><h2>${T(locale, 'venue.aboutHeading')}</h2><p>${T(locale, 'venue.aboutCafe', { name: htmlEscape(v.name), city: htmlEscape(city) })}</p>${cityLink}</section>`

  return [
    `<style>${SSR_CITY_STYLES} .ssr-breadcrumb { font-size: 0.9rem; opacity: 0.7; margin-bottom: 0.5rem; }</style>`,
    `<main class="ssr-main">`,
    breadcrumb,
    `<h1>${htmlEscape(v.name)}</h1>`,
    catLine,
    addrLine,
    hoursLine,
    relatedSection,
    evergreen,
    `</main>`,
  ].filter(Boolean).join('\n')
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

// Inject a robots noindex directive into <head>. Used for cities with zero
// upcoming events AND zero venues AND zero chat messages — genuinely empty
// pages that shouldn't dilute the site's quality signal in Google's index.
// The shell has no pre-existing robots tag so we always insert (rather than
// replace).
function injectRobotsNoindex(shell) {
  return shell.replace(
    /<\/head>/i,
    '<meta name="robots" content="noindex" />\n  </head>',
  )
}

// Inject SSR body content inside <div id="root"> before the <noscript>
// fallback. React's createRoot().render() overwrites #root's children on
// mount, so humans only see this for the cold-load window (LCP win); Googlebot
// indexes it as the canonical body content for the URL.
function injectBody(shell, body) {
  if (!body) return shell
  return shell.replace(/<div id="root">/i, `<div id="root">\n      ${body}`)
}

function injectMeta(shell, meta, locale = 'en') {
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

  // og:locale must match the page language (shell ships en_US — overriding to
  // it is a no-op on default, fr_FR/vi_VN on localized URLs).
  out = out.replace(
    /<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:locale" content="${OG_LOCALE[locale] || 'en_US'}" />`,
  )

  // On localized pages, point the image alt text at the localized page title.
  // English keeps the shell's generic brand alt (no regression).
  if (locale !== 'en') {
    out = out
      .replace(
        /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:image:alt" content="${t}" />`,
      )
      .replace(
        /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/?>/i,
        `<meta name="twitter:image:alt" content="${t}" />`,
      )
  }

  return out
}

// ── Locale (Option A: un-prefixed = English canonical; /fr, /vi additive) ─────
const I18N_LOCALES = ['en', 'fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil']

function setHtmlLang(shell, locale) {
  return shell.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`)
}

// Every prerendered page advertises all locales + x-default so Google clusters
// the un-prefixed (EN) and /fr, /vi variants as one set. basePath is the
// UN-prefixed canonical path (e.g. /city/paris); each alternate prepends its
// locale segment (EN stays bare).
function injectHreflang(shell, basePath) {
  const alt = (loc) => `${SITE_BASE}${loc === 'en' ? '' : '/' + loc}${basePath}`
  const links = [
    ...I18N_LOCALES.map((loc) => `<link rel="alternate" hreflang="${loc}" href="${alt(loc)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${alt('en')}" />`,
  ].join('\n  ')
  return shell.replace(/<\/head>/i, `${links}\n  </head>`)
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

  // Locale from the rewrite (?locale=fr|vi); default English. localePrefix is
  // prepended to canonical/og:url AND to every 301 Location below, so a
  // localized request like /fr/event/<bare-hex> consolidates to
  // /fr/event/<slug> rather than dropping back to the EN URL.
  const rawLocale = (req.query || {}).locale
  const locale = I18N_LOCALES.includes(rawLocale) ? rawLocale : 'en'
  const localePrefix = locale === 'en' ? '' : `/${locale}`

  let meta          = null
  let jsonLd        = null
  let bodyHtml      = null   // SSR'd body content injected inside #root
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
        const { status: evStatus, data } = await fetchWithStatus(
          `${API_BASE}/api/v1/events/${encodeURIComponent(hex)}`,
          API_TIMEOUT_MS,
        )

        // 410 Gone: the event was moderated/removed. Pass the 410 straight
        // through so Google deindexes it permanently (vs the soft-404 that a
        // generic-shell 200 would produce).
        if (evStatus === 410) {
          res.statusCode = 410
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end('<!doctype html><title>Event removed</title><p>This event has been removed.</p>')
          return
        }

        // SEO: occurrences of seeded venues (coffee shops, bars) MUST 301 to
        // the canonical /venue/<slug>-<series_id> page. Google has thousands
        // of these /event/<...> URLs cached from before the refactor.
        if (data?.event?.is_venue && data.event.series_id) {
          const venueSlugId = venueSlugFromName(data.event.title, data.event.series_id)
          res.statusCode = 301
          res.setHeader('Location', `${SITE_BASE}${localePrefix}/venue/${venueSlugId}`)
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
            res.setHeader('Location', `${SITE_BASE}${localePrefix}/venue/${venueSlugId}`)
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
          res.setHeader('Location', `${SITE_BASE}${localePrefix}/event/${slugId}`)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end()
          return
        }

        // Canonical URL is always the slug version when we have event data.
        canonicalPath = data?.event ? `/event/${eventSlug(data.event)}` : `/event/${hex}`
        meta = composeEventMeta(data, canonicalPath, hex, locale)
        if (meta) {
          cacheMaxAge = 300                  // 5 min — events churn
          const augmented = {
            ...data,
            _descriptionForSchema: meta.description,
            _ogImage:               meta.image,
            citySlug:               data.cityName ? cityToSlug(data.cityName) : undefined,
          }
          jsonLd = composeEventJsonLd(augmented, meta.url)

          // Body: H1 + when/where/host + related events in the same city.
          // Fetch related upcoming in parallel; best-effort, body still
          // renders without it.
          let otherEvents = []
          if (data?.event?.channel_id) {
            const otherData = await fetchWithTimeout(
              `${API_BASE}/api/v1/channels/${encodeURIComponent(data.event.channel_id)}/events/upcoming?days=7`,
              API_TIMEOUT_MS,
            )
            otherEvents = Array.isArray(otherData?.events) ? otherData.events : []
          }
          bodyHtml = composeEventBody(data, otherEvents, locale)
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
          res.setHeader('Location', `${SITE_BASE}${localePrefix}/venue/${slugId}`)
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.end()
          return
        }

        canonicalPath = data?.venue
          ? `/venue/${venueSlugFromName(data.venue.name, data.venue.id)}`
          : `/venue/${hex}`
        meta = composeVenueMeta(data, canonicalPath, hex, locale)
        if (meta) {
          cacheMaxAge = 3600                 // 1 h — venue info changes rarely
          jsonLd = composeVenueJsonLd(data, meta.url)

          // Body: address/hours + related venues in the same city
          let otherVenues = []
          if (data?.venue?.city?.slug) {
            const otherData = await fetchWithTimeout(
              `${API_BASE}/api/v1/cities/${encodeURIComponent(data.venue.city.slug)}/venues`,
              API_TIMEOUT_MS,
            )
            otherVenues = Array.isArray(otherData?.venues) ? otherData.venues : []
          }
          bodyHtml = composeVenueBody(data, otherVenues, locale)
        }
      }
    } else if (type === 'category' && typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      const category = (req.query || {}).category
      if (typeof category === 'string' && /^[a-z]{1,32}$/.test(category)) {
        canonicalPath = `/city/${slug}/${category}`
        const data = await fetchWithTimeout(
          `${API_BASE}/api/v1/cities/${encodeURIComponent(slug)}/categories/${encodeURIComponent(category)}`,
          API_TIMEOUT_MS,
        )
        if (data?.city?.name) {
          cacheMaxAge = 1800            // 30 min — events churn but slower than per-event
          meta     = composeCategoryMeta(data, canonicalPath, locale)
          jsonLd   = composeCategoryJsonLd(data, meta?.url ?? `${SITE_BASE}${canonicalPath}`)
          bodyHtml = composeCategoryBody(data, locale)
        }
      }
    } else if (type === 'city' && typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      canonicalPath = `/city/${slug}`
      const cityData = await fetchWithTimeout(
        `${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`,
        API_TIMEOUT_MS,
      )
      if (cityData?.city) {
        cacheMaxAge = 3600                 // 1 h — cities stable
        // Parallel: upcoming events (for ItemList + body) + venues (for body
        // showcase). Best-effort — either failure is non-fatal; we just emit
        // less content. Same timeout budget as cityData itself.
        const [upcomingData, venuesData] = cityData?.channelId
          ? await Promise.all([
              fetchWithTimeout(
                `${API_BASE}/api/v1/channels/${encodeURIComponent(cityData.channelId)}/events/upcoming?days=7`,
                API_TIMEOUT_MS,
              ),
              fetchWithTimeout(
                `${API_BASE}/api/v1/cities/${encodeURIComponent(slug)}/venues`,
                API_TIMEOUT_MS,
              ),
            ])
          : [null, null]
        const rawUpcoming   = Array.isArray(upcomingData?.events) ? upcomingData.events : []
        // Filter out venue-derived "events" — those have a dedicated /venue/
        // page; including them here would create a 301 chain (city → event →
        // venue) and dilute link equity. They surface separately under
        // "Popular venues". is_venue is set by EventRepository::format.
        const upcoming      = rawUpcoming.filter(ev => !ev.is_venue)
        const venues        = Array.isArray(venuesData?.venues) ? venuesData.venues : []
        const upcomingCount = upcoming.length
        // messageCount comes from the by-slug payload (same server-side fetch),
        // so it's present at SSR time — no separate request that could time out
        // and falsely flip a chatty city to noindex.
        const messageCount  = Number.isFinite(cityData.messageCount) ? cityData.messageCount : 0

        meta   = composeCityMeta(cityData, canonicalPath, slug, upcomingCount, venues.length, messageCount, locale)
        jsonLd = composeCityJsonLd(cityData, meta.url, upcoming)
        bodyHtml = composeCityBody(cityData, upcoming, venues, locale)
      }
    } else if (type === 'past' && typeof slug === 'string' && /^[a-z0-9-]{1,80}$/.test(slug)) {
      canonicalPath = `/city/${slug}/past`
      const cityData = await fetchWithTimeout(
        `${API_BASE}/api/v1/cities/by-slug/${encodeURIComponent(slug)}`,
        API_TIMEOUT_MS,
      )
      if (cityData?.city && cityData?.channelId) {
        // Pull the most recent finished hangouts + expired pulses (one batched
        // request). Best-effort — an empty/failed fetch yields a noindex page.
        const archive = await fetchWithTimeout(
          `${API_BASE}/api/v1/channels/${encodeURIComponent(cityData.channelId)}/past?type=both&limit=20`,
          API_TIMEOUT_MS,
        )
        const items = Array.isArray(archive?.items) ? archive.items : []
        cacheMaxAge = 1800            // 30 min — past content is stable but newly-expired items trickle in
        meta     = composePastMeta(cityData, canonicalPath, slug, items.length, locale)
        jsonLd   = composePastJsonLd(cityData, items, slug, meta?.url ?? `${SITE_BASE}${canonicalPath}`)
        bodyHtml = composePastBody(cityData, items, slug, locale)
      }
    }
  } catch (err) {
    console.error('[prerender] composer failed:', err)
    meta = null
    jsonLd = null
  }

  // Self-referential canonical per locale (Option A). EN keeps the bare URL.
  if (meta && localePrefix) {
    meta = { ...meta, url: `${SITE_BASE}${localePrefix}${canonicalPath}` }
  }

  let html = setHtmlLang(shell, locale)
  if (meta)          html = injectMeta(html, meta, locale)
  if (meta)          html = injectHreflang(html, canonicalPath)
  if (meta?.noindex) html = injectRobotsNoindex(html)
  if (jsonLd)        html = injectJsonLd(html, jsonLd)
  if (bodyHtml)      html = injectBody(html,   bodyHtml)

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
