/**
 * hilads.live/launch-season/rules (and /<locale>/launch-season/rules) — the Launch Season's
 * public rules, linked from the app's join screen and from social posts.
 *
 * The text lives in the API (Admin › Launch Season › Rules: markdown per locale, English
 * fallback), so updating it or adding a translation needs no deploy. ?season=ID shows a
 * given season (a test season's link); else the latest real one. Until the admin ticks
 * "Final", a red "DRAFT - not final" banner shows and the page is noindex.
 *
 * Standalone and light (no app bundle), light and dark. A tiny markdown subset: # ## ###,
 * - lists, **bold**, [links](https://…), paragraphs; everything else is escaped text.
 */

import { API_BASE } from './_daily.mjs'

const LOCALES = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar']

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
}

/** The markdown subset as HTML (escaped first). */
export function renderMarkdown(md) {
  const out = []
  let list = false
  let para = []
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
    if (list) { out.push('</ul>'); list = false }
  }
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (line === '') { flush(); continue }
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue }
    if (li) {
      if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] }
      if (!list) { out.push('<ul>'); list = true }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    if (list) { out.push('</ul>'); list = false }
    para.push(line)
  }
  flush()
  return out.join('\n')
}

function page(r, locale) {
  const title = `${r.season?.name || 'Launch Season'} — Rules · Hilads`
  const draft = !r.isFinal
  const updated = r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : null
  return `<!doctype html>
<html lang="${esc(r.locale || locale)}"${r.locale === 'ar' ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`The official rules of the Hilads ${r.season?.name || 'Launch Season'}.`)}">
${draft ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/favicon.ico">
<style>
:root { --bg:#FBF6F0; --surface:#FFFFFF; --line:#EADDD0; --text:#241A12; --muted:#6E5D4E; --link:#C24A38; --draft-bg:#FDE3E1; --draft:#9E1C14; }
@media (prefers-color-scheme: dark) { :root { --bg:#17110C; --surface:#211912; --line:#3A2E24; --text:#F5ECE3; --muted:#BBA996; --link:#FF9A66; --draft-bg:#4A1612; --draft:#FFB4AC; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
.brand { display:flex; align-items:center; gap:8px; font-weight:800; color:var(--text); text-decoration:none; margin-bottom:16px; }
.draft { background:var(--draft-bg); color:var(--draft); border-radius:12px; padding:12px 16px; font-weight:800; margin-bottom:16px; }
article { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:20px 18px; overflow-wrap:anywhere; }
h1 { font-size:26px; line-height:1.25; margin:0 0 12px; }
h2 { font-size:19px; margin:24px 0 8px; }
h3 { font-size:16px; margin:18px 0 6px; }
a { color:var(--link); }
ul { padding-left: 20px; }
.meta { color:var(--muted); font-size:13px; margin-top:16px; }
</style>
</head>
<body>
<main>
  <a class="brand" href="/${locale !== 'en' ? esc(locale) + '/' : ''}">🚀 Hilads</a>
  ${draft ? '<div class="draft" role="note">DRAFT - not final. These rules are being reviewed and will change.</div>' : ''}
  <article>
${renderMarkdown(r.body)}
  </article>
  <p class="meta">${updated ? `Last updated ${esc(updated)}` : ''}${r.version ? ` · version ${esc(r.version)}` : ''}</p>
</main>
</body>
</html>`
}

export default async function handler(req, res) {
  const raw = String((req.query && req.query.locale) || '').toLowerCase()
  const locale = LOCALES.includes(raw) ? raw : 'en'
  const season = /^\d+$/.test(String(req.query?.season || '')) ? `&season=${req.query.season}` : ''
  let r
  try {
    const api = await fetch(`${API_BASE}/api/v1/contest/rules?locale=${encodeURIComponent(locale)}${season}`)
    if (!api.ok) throw new Error(String(api.status))
    r = await api.json()
  } catch {
    res.statusCode = 503
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">The rules are unavailable right now, please try again in a minute.</p>')
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  res.end(page(r, locale))
}
