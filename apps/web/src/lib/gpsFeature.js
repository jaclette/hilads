import { track } from './analytics'

/**
 * Request the browser location for a SPECIFIC feature, at the moment the user
 * activates it - never up-front. Emits the per-feature PostHog funnel so we can
 * measure permission rates per feature and see which features fail on denial.
 *
 * Behaviour (matches the app-wide GPS rules):
 *  - Reuse-granted: if permission is already granted, getCurrentPosition returns
 *    silently with no dialog.
 *  - Don't nag: if permission is already denied (Permissions API), fail fast
 *    without triggering another (no-op) prompt.
 *  - Graceful: the caller decides how to degrade; this only reports the outcome.
 *
 * @param {string} feature  share_spot | event_location | hi_now | people_nearby | challenge_proof | checkin
 * @returns {Promise<{ok:true, coords:{lat:number,lng:number}} | {ok:false, reason:'unsupported'|'denied'|'error'|'timeout'}>}
 */
export async function requestFeatureLocation(feature, { timeout = 10000 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, reason: 'unsupported' }
  }

  // Don't nag a previously-denied user: fail fast without a (no-op) prompt.
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' })
      if (st.state === 'denied') {
        track('gps_permission_denied', { feature, reason: 'previously_denied' })
        return { ok: false, reason: 'denied' }
      }
    }
  } catch { /* Permissions API absent → fall through to getCurrentPosition */ }

  track('gps_permission_requested', { feature })
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        track('gps_permission_granted', { feature })
        resolve({ ok: true, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } })
      },
      (err) => {
        if (err && err.code === 1) {
          track('gps_permission_denied', { feature })
          resolve({ ok: false, reason: 'denied' })
        } else {
          // POSITION_UNAVAILABLE (2) / TIMEOUT (3): permission wasn't the blocker.
          resolve({ ok: false, reason: err && err.code === 3 ? 'timeout' : 'error' })
        }
      },
      { timeout },
    )
  })
}
