const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

export async function createGuestSession(nickname) {
  const res = await fetch(`${BASE}/guest/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ nickname }),
  })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json()
}

export async function resolveLocation(lat, lng) {
  const res = await fetch(`${BASE}/location/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ lat, lng }),
  })
  if (!res.ok) throw new Error('Failed to resolve location')
  return res.json()
}

export async function fetchMessages(channelId) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json()
}

export async function fetchChannels() {
  const res = await fetch(`${BASE}/channels`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch channels')
  return res.json()
}

export async function sendMessage(channelId, guestId, nickname, content) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname, content }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}