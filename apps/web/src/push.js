import i18n from './i18n'

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

// Mirrors the AUTH_FLAG_KEY constant in App.jsx. Used as a cheap "still
// authenticated?" check between the long async steps of registerPush —
// the user can sign out mid-flight and we'd otherwise hit /push/subscribe
// after the cookie has already been cleared, producing a 401.
const AUTH_FLAG_KEY = 'hilads_has_auth'

// ── Utilities ─────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register the service worker and subscribe to web push.
 * Safe to call after every login — upserts on the backend.
 *
 * @returns {Promise<boolean>} true if subscribed successfully
 */
export async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission === 'denied') return false

  try {
    // 1. Register SW (idempotent — returns existing registration if already active)
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // 2. Wait for SW to become active
    await navigator.serviceWorker.ready

    // 3. Request permission (no-op if already granted/denied)
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()

    if (permission !== 'granted') return false

    // 4. Fetch VAPID public key from backend
    const keyRes = await fetch(`${BASE}/push/vapid-public-key`, { credentials: 'include' })
    if (!keyRes.ok) return false
    const { key } = await keyRes.json()
    if (!key) return false

    // 5. Subscribe (creates a new subscription or returns the existing one)
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })

    // Bail out if the user signed out while we were awaiting permission /
    // VAPID / pushManager.subscribe — POSTing to /push/subscribe with no
    // cookie returns 401 and surfaces in the console.
    if (!localStorage.getItem(AUTH_FLAG_KEY)) return false

    // 6. Store subscription on the backend
    const subRes = await fetch(`${BASE}/push/subscribe`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        locale: i18n.language,
        keys: {
          p256dh: arrayBufferToBase64(sub.getKey('p256dh')),
          auth:   arrayBufferToBase64(sub.getKey('auth')),
        },
      }),
    })
    if (!subRes.ok) return false

    return true
  } catch (err) {
    console.warn('[hilads] push registration failed', err)
    return false
  }
}

/**
 * Unsubscribe from push notifications for this browser.
 * Call on logout.
 */
export async function unregisterPush() {
  if (!('serviceWorker' in navigator)) return

  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    if (!reg) return

    const sub = await reg.pushManager.getSubscription()
    if (!sub) return

    const endpoint = sub.endpoint

    // Unsubscribe in browser first
    await sub.unsubscribe()

    // Then remove from backend (best-effort)
    await fetch(`${BASE}/push/unsubscribe`, {
      method:      'DELETE',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ endpoint }),
    }).catch(() => {})
  } catch (err) {
    console.warn('[hilads] push unregister failed', err)
  }
}
