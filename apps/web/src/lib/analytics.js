import posthog from 'posthog-js'

const PLATFORM = 'web'

export function track(event, props = {}) {
  posthog.capture(event, { platform: PLATFORM, ...props })
}

export function identifyUser(id, props = {}) {
  posthog.identify(id, props)
}
