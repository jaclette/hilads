/**
 * Store links that carry what the visitor was doing on the web (the action,
 * the city, where the tap came from), so the app can later open the same
 * screen once installed. Shared by the web app's "Download the app" modal and
 * /get (api/get.mjs, the QR code's target, imports this file). Plain JS, no imports.
 *
 * - Google Play: everything rides in `referrer` (UTM + hilads_action /
 *   hilads_city), readable by the app through the Play Install Referrer.
 * - App Store: Apple keeps only `ct` (campaign, 40 characters) for App
 *   Analytics; the UTM and deep-link parameters are added too, for our own
 *   logs, and dropped by the store.
 */
export const APP_STORE_URL  = 'https://apps.apple.com/app/id6768905591'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.hilads.app'

/** The store for a user agent: 'ios', 'android', or null (desktop). */
export function storeForAgent(ua = '') {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return null
}

const clean = (v) => (v == null ? '' : String(v).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60))

/**
 * { action, city, cityId, surface, medium, source, campaign } → the store URL for `store`.
 * `source` and `campaign` come from an outside link's UTM (a story's link
 * sticker: /get?utm_source=instagram&utm_medium=story&utm_campaign=halloween).
 */
export function storeLink(store, { action = 'play', city = null, cityId = null, surface = null, medium = 'app_modal', source = 'hilads_web', campaign = null } = {}) {
  const params = {
    utm_source: clean(source),
    utm_medium: clean(medium),
    utm_campaign: clean(campaign || action),
    ...(surface ? { utm_content: clean(surface) } : {}),
    ...(city ? { utm_term: clean(city) } : {}),
    hilads_action: clean(action),
    ...(cityId ? { hilads_city: clean(cityId) } : {}),
  }
  const query = new URLSearchParams(params).toString()
  if (store === 'android') return `${PLAY_STORE_URL}&referrer=${encodeURIComponent(query)}`
  const ct = (campaign ? [clean(source), clean(medium), clean(campaign)] : [clean(action), clean(surface), clean(city)]).filter(Boolean).join('_').slice(0, 40)
  return `${APP_STORE_URL}?mt=8&ct=${encodeURIComponent(ct)}&${query}`
}

/** hilads.live/get with the same context (the desktop QR code). */
export function getLink({ action = 'play', city = null, cityId = null, surface = null } = {}) {
  const q = new URLSearchParams({ action: clean(action), ...(city ? { city: clean(city) } : {}), ...(cityId ? { cityId: clean(cityId) } : {}), ...(surface ? { surface: clean(surface) } : {}) })
  return `https://hilads.live/get?${q.toString()}`
}
