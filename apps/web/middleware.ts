/**
 * Vercel Edge Middleware — honor an EXPLICIT stored language choice only.
 *
 * Un-prefixed URLs are the English canonical and are served with 200 here.
 * We redirect to /fr or /vi ONLY when the visitor has explicitly picked that
 * language in-app (the `hilads_lang` cookie, set solely by setLocale). A fresh
 * visitor with NO cookie is NEVER redirected — including on Accept-Language —
 * so the bare URL serves English 200. This avoids the forced-language-redirect
 * SEO anti-pattern: Googlebot (Accept-Language: en, US) must reach /city/<slug>,
 * /fr/... and /vi/... independently with 200, and x-default → bare English must
 * return 200, not a 302.
 *
 * 302 (not 301) on purpose: the un-prefixed EN URL must stay the indexable
 * canonical. This runs before vercel.json rewrites.
 */

const LOCALES = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja'] // 'en' is the un-prefixed default — no prefix
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

  // Only an EXPLICIT stored choice redirects. `hilads_lang` is written solely
  // when the user picks a language in-app (setLocale) — never from Accept-Language
  // and never by initial detection. A returning user who chose fr/vi goes to their
  // variant; choosing English (or any non-fr/vi value) keeps them un-prefixed.
  const cookie = readCookie(request.headers.get('cookie'), COOKIE)
  const target = cookie && LOCALES.includes(cookie) ? cookie : null

  // Fresh visitor — no explicit choice → serve the English canonical at the bare
  // URL with 200. Do NOT redirect on Accept-Language (SEO: every language URL must
  // be independently reachable with 200; x-default → bare English must be 200).
  if (!target) return

  url.pathname = `/${target}${pathname}`
  return Response.redirect(url, 302)
}
