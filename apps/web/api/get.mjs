/**
 * /get — "Download the app" for any device (the web modal's QR code).
 * iPhone → the App Store, Android → Google Play, with the action / city / surface
 * of the query carried in the store link (src/lib/storeLinks.mjs, utm_medium=qr);
 * anything else (desktop) → /app, the download page with both badges.
 */
import { storeForAgent, storeLink } from '../src/lib/storeLinks.mjs'

export default function handler(req, res) {
  const q = req.query || {}
  const store = storeForAgent(req.headers['user-agent'] || '')
  const location = store
    ? storeLink(store, { action: q.action || 'play', city: q.city || null, cityId: q.cityId || null, surface: q.surface || null, medium: 'qr' })
    : '/app'
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}
