import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'
import OpenInAppBanner from './components/OpenInAppBanner'
import i18n, { resolveInitialLocale, loadLocale, RTL_LOCALES } from './i18n'

import posthog from 'posthog-js'
import { captureUtm } from './lib/utm'

// Crawler / bot / link-previewer short-circuit. The prerender already shipped
// the SSR HTML (title, meta, hreflang, JSON-LD, body) that bots index - running
// the SPA on top adds nothing for SEO and only wastes backend calls (creates a
// guest record, joins the city, polls). Skip everything for them. NOT cloaking:
// humans receive the exact same HTML on first paint; we only skip *hydration*
// for known bot UAs, which is the dynamic-rendering pattern Google blesses.
// NOTE: each token here must be a crawler-only marker. "WhatsApp" was REMOVED
// because Android WhatsApp's in-app browser (pre-Custom-Tabs) appends
// "WhatsApp/<ver>" to a normal Chromium UA - matching it would break real
// human users clicking a WhatsApp link. The link previewer doesn't run JS
// anyway, so removing it costs nothing.
const BOT_UA_RE = /Googlebot|bingbot|YandexBot|DuckDuckBot|Slurp|Baiduspider|Applebot|Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|TelegramBot|AhrefsBot|SemrushBot|MJ12bot|PetalBot|GPTBot|ClaudeBot|Bytespider/i
const IS_BOT = typeof navigator !== 'undefined' && BOT_UA_RE.test(navigator.userAgent || '')

// Key + host come from env (VITE_POSTHOG_KEY / VITE_POSTHOG_HOST) — never hard
// coded. Set VITE_POSTHOG_KEY in .env (local) and in the Vercel dashboard (prod).
// Host defaults to the managed reverse proxy so events dodge ad/tracker blockers.
const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://hi.hilads.live'

if (!IS_BOT) {

if (POSTHOG_KEY)
posthog.init(POSTHOG_KEY, {
    // Events route through the managed reverse proxy; ui_host keeps the toolbar
    // and PostHog UI features pointed at the real EU instance.
    api_host: POSTHOG_HOST,
    ui_host: 'https://eu.posthog.com',
    disable_toolbar: true,
    autocapture: false,        // all events tracked manually via track()
    capture_pageleave: false,  // not useful for a SPA chat context
    // Session recording generates a continuous stream of `s/?ip=0` requests
    // (DOM snapshots sent throughout the session) - stop it so it doesn't
    // compete for bandwidth with critical API calls during channel load.
    loaded: (ph) => {
        if (typeof ph.stopSessionRecording === 'function') {
            ph.stopSessionRecording()
        }
        // Expose the instance globally. posthog-js does NOT reliably set
        // window.posthog with the ES-module import, so set it ourselves — this
        // enables console debugging AND the window.posthog.capture() calls used
        // elsewhere in the app (PastArchive, calendar) which otherwise no-op.
        window.posthog = ph
    },
})

// Capture ad UTM/click-ids from the entry URL as PostHog super properties so the
// whole landing→join funnel is attributable to the creative that drove the click.
captureUtm()

if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        // Drop noise injected by in-app browsers (Facebook / Instagram / etc.).
        // These errors come from scripts Meta injects into its WebViews - NOT our
        // code - and are unactionable, but would otherwise flood Sentry as
        // "unhandled / critical":
        //   - Android FB IAB: `iabjs://` scripts, "Java object is gone" on
        //     teardown, enableButtonsClickedMetaDataLogging / navigation_perf...
        //   - iOS IG IAB: setupIosCallbackHandler touches window.webkit.messageHandlers
        //     which is undefined outside a native WKWebView bridge. We never use
        //     window.webkit anywhere, so any such error is always external.
        ignoreErrors: [
            /Java object is gone/i,
            /Java bridge method/i,
            /enableButtonsClickedMetaDataLogging/i,
            /navigation_performance_logger/i,
            /Object Not Found Matching Id/i,
            /sendBeforeUnloadMessage/i,
            /window\.webkit\.messageHandlers/i,
            /webkit\.messageHandlers/i,
            /setupIosCallbackHandler/i,
        ],
        denyUrls: [
            /iabjs:\/\//i,                    // in-app browser injected scripts
            /navigation_performance_logger/i,
        ],
        beforeSend(event) {
            // Belt-and-suspenders: drop any event whose stack references an
            // in-app-browser injected script, regardless of the message text.
            const frames = event?.exception?.values?.flatMap(v => v?.stacktrace?.frames ?? []) ?? []
            if (frames.some(f => typeof f?.filename === 'string' && f.filename.includes('iabjs://'))) {
                return null
            }
            return event
        },
    })
}

// Resolve + preload the locale BEFORE first render so the UI paints in the
// right language with no flash. English is bundled (no await); fr/vi await one
// dynamic-import chunk. The global edge middleware (rollout) will additionally
// stamp <html lang> / redirect by Accept-Language - this client step keeps the
// SPA correct on every route in the meantime.
async function bootstrap() {
    const locale = resolveInitialLocale()
    if (locale !== 'en') {
        try { await loadLocale(locale) } catch { /* fall back to bundled EN */ }
    }
    if (i18n.language !== locale) await i18n.changeLanguage(locale)
    document.documentElement.lang = locale
    document.documentElement.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'

    createRoot(document.getElementById('root')).render(
        <>
            <App />
            <OpenInAppBanner />
        </>,
    )
}

bootstrap()

} // end if (!IS_BOT)