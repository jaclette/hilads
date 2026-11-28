import { withPosthog } from './posthogQueue'

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
/** The entry's UTM params and share link, for the sign-up's `source`. */
export function signupSource() {
  try {
    const utm = JSON.parse(sessionStorage.getItem('hilads_utm') || 'null')
    const share = sessionStorage.getItem('hilads_share')
    return { ...(utm ? { utm } : {}), ...(share ? { share } : {}) }
  } catch { return {} }
}

export function captureUtm() {
  try {
    const p = new URLSearchParams(window.location.search)
    const out = {}
    for (const k of UTM_KEYS) {
      const v = p.get(k)
      if (v) out[k] = v
    }
    if (Object.keys(out).length) {
      withPosthog(ph => { if (typeof ph.register === 'function') ph.register(out) })
      // Kept for the sign-up's source (Back office › a user's Sign-up), this browser session.
      try { sessionStorage.setItem('hilads_utm', JSON.stringify(out)) } catch { /* private mode */ }
    }
    // A share link that brought this visitor (a photo, a challenge, a city): its path, for the sign-up.
    try {
      if (/^\/(p|s|d|challenge|c)\//.test(window.location.pathname) || p.get('from')) {
        sessionStorage.setItem('hilads_share', (window.location.pathname + (p.get('from') ? `?from=${p.get('from')}` : '')).slice(0, 200))
      }
    } catch { /* private mode */ }
    return out
  } catch {
    return {}
  }
}
