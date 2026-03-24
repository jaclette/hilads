// Hilads service worker — web push + notification click handling
// Scope: root (/) — handles all push notifications for the app

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? {}

  e.waitUntil(
    self.registration.showNotification(d.title || 'Hilads', {
      body:    d.body  || '',
      icon:    '/logo/hilads-icon-128.png',
      badge:   '/logo/hilads-icon-32.png',
      tag:     d.tag   || 'hilads',
      renotify: false,    // replace instead of stacking same-tag notifications
      data:   { url: d.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()

  const targetUrl = e.notification.data?.url || '/'
  const origin    = self.location.origin

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      // If the app is already open in a tab, focus it and send a navigate message
      const existing = cs.find((c) => c.url.startsWith(origin))
      if (existing) {
        existing.focus()
        existing.postMessage({ type: 'navigate', url: targetUrl })
        return
      }
      // App not open — open the target URL directly
      return clients.openWindow(targetUrl)
    })
  )
})
