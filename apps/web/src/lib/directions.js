/**
 * Directions to a spot (SPEC 9.5, 2026-10-20), never OpenStreetMap: Google
 * Maps by default (its public directions link; it opens the app when
 * installed), Apple Maps offered in iOS browsers. No API key. In iOS browsers
 * the first tap asks (Google Maps or Apple Maps) and the choice is remembered
 * (Me > Directions changes it). Walking under 2 km, driving beyond, when the
 * position is already allowed (never prompts); else the maps app decides.
 */
const KEY = 'hilads_maps_app'
const WALK_MAX_M = 2000
export const MAPS_APP_NAMES = { google: 'Google Maps', apple: 'Apple Maps' }

export const isIosBrowser = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent || '')

/** The apps this browser offers: Google Maps, plus Apple Maps on iOS. */
export const mapsApps = () => (isIosBrowser() ? ['google', 'apple'] : ['google'])

export function getMapsApp() {
  try { const v = localStorage.getItem(KEY); return v === 'google' || v === 'apple' ? v : null } catch { return null }
}

/** null = ask every time. */
export function setMapsApp(app) {
  try { app ? localStorage.setItem(KEY, app) : localStorage.removeItem(KEY) } catch { /* private mode */ }
}

export function directionsLink(app, lat, lng, mode) {
  const ll = `${lat},${lng}`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}${mode ? `&dirflg=${mode === 'walking' ? 'w' : 'd'}` : ''}`
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}${mode ? `&travelmode=${mode}` : ''}`
}

function meters(aLat, aLng, bLat, bLng) {
  const r = (d) => (d * Math.PI) / 180
  const s = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 'walking' / 'driving' from a recent position when location is already granted, else null (no prompt). */
export async function travelMode(lat, lng) {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' })
    if (perm?.state !== 'granted') return null
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 10 * 60_000, timeout: 1500 }))
    return meters(pos.coords.latitude, pos.coords.longitude, lat, lng) < WALK_MAX_M ? 'walking' : 'driving'
  } catch {
    return null
  }
}
