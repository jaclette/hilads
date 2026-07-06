import posthog from 'posthog-js'

// Ad-attribution params we care about from the entry URL (Instagram/TikTok/Google).
const UTM_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'ttclid', 'ref',
]

/**
 * Capture ad attribution from the ENTRY URL and register it as PostHog super
 * properties, so every subsequent event (through anonymous_join_completed)
 * carries the utm_* - letting us attribute the whole funnel to a creative.
 * Best-effort; returns the captured params (also handy for landing_view).
 */
export function captureUtm() {
  try {
    const p = new URLSearchParams(window.location.search)
    const out = {}
    for (const k of UTM_KEYS) {
      const v = p.get(k)
      if (v) out[k] = v
    }
    if (Object.keys(out).length && typeof posthog.register === 'function') {
      posthog.register(out)
    }
    return out
  } catch {
    return {}
  }
}
