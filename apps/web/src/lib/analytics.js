import posthog from 'posthog-js'

const PLATFORM = 'web'
let _ctx = {}

export function setAnalyticsContext(ctx) {
  _ctx = { ..._ctx, ...ctx }
}

// Immediate capture — use only for interaction events (button taps, sends, etc.)
// where the timing precision matters.
export function track(event, props = {}) {
  posthog.capture(event, { platform: PLATFORM, ..._ctx, ...props })
}

// Deferred capture — fires on the next idle callback (requestIdleCallback with
// 2 s timeout fallback, or setTimeout(0) on Safari). Use for non-critical events
// that happen during screen transitions so they don't compete with API calls.
const _ric = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
  ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
  : (fn) => setTimeout(fn, 0)

export function trackDeferred(event, props = {}) {
  const snapshot = { ..._ctx }   // capture context at call-time, not callback-time
  _ric(() => posthog.capture(event, { platform: PLATFORM, ...snapshot, ...props }))
}

export function identifyUser(id, props = {}) {
  posthog.identify(id, props)
}

export function resetAnalytics() {
  _ctx = {}
  posthog.reset()
}
