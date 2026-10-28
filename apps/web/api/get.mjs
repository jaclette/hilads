/**
 * /get — "Download the app" for any device (the web modal's QR code).
 * iPhone → the App Store, Android → Google Play, with the action / city / surface
 * of the query carried in the store link (src/lib/storeLinks.mjs, utm_medium=qr);
 * a link from outside (a story's link sticker) keeps its utm_source, utm_medium
 * and utm_campaign (?utm_source=instagram&utm_medium=story&utm_campaign=halloween);
 * anything else (desktop) → /app, the download page with both badges.
 */
import { storeForAgent, storeLink } from '../src/lib/storeLinks.mjs'

export default function handler(req, res) {
  const q = req.query || {}
  const store = storeForAgent(req.headers['user-agent'] || '')
  const location = store
    ? storeLink(store, { action: q.action || 'play', city: q.city || null, cityId: q.cityId || null, surface: q.surface || null,
        medium: q.utm_medium || 'qr', source: q.utm_source || 'hilads_web', campaign: q.utm_campaign || null })
    : '/app'
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}
