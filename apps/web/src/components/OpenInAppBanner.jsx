import { useEffect, useState } from 'react'

// Why this exists: Universal Links (iOS) / App Links (Android) open the native
// app when a link is tapped from apps that hand the URL to the OS (Slack,
// Messages, …). But in-app browsers - Zalo, Facebook, Instagram, Line, WeChat,
// etc. - load the URL inside their OWN webview and never give the OS a chance to
// trigger the app, so the user lands on the website instead. This banner detects
// that case on a content deep-link page and bounces to the app via the custom
// scheme (iOS: hilads://…) / intent URL (Android), with a manual "Open" button.

const ANDROID_PKG = 'com.hilads.app'

// Strip an optional leading locale segment (en, fr, pt-br, zh-hans, …) so the
// app URL maps to the un-prefixed native route (the app has no /<locale>/ paths).
const LOCALE_SEG_RE = /^\/[a-z]{2}(?:-[a-z]{2,4})?(?=\/)/

// Shareable content routes that have a native counterpart.
const DEEPLINK_RE = /^\/(challenge|event|venue|city|t|e)\//

// In-app browsers whose webview swallows Universal/App Links.
const IN_APP_RE = /\b(Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|Twitter|TikTok|KAKAOTALK)\b/i

export default function OpenInAppBanner() {
  const [appUrl, setAppUrl] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent || ''
    const isMobile = /android|iphone|ipad|ipod/i.test(ua)
    if (!isMobile) return

    const path = (window.location.pathname.replace(LOCALE_SEG_RE, '') || '/')
    if (!DEEPLINK_RE.test(path)) return  // only on shareable content pages

    const search = window.location.search || ''
    const isAndroid = /android/i.test(ua)
    const scheme = `hilads:/${path}${search}`  // → hilads://challenge/<id>
    const intent = `intent:/${path}${search}#Intent;scheme=hilads;package=${ANDROID_PKG};`
                 + `S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`
    const url = isAndroid ? intent : scheme
    setAppUrl(url)

    // Auto-bounce ONLY inside an in-app browser (the broken case). A regular
    // mobile browser already gave Universal/App Links their shot, so attempting
    // the scheme there would just flash an error for users without the app.
    // In-app webviews fail a custom-scheme nav silently when the app is absent.
    if (IN_APP_RE.test(ua)) {
      const t = setTimeout(() => { try { window.location.href = url } catch { /* no app */ } }, 400)
      return () => clearTimeout(t)
    }
  }, [])

  if (!appUrl) return null

  return (
    <div className="open-in-app">
      <span className="open-in-app-text">Continue in the Hilads app for the full experience</span>
      <a className="open-in-app-btn" href={appUrl}>Open app</a>
      <button type="button" className="open-in-app-close" aria-label="Dismiss" onClick={() => setAppUrl('')}>✕</button>
    </div>
  )
}
