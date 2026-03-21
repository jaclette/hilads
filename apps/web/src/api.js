const BASE = '/api/v1'

export async function createGuestSession() {
  const res = await fetch(`${BASE}/guest/session`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json()
}

export async function resolveLocation(lat, lng) {
  const res = await fetch(`${BASE}/location/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  })
  if (!res.ok) throw new Error('Failed to resolve location')
  return res.json()
}

export async function fetchMessages(channelId) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`)
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json()
}

export async function sendMessage(channelId, guestId, content) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, content }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}
