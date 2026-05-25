/**
 * Vercel Edge Middleware — first-visit language detection (Option A).
 *
 * Un-prefixed URLs are the English canonical and are NEVER rewritten here.
 * On a first visit (no `hilads_lang` cookie) by a fr/vi browser, we 302 to the
 * matching /fr or /vi variant. A returning user's cookie choice wins; choosing
 * English keeps them on the bare URLs. Crawlers are never redirected — they
 * index the canonical and discover localized variants via hreflang.
 *
 * 302 (not 301) on purpose: the un-prefixed EN URL must stay the indexable
 * canonical. This runs before vercel.json rewrites.
 */

const LOCALES = ['fr', 'vi'] // 'en' is the un-prefixed default — no prefix
const COOKIE = 'hilads_lang'

export const config = {
  // HTML document routes only. Exclude API, build assets, .well-known,
  // the static legal pages, and anything with a file extension.
  matcher: ['/((?!api|_vercel|assets|logo|\\.well-known|privacy|terms|support|child-safety|.*\\.).*)'],
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora|pinterest|whatsapp|telegram|slackbot|twitterbot|linkedinbot|googlebot|google-inspectiontool|duckduckbot|baiduspider|yandex|bingbot/i

export default function middleware(request: Request) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Already locale-prefixed → let the rewrite / prerender / SPA handle it.
  const seg = pathname.split('/')[1]
  if (LOCALES.includes(seg)) return

  // Never redirect crawlers — keep them on the canonical + hreflang.
  const ua = request.headers.get('user-agent') || ''
  if (BOT_RE.test(ua)) return

  // Explicit choice wins; 'en' (or anything non-fr/vi) → stay un-prefixed.
  const cookie = readCookie(request.headers.get('cookie'), COOKIE)
  let target: string | null = cookie && LOCALES.includes(cookie) ? cookie : null

  // First visit (no cookie at all): detect from Accept-Language.
  if (!cookie) {
    const al = (request.headers.get('accept-language') || '').toLowerCase()
    const first = al.split(',')[0].trim().slice(0, 2)
    if (LOCALES.includes(first)) target = first
  }

  if (!target) return // English default — no redirect

  url.pathname = `/${target}${pathname}`
  return Response.redirect(url, 302)
}
