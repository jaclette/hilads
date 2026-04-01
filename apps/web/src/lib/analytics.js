import posthog from 'posthog-js'

const PLATFORM = 'web'
let _ctx = {}

export function setAnalyticsContext(ctx) {
  _ctx = { ..._ctx, ...ctx }
}

export function track(event, props = {}) {
  posthog.capture(event, { platform: PLATFORM, ..._ctx, ...props })
}

export function identifyUser(id, props = {}) {
  posthog.identify(id, props)
}

export function resetAnalytics() {
  _ctx = {}
  posthog.reset()
}
