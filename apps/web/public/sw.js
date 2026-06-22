// Hilads service worker - web push + notification click/action handling
// Scope: root (/) - handles all push notifications for the app

// Production API base. Web push only runs over HTTPS in production, where the
// app lives at hilads.live and the API at api.hilads.live.
const API_BASE = 'https://api.hilads.live/api/v1'

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? {}

  const options = {
    body:     d.body  || '',
    icon:     '/logo/hilads-icon-128.png',
    badge:    '/logo/hilads-icon-32.png',
    tag:      d.tag   || 'hilads',
    renotify: false,    // replace instead of stacking same-tag notifications
    // Carry the IDs the action handler needs to call the API on Accept/Decline.
    data: { url: d.url || '/', type: d.type, requestId: d.requestId, topicId: d.topicId, challengeId: d.challengeId },
  }
  // Accept/Decline buttons for actionable requests (browser support permitting).
  if (Array.isArray(d.actions) && d.actions.length) options.actions = d.actions

  e.waitUntil(self.registration.showNotification(d.title || 'Hilads', options))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()

  const data   = e.notification.data || {}
  const action = e.action

  // "Accept the challenge" on a new-challenge offer → take it on, then open
  // the challenge so the user lands on it.
  if (action === 'accept'
      && (data.type === 'challenge_international_target' || data.type === 'new_challenge')
      && data.challengeId) {
    e.waitUntil(acceptChallengeAndOpen(data))
    return
  }

  // Accept / Decline directly from the notification - no need to open the app.
  if (action === 'accept' || action === 'decline') {
    e.waitUntil(handleAction(data, action))
    return
  }

  // Plain tap → focus the open tab (or open one) at the target URL.
  const targetUrl = data.url || '/'
  const origin    = self.location.origin
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const existing = cs.find((c) => c.url.startsWith(origin))
      if (existing) {
        existing.focus()
        existing.postMessage({ type: 'navigate', url: targetUrl })
        return
      }
      return clients.openWindow(targetUrl)
    })
  )
})

// Call the accept/decline endpoint for a friend or hangout request. Cookie auth
// is sent via credentials:'include' (same as the app's API calls). Best-effort:
// failures are swallowed; any open tab is told to refresh its request lists.
async function handleAction(data, action) {
  try {
    if (data.type === 'friend_request_received' && data.requestId) {
      const path = action === 'accept' ? 'accept' : 'decline'
      await fetch(`${API_BASE}/friend-requests/${data.requestId}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } else if (data.type === 'join_request' && data.topicId && data.requestId) {
      await fetch(`${API_BASE}/topics/${data.topicId}/join-requests/${data.requestId}/resolve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action === 'accept' ? 'accept' : 'reject' }),
      })
    }
  } catch (_) { /* best-effort */ }

  const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  cs.forEach((c) => c.postMessage({ type: 'notification-action', action, data }))
}

// Take on a new challenge from its push, then focus/open the challenge page.
// Best-effort accept (cookie auth, same as the app); the user still lands on
// the challenge and can take it on manually if the call didn't go through.
async function acceptChallengeAndOpen(data) {
  try {
    await fetch(`${API_BASE}/challenges/${data.challengeId}/accept`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch (_) { /* best-effort */ }

  const url    = data.url || `/challenge/${data.challengeId}`
  const origin = self.location.origin
  const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = cs.find((c) => c.url.startsWith(origin))
  if (existing) {
    existing.focus()
    existing.postMessage({ type: 'navigate', url })
    return
  }
  return clients.openWindow(url)
}
