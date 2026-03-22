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

export async function joinChannel(channelId, sessionId, guestId, nickname, previousChannelId = null) {
  const body = { sessionId, guestId, nickname }
  if (previousChannelId) body.previousChannelId = previousChannelId
  const res = await fetch(`${BASE}/channels/${channelId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to join channel')
  return res.json()
}

export async function leaveChannel(channelId, sessionId) {
  const res = await fetch(`${BASE}/channels/${channelId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) throw new Error('Failed to leave channel')
  return res.json()
}

export async function heartbeat(channelId, sessionId, guestId, nickname) {
  const res = await fetch(`${BASE}/channels/${channelId}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId, guestId, nickname }),
  })
  if (!res.ok) throw new Error('Failed to send heartbeat')
  return res.json()
}

export function disconnectBeacon(sessionId) {
  // sendBeacon is fire-and-forget, reliable on page unload
  const payload = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' })
  navigator.sendBeacon(`${BASE}/disconnect`, payload)
}

export async function fetchChannels() {
  const res = await fetch(`${BASE}/channels`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch channels')
  return res.json()
}

export async function sendMessage(channelId, sessionId, guestId, nickname, content) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId, guestId, nickname, content }),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}

export async function uploadImage(file) {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type header — browser sets it automatically with the multipart boundary
  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Upload failed')
  }
  return res.json() // { url, filename }
}

export async function sendImageMessage(channelId, sessionId, guestId, nickname, imageUrl) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId, guestId, nickname, type: 'image', imageUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send image')
  }
  return res.json()
}

export async function fetchEvents(channelId) {
  const res = await fetch(`${BASE}/channels/${channelId}/events`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

export async function fetchCityEvents(channelId) {
  const res = await fetch(`${BASE}/channels/${channelId}/city-events`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch city events')
  return res.json()
}

export async function createEvent(channelId, guestId, nickname, title, locationHint, startsAt, type) {
  const body = { guestId, nickname, title, starts_at: startsAt, type }
  if (locationHint) body.location_hint = locationHint
  const res = await fetch(`${BASE}/channels/${channelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create event')
  }
  return res.json()
}

export async function fetchEventMessages(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}/messages`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch event messages')
  return res.json()
}

export async function fetchEventParticipants(eventId, sessionId) {
  const res = await fetch(`${BASE}/events/${eventId}/participants?sessionId=${sessionId}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch participants')
  return res.json() // { count, isIn }
}

export async function toggleEventParticipation(eventId, sessionId) {
  const res = await fetch(`${BASE}/events/${eventId}/participants/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) throw new Error('Failed to toggle participation')
  return res.json() // { count, isIn }
}

export async function sendEventMessage(eventId, guestId, nickname, content) {
  const res = await fetch(`${BASE}/events/${eventId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname, content }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send message')
  }
  return res.json()
}
