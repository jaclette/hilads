const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

// ── Deep link resolution ───────────────────────────────────────────────────────

export async function fetchVenue(venueId) {
  const res = await fetch(`${BASE}/venues/${encodeURIComponent(venueId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch venue')
  const data = await res.json()
  return data.venue
}

export async function fetchCityVenues(slug) {
  const res = await fetch(`${BASE}/cities/${encodeURIComponent(slug)}/venues`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error('Failed to fetch venues')
  const data = await res.json()
  return data.venues ?? []
}

export async function fetchCityBySlug(slug) {
  const res = await fetch(`${BASE}/cities/by-slug/${encodeURIComponent(slug)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to resolve city slug')
  return res.json() // { channelId, city, country, timezone, slug }
}

export async function fetchEventById(eventId) {
  const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch event')
  return res.json() // { event, cityName, country, timezone }
}

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

// Optional `country` (ISO-2) lets the backend constrain nearest-city to the
// same country, preventing cross-border snaps. The caller is expected to
// resolve it via Nominatim (see reverseGeocodeCountry in App.jsx). When
// omitted/null, backend falls back to global nearest.
export async function resolveLocation(lat, lng, country) {
  const body = country ? { lat, lng, country } : { lat, lng }
  const res = await fetch(`${BASE}/location/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to resolve location')
  return res.json()
}

// Lightweight country-only reverse-geocode via Nominatim (zoom=3 = country
// level - fast, no city lookup). Returns ISO-2 uppercase or null on any
// failure. Caller passes the result straight into resolveLocation; failure
// is non-fatal - backend uses global nearest when country is absent.
export async function reverseGeocodeCountry(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`,
      { headers: { 'Accept-Language': 'en' } },
    )
    if (!res.ok) return null
    const data = await res.json()
    const cc = data?.address?.country_code
    return cc ? cc.toUpperCase() : null
  } catch {
    return null
  }
}

export async function fetchMessages(channelId, { beforeId, limit } = {}) {
  const params = new URLSearchParams()
  if (limit)    params.set('limit', limit)
  if (beforeId) params.set('before_id', beforeId)
  const qs  = params.size ? '?' + params : ''
  const res = await fetch(`${BASE}/channels/${channelId}/messages${qs}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json() // { messages, hasMore, onlineUsers, onlineCount }
}

// Lean messages fetch - skips presence + badge enrichment on the server.
// Used as one half of the parallel join+messages critical path.
// Badges are enriched deferred via fetchMessageBadges after first render.
export async function fetchLeanMessages(channelId, { beforeId, limit = 50 } = {}) {
  const params = new URLSearchParams({ lean: '1', limit: String(limit) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/channels/${channelId}/messages?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json() // { messages, hasMore }
}

// POST /me/city - commit a manual city switch as users.current_city_id.
// Backend bypasses the two-signal rule and sets the city immediately. Errors
// are swallowed: the local UI switch is the source of truth for this frame;
// the next /location/resolve will reconcile if the backend write failed.
export async function setCurrentCity(channelId) {
  try {
    const res = await fetch(`${BASE}/me/city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ channelId }),
    })
    if (!res.ok) console.warn('[me/city] non-ok', res.status)
  } catch (err) {
    console.warn('[me/city] failed', err)
  }
}

export async function joinChannel(channelId, sessionId, guestId, nickname, previousChannelId = null) {
  const body = { sessionId, guestId, nickname }
  if (previousChannelId) body.previousChannelId = previousChannelId
  const res = await fetch(`${BASE}/channels/${channelId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Platform': 'web' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to join channel')
  return res.json()
}

export async function bootstrapChannel(channelId, sessionId, guestId, nickname, previousChannelId = null) {
  const body = { sessionId, guestId, nickname }
  if (previousChannelId) body.previousChannelId = previousChannelId
  // lean=1: skip badge enrichment + auth queries on the critical path.
  // Web fetches badges via fetchMessageBadges after first render.
  const res = await fetch(`${BASE}/channels/${channelId}/bootstrap?lean=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Platform': 'web' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to bootstrap channel')
  const data = await res.json()
  return {
    joinMessage:         data.joinMessage         ?? null,
    messages:            data.messages            ?? [],
    hasMore:             data.hasMore             ?? false,
    onlineUsers:         data.onlineUsers         ?? [],
    onlineCount:         data.onlineCount         ?? 0,
    hasUnreadDMs:        data.hasUnreadDMs        ?? null,
    unreadNotifications: data.unreadNotifications ?? null,
  }
}

// Fetches badge data for registered message authors - called after first render
// to enrich the chat feed without blocking the initial bootstrap.
export async function fetchMessageBadges(channelId, userIds) {
  if (!userIds || userIds.length === 0) return {}
  const qs = userIds.map(id => `ids[]=${encodeURIComponent(id)}`).join('&')
  try {
    const res = await fetch(`${BASE}/channels/${channelId}/message-badges?${qs}`, {
      credentials: 'include',
    })
    if (!res.ok) return {}
    const data = await res.json()
    return data.badges ?? {}
  } catch {
    return {}
  }
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

export async function fetchChannels(sort = null) {
  const url = sort ? `${BASE}/channels?sort=${encodeURIComponent(sort)}` : `${BASE}/channels`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch channels')
  return res.json()
}

export async function sendMessage(channelId, sessionId, guestId, nickname, content, replyToMessageId = null, mentions = null) {
  const body = { sessionId, guestId, nickname, content }
  if (replyToMessageId) body.replyToMessageId = replyToMessageId
  if (mentions && mentions.length) body.mentions = mentions
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to send message')
  return res.json()
}

export async function uploadImage(file) {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type header - browser sets it automatically with the multipart boundary
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

export async function fetchEvents(channelId, sessionId = null) {
  const url = sessionId
    ? `${BASE}/channels/${channelId}/events?sessionId=${sessionId}`
    : `${BASE}/channels/${channelId}/events`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

export async function fetchCityAmbassadors(channelId) {
  try {
    const res = await fetch(`${BASE}/channels/${channelId}/ambassadors`, { credentials: 'include' })
    if (!res.ok) return { ambassadors: [] }
    return res.json() // { ambassadors: UserDTO[] }
  } catch {
    return { ambassadors: [] }
  }
}

export async function fetchCityMembers(channelId, { page = 1, limit = 10, badge = null, vibe = null, mode = null } = {}) {
  const q = new URLSearchParams({ page, limit })
  if (badge) q.set('badge', badge)
  if (vibe)  q.set('vibe',  vibe)
  if (mode)  q.set('mode',  mode)
  const res = await fetch(`${BASE}/channels/${channelId}/members?${q}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch city members')
  return res.json() // { members, total, page, hasMore }
}

export async function fetchCityEvents(channelId) {
  const res = await fetch(`${BASE}/channels/${channelId}/city-events`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch city events')
  return res.json()
}

export async function fetchCityTopics(channelId) {
  try {
    const res = await fetch(`${BASE}/channels/${channelId}/topics`, { credentials: 'include' })
    if (!res.ok) return { topics: [] }
    return res.json()
  } catch {
    return { topics: [] }
  }
}

// ── Normalized now feed ────────────────────────────────────────────────────────
// GET /channels/{id}/now → { items: FeedItem[] }
// Returns a mixed, sorted feed of Hilads events + active topics.
// Both events and topics share consistent top-level fields (kind, title,
// description, active_now, …). Pass sessionId so the backend can annotate
// is_participating on event items.
export async function fetchNowFeed(channelId, sessionId = null, { signal } = {}) {
  try {
    const params = new URLSearchParams()
    if (sessionId) params.set('sessionId', sessionId)
    const qs = params.toString()
    const url = `${BASE}/channels/${channelId}/now${qs ? `?${qs}` : ''}`
    const res = await fetch(url, { credentials: 'include', signal: signal ?? undefined })
    if (!res.ok) return { items: [] }
    return res.json() // { items: FeedItem[] }
  } catch {
    return { items: [] }
  }
}

export async function fetchTopicById(topicId) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch topic')
  return res.json() // { topic, channelId, cityName, country, timezone }
}

export async function fetchTopicMessages(topicId, { beforeId, limit } = {}) {
  const params = new URLSearchParams({ limit: String(limit ?? 50) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/messages?${params}`, { credentials: 'include' })
  // Members-only: a non-member (incl. pending requester) gets 403 - surface it
  // so the page shows the gated "request pending" state instead of erroring.
  // has_pending_request lets the gate render "Requested" on a return visit.
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    return { messages: [], hasMore: false, forbidden: true, hasPendingRequest: !!body.has_pending_request }
  }
  if (!res.ok) throw new Error('Failed to fetch topic messages')
  return res.json() // { messages, hasMore }
}

// ── Hangout request-to-join (internally "topic") ──────────────────────────────

export async function requestToJoinHangout(topicId) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/join-requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}',
  })
  const data = await res.json().catch(() => ({}))
  return { status: data.status ?? (res.ok ? 'pending' : 'error'), requestId: data.requestId }
}

export async function resolveHangoutJoinRequest(topicId, requestId, action) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/join-requests/${encodeURIComponent(requestId)}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ action }),
  })
  const data = await res.json().catch(() => ({}))
  return { status: data.status ?? (res.ok ? action : 'error'), resolvedByName: data.resolvedByName }
}

export async function sendTopicMessage(topicId, guestId, nickname, content, mentions = null) {
  const body = { guestId, nickname, content }
  if (mentions && mentions.length) body.mentions = mentions
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send message')
  }
  return res.json() // { message }
}

export async function sendTopicImageMessage(topicId, guestId, nickname, imageUrl) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname, type: 'image', imageUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send image')
  }
  return res.json() // { message }
}

export async function markTopicRead(topicId, guestId) {
  await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/mark-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  }).catch(() => {})
}

export async function createTopic(channelId, guestId, title, description, category, coords = null) {
  const body = { guestId, title, description: description || null, category }
  // Hangouts have no address - send the creator's coords so NOW can show distance.
  if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
    body.lat = coords.lat
    body.lng = coords.lng
  }
  const res = await fetch(`${BASE}/channels/${channelId}/topics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (data.error === 'hangout_limit') throw new HangoutLimitError(data.existingTopicId, data.existingTitle)
    throw new Error(data.error || 'Failed to create topic')
  }
  return data
}

// Thrown by createTopic when the user already has an active hangout (one at a time).
export class HangoutLimitError extends Error {
  constructor(existingTopicId, existingTitle) {
    super('hangout_limit')
    this.name = 'HangoutLimitError'
    this.existingTopicId = existingTopicId
    this.existingTitle = existingTitle
  }
}

// Full member list for a hangout (avatar-row modal). Returns { participants, count }.
export async function fetchHangoutParticipants(topicId) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}/participants`, { credentials: 'include' })
  if (!res.ok) return { participants: [], count: 0 }
  return res.json()
}

// Owner-only edit of a hangout's title/description/category.
export async function updateTopic(topicId, guestId, title, description, category) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, title, description: description || null, category }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to update hangout')
  return data
}

// Owner-only delete (soft) of a hangout.
export async function deleteTopic(topicId, guestId) {
  const res = await fetch(`${BASE}/topics/${encodeURIComponent(topicId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete hangout')
  }
}

// ── Challenges (Défis) ────────────────────────────────────────────────────────
// Third primary entity alongside events + hangouts. Persistent (no TTL), with
// an `open` → `validated` lifecycle. Web client supports: read, accept/leave,
// validate (creator), chat. Edit/delete stay mobile-only for now.

export async function fetchChallengeById(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch challenge')
  return res.json() // { challenge, channelId, cityName, country, timezone }
}

export async function fetchCityChallenges(channelId, limit = 50) {
  const res = await fetch(`${BASE}/channels/${encodeURIComponent(channelId)}/challenges?limit=${limit}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.challenges ?? []
}

// Read-only "idea book" for the zero-challenge empty state: up to 3 example
// challenges from the most-active OTHER city. The payload carries NO challenge
// id (title/type/creator only), so nothing here can open or take the remote
// challenge. Returns { city, cityId, examples }; empty list on error / when no
// other city qualifies.
export async function fetchChallengeInspiration(excludeChannelId) {
  const empty = { city: null, cityId: null, examples: [] }
  try {
    const res = await fetch(`${BASE}/challenges/inspiration?excludeChannelId=${encodeURIComponent(excludeChannelId)}`)
    if (!res.ok) return empty
    const data = await res.json()
    return { city: data.city ?? null, cityId: data.cityId ?? null, examples: data.examples ?? [] }
  } catch {
    return empty
  }
}

// Read-only "idea book" for the zero-activity events empty state: up to 3
// example hangouts/events from the most-active OTHER city. The payload carries
// NO event id (kind/title/host only), so nothing here can open or join the
// remote event. Returns { city, cityId, examples }; empty list on error / when
// no other city qualifies.
export async function fetchEventInspiration(excludeChannelId) {
  const empty = { city: null, cityId: null, examples: [] }
  try {
    const res = await fetch(`${BASE}/events/inspiration?excludeChannelId=${encodeURIComponent(excludeChannelId)}`)
    if (!res.ok) return empty
    const data = await res.json()
    return { city: data.city ?? null, cityId: data.cityId ?? null, examples: data.examples ?? [] }
  } catch {
    return empty
  }
}

export async function fetchValidatedChallenges(channelId, { limit = 30, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', String(before))
  const res = await fetch(`${BASE}/channels/${encodeURIComponent(channelId)}/challenges/validated?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.challenges ?? []
}

export async function fetchChallengeMessages(challengeId, { beforeId, limit } = {}) {
  const params = new URLSearchParams({ limit: String(limit ?? 50) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/messages?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch challenge messages')
  return res.json() // { messages, hasMore }
}

export async function sendChallengeMessage(challengeId, guestId, nickname, content, replyToMessageId = null, mentions = null) {
  const body = { guestId, nickname, content }
  if (replyToMessageId) body.replyToMessageId = replyToMessageId
  if (mentions && mentions.length) body.mentions = mentions
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send message')
  }
  return res.json()
}

export async function sendChallengeImageMessage(challengeId, guestId, nickname, imageUrl) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname, type: 'image', imageUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send image')
  }
  return res.json()
}

export async function fetchChallengeParticipants(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/participants`)
  if (!res.ok) return { participants: [], count: 0 }
  return res.json() // { participants, count }
}

export async function toggleChallengeParticipation(challengeId, guestId, nickname = null) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/participants/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to toggle participation')
  }
  return res.json() // { count, isIn }
}

// Optional `intl` carries International-mode fields: targetCityChannelId,
// proofRequirements. Mode itself is not editable - delete + recreate. The
// server ignores both fields on Local rows.
export async function updateChallenge(challengeId, guestId, title, challengeType, audience, returnClause, intl = {}) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      guestId, title, challengeType, audience, returnClause,
      targetCityChannelId: intl.targetCityChannelId ?? null,
      proofRequirements:   intl.proofRequirements ?? null,
      // 'public' | 'friends' only; null/omitted = don't change. The server
      // enforces "private not at input" - it's only reachable via the mutual
      // privacy flow.
      visibility:          intl.visibility ?? null,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to update challenge')
    err.code   = data.code  || null
    err.field  = data.field || null
    throw err
  }
  return res.json()
}

export async function deleteChallenge(challengeId, guestId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete challenge')
  }
}

// Optional `intl` carries International-mode fields: mode, targetCityChannelId,
// proofRequirements. Server defaults mode to 'local' when omitted; Local rows
// ignore the other two.
export async function createChallenge(channelId, guestId, nickname, title, challengeType, audience, returnClause, intl = {}) {
  const res = await fetch(`${BASE}/channels/${encodeURIComponent(channelId)}/challenges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      guestId, nickname, title, challengeType, audience, returnClause,
      mode:                intl.mode ?? 'local',
      targetCityChannelId: intl.targetCityChannelId ?? null,
      proofRequirements:   intl.proofRequirements ?? null,
      // Validation method: local-only choice ('meet' | 'photo_proof').
      // Server forces 'photo_proof' on International rows regardless.
      validationMethod:    intl.validationMethod ?? null,
      // 'public' | 'friends' only at create-time. Server forces 'public'
      // on International rows regardless of what we send.
      visibility:          intl.visibility ?? 'public',
      // Group model: a local MEET challenge with format='group' carries a meet
      // date + location set at creation.
      format:              intl.format     ?? 'legacy',
      meetAt:              intl.meetAt      ?? null,
      meetEndsAt:          intl.meetEndsAt  ?? null,
      venue:               intl.venue       ?? null,
      venueLat:            intl.venueLat    ?? null,
      venueLng:            intl.venueLng    ?? null,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to create challenge')
    err.code   = data.code  || null
    err.field  = data.field || null
    throw err
  }
  return res.json() // newly-created Challenge object
}

// Flip users.has_seen_public_optin to TRUE so the first-time public modal
// stops showing. Server returns { ok, hasSeenPublicOptin }.
export async function dismissPublicOptin() {
  const res = await fetch(`${BASE}/me/dismiss-public-optin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to dismiss opt-in')
  }
  return res.json()
}

export async function validateChallenge(challengeId, guestId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to validate challenge')
  }
  return res.json() // updated challenge object
}

// GROUP challenges: the challenger validates who was present at the meet.
// presentUserIds = the joined takers who showed up. Returns the count + ids.
export async function validatePresence(challengeId, presentUserIds) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/validate-presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ presentUserIds }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to validate presence')
  }
  return res.json() // { ok, present_count, present_ids }
}

export async function unvalidateChallenge(challengeId, guestId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/unvalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to unvalidate challenge')
  }
  return res.json()
}

// ── PR2 take-on flow ──────────────────────────────────────────────────────────

/** Typed error from POST /accept - carries the backend `code` + (sometimes)
 *  `requiredMode` so UI can show a tailored alert + offer a mode-switch. */
export class AcceptChallengeError extends Error {
  constructor(code, message, requiredMode) {
    super(message)
    this.name = 'AcceptChallengeError'
    this.code = code           // 'not_creator' | 'mode_required' | 'mode_mismatch' | 'cap_reached' (legacy) | 'in_progress'
    this.requiredMode = requiredMode  // 'local' | 'exploring' | undefined
  }
}

export async function acceptChallenge(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (data?.code) throw new AcceptChallengeError(data.code, data.error || 'Accept failed', data.required_mode)
    throw new Error(data?.error || `Accept failed (HTTP ${res.status})`)
  }
  return res.json()  // ChallengeAcceptance row
}

// ── International - proof submission ────────────────────────────────────────

export async function fetchProofs(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/proofs`, {
    credentials: 'include',
  })
  if (!res.ok) return { proofs: [], attempts: 0, maxAttempts: 3 }
  return res.json()
}

// PR59 - lat/lng are optional. The proof flow no longer prompts for
// geolocation; the server stubs 0/0 + marks the row verified when no
// coords are sent. Existing callers passing { lat, lng } still work.
export async function submitProof(acceptanceId, { mediaUrl, mediaType, lat, lng }) {
  const payload = { mediaUrl, mediaType }
  if (typeof lat === 'number' && typeof lng === 'number') {
    payload.lat = lat
    payload.lng = lng
  }
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/submit-proof`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to submit proof')
  }
  return res.json() // { proof, attempt, maxAttempts }
}

export async function approveProof(proofId) {
  const res = await fetch(`${BASE}/proofs/${encodeURIComponent(proofId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to approve proof')
  }
  return res.json() // { proof }
}

export async function rejectProof(proofId, reason) {
  const res = await fetch(`${BASE}/proofs/${encodeURIComponent(proofId)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to reject proof')
  }
  return res.json() // { proof, isFinal, attemptsLeft }
}

// ── Personal challenge invitations ──────────────────────────────────────────

export async function inviteToChallenge(challengeId, userIds) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ userIds }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || `Invite failed (HTTP ${res.status})`)
  }
  return res.json() // { invited: [...], count, duplicates }
}

export async function acceptInvitation(invitationId) {
  const res = await fetch(`${BASE}/invitations/${encodeURIComponent(invitationId)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  // Don't throw on 403 - the gate codes (in_progress / mode_mismatch) are
  // meaningful state the caller wants to surface.
  return res.json().catch(() => ({}))
}

export async function ignoreInvitation(invitationId) {
  await fetch(`${BASE}/invitations/${encodeURIComponent(invitationId)}/ignore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
}

export async function cancelAcceptance(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to cancel')
  }
}

export async function fetchMyAcceptances() {
  const res = await fetch(`${BASE}/me/acceptances`, { credentials: 'include' })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({}))
  return data.threads ?? []
}

// ── PR6: rate-prompts + ratings ──────────────────────────────────────────────

/**
 * Caller's currently rate-eligible meet-ups. Returns [] on network error so
 * the banner just doesn't render (non-blocking surface).
 */
export async function fetchRatePrompts() {
  const res = await fetch(`${BASE}/me/rate-prompts`, { credentials: 'include' })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({}))
  return data.prompts ?? []
}

/**
 * Submit a rating for a challenge. Throws an Error tagged with .status so the
 * UI can branch on 409 (already_rated) / 403 (not_rate_eligible) - both
 * recoverable races: dismiss + refetch the prompts list.
 */
export async function submitRating(challengeId, stars, comment) {
  const body = { stars }
  if (comment && comment.length > 0) body.comment = comment
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data?.error || 'Failed to submit rating')
    err.status = res.status
    err.code   = data?.code
    throw err
  }
  return res.json()
}

// ── PR17: score celebration popin ───────────────────────────────────────────

/**
 * Pending "+X points!" celebration delta. Returns { points: 0 } when there's
 * nothing to show (no unacknowledged events) or on network error.
 *
 * Response (when points > 0):
 *   {
 *     points:        number,
 *     event_count:   number,
 *     top_kind:      'accepted'|'date_locked'|'meetup'|'debrief'|'ghost'|null,
 *     seen_until:    string,        // ISO - pass back to ackScoreCelebration
 *     city_id:       string|null,
 *     city_name:     string|null,
 *     city_country:  string|null,   // ISO-2 country, fed into countryToFlag
 *     top_n:         number,        // 100 - beyond this rank is null
 *     rank_alltime:  { city: number|null, global: number|null },
 *     rank_month:    { city: number|null, global: number|null },
 *   }
 */
export async function fetchScoreCelebration() {
  try {
    const res = await fetch(`${BASE}/me/score-celebration`, { credentials: 'include' })
    if (!res.ok) return { points: 0 }
    return await res.json().catch(() => ({ points: 0 }))
  } catch {
    return { points: 0 }
  }
}

/**
 * Ack the celebration so the same delta is never shown twice. seen_until is
 * the ISO timestamp returned by the GET above. Fire-and-forget - failure is
 * harmless (worst case the popin re-shows next launch).
 */
export async function ackScoreCelebration(seenUntil) {
  try {
    await fetch(`${BASE}/me/score-celebration/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ seen_until: seenUntil }),
    })
  } catch {
    /* non-blocking */
  }
}

// ── PR7: leaderboard ────────────────────────────────────────────────────────

/**
 * Fetch the leaderboard for a given scope/period.
 *
 * Returns null on network error so the caller (header chip / screen) can
 * render a neutral state without throwing. The chip uses this to silently
 * fall back to "🏆 Top challengers".
 *
 * opts = { scope: 'city'|'world', period: 'month'|'alltime',
 *          limit?: number, offset?: number, cityId?: string }
 */
export async function fetchLeaderboard(opts) {
  const params = new URLSearchParams({
    scope:  opts.scope,
    period: opts.period,
    limit:  String(opts.limit  ?? 50),
    offset: String(opts.offset ?? 0),
  })
  if (opts.cityId) params.set('city_id', opts.cityId)
  try {
    const res = await fetch(`${BASE}/leaderboard?${params}`, { credentials: 'include' })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.warn('[fetchLeaderboard] failed:', err)
    return null
  }
}

// Deprecated - kept for the historic mobile build still on the prior
// release. New code uses fetchChallengeMessages on the public challenge
// channel; thread channels are no longer auto-created on accept.
export async function fetchThreadMessages(threadChannelId, { beforeId, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/threads/${encodeURIComponent(threadChannelId)}/messages?${params}`, { credentials: 'include' })
  if (!res.ok) return { messages: [], hasMore: false }
  return res.json()
}

export async function sendThreadMessage(threadChannelId, content) {
  const res = await fetch(`${BASE}/threads/${encodeURIComponent(threadChannelId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ type: 'text', content }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to send message')
  }
  return res.json()
}

// ── PR3: date concertation ──────────────────────────────────────────────────

export async function proposeDate(acceptanceId, startsAt, endsAt, venue) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/propose-date`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ startsAt, endsAt, venue }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to propose date')
  }
  return res.json()
}

export async function withdrawProposal(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/withdraw-proposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to withdraw')
  }
  return res.json()
}

export async function approveDate(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/approve-date`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to approve')
  }
  return res.json()
}

// ── PR4: debrief verdicts ───────────────────────────────────────────────────

export async function approveChallenge(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/approve-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to approve challenge')
  }
  return res.json()
}

export async function rejectChallenge(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/reject-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to close challenge')
  }
  return res.json()
}

// ── PR5: pending take-on review (creator only) ────────────────────────────
// Creator approves/rejects a pending take-on request. Approve flips the row
// to 'accepted' (chat unlocks for the acceptor); reject flips to 'rejected'
// (acceptor notified, slot reopens).
export async function approveTakeOn(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/approve-takeon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to approve take-on')
  }
  return res.json()
}

export async function rejectTakeOn(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/reject-takeon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to reject take-on')
  }
  return res.json()
}

// Taker leaves an active take-on: deletes the acceptance (challenge reopens
// from zero), wipes the challenge chat, pushes + WS-resets the creator.
export async function abandonAcceptance(acceptanceId) {
  const res = await fetch(`${BASE}/acceptances/${encodeURIComponent(acceptanceId)}/abandon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to leave challenge')
  }
  return res.json()
}

// Creator restarts from zero: removes the active taker (deletes their
// acceptance), wipes the chat, reopens the challenge, pushes + WS-resets the taker.
export async function restartChallenge(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || 'Failed to restart challenge')
  }
  return res.json()
}

export async function fetchUpcomingEvents(channelId, opts = {}) {
  // Backwards-compat: callers used to pass `days` as a positional number.
  // Accept either `fetchUpcomingEvents(id, 14)` or
  // `fetchUpcomingEvents(id, { days, from, to })`.
  if (typeof opts === 'number') opts = { days: opts }
  const params = new URLSearchParams()
  if (opts.from && opts.to) {
    params.set('from', opts.from)
    params.set('to',   opts.to)
  } else {
    params.set('days', String(opts.days ?? 7))
  }
  const res = await fetch(`${BASE}/channels/${channelId}/events/upcoming?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch upcoming events')
  return res.json() // { events: [...] }
}

/**
 * Past archive - finished one-off hangouts + expired pulses for a city.
 * GET /channels/{id}/past → { items: FeedItem[], nextCursor: number|null }
 * Items share the same normalized FeedItem shape as the now feed.
 * `before` is a unix recency cursor (pass the prior page's nextCursor);
 * `from`/`to` are city-local YYYY-MM-DD (backend clamps the span to ≤14 days).
 */
export async function fetchPastArchive(channelId, opts = {}) {
  const params = new URLSearchParams()
  if (opts.type)   params.set('type',  opts.type)
  if (opts.limit)  params.set('limit', String(opts.limit))
  if (opts.before) params.set('before', String(opts.before))
  if (opts.from && opts.to) { params.set('from', opts.from); params.set('to', opts.to) }
  const qs = params.toString()
  try {
    const res = await fetch(`${BASE}/channels/${channelId}/past${qs ? `?${qs}` : ''}`, { credentials: 'include' })
    if (!res.ok) return { items: [], nextCursor: null }
    const data = await res.json()
    return { items: data.items ?? [], nextCursor: data.nextCursor ?? null }
  } catch {
    return { items: [], nextCursor: null }
  }
}

/**
 * Per-day event counts for the calendar-strip dots on the upcoming screen.
 * Returns { "YYYY-MM-DD": count } - days with zero events are omitted.
 */
export async function fetchCalendarSummary(channelId, from, to) {
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`${BASE}/channels/${channelId}/events/calendar-summary?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch calendar summary')
  const data = await res.json()
  return data.summary ?? {}
}

// Thrown by createEvent / createEventSeries when the backend returns the
// structured `event_limit_reached` error. Callers should route to the
// limit-reached screen instead of surfacing a red error.
export class EventLimitReachedError extends Error {
  constructor() {
    super('event_limit_reached')
    this.name = 'EventLimitReachedError'
  }
}

export async function createEvent(channelId, guestId, nickname, title, locationHint, startsAt, endsAt, type, lat, lng) {
  const body = { guestId, nickname, title, starts_at: startsAt, ends_at: endsAt, type }
  if (locationHint) body.location_hint = locationHint
  // Precise coords from the map picker (optional) - power exact Maps links.
  if (typeof lat === 'number' && typeof lng === 'number') { body.lat = lat; body.lng = lng }
  const res = await fetch(`${BASE}/channels/${channelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (data.error === 'event_limit_reached') throw new EventLimitReachedError()
    throw new Error(data.error || 'Failed to create event')
  }
  return res.json()
}

export async function createEventSeries(channelId, guestId, payload) {
  const res = await fetch(`${BASE}/channels/${channelId}/event-series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, ...payload }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (data.error === 'event_limit_reached') throw new EventLimitReachedError()
    throw new Error(data.error || 'Failed to create event series')
  }
  return res.json() // { series_id, first_event }
}

export async function fetchEventMessages(eventId, { beforeId, limit } = {}) {
  const params = new URLSearchParams({ limit: String(limit ?? 50) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/events/${eventId}/messages?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch event messages')
  return res.json() // { messages, hasMore }
}

export async function fetchEventParticipants(eventId, sessionId) {
  const res = await fetch(`${BASE}/events/${eventId}/participants?sessionId=${sessionId}&lite=1`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch participants')
  return res.json() // { count, isIn }
}

export async function fetchEventGoingList(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}/participants`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch participants')
  return res.json() // { participants: UserDTO[], count, isIn }
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

export async function sendEventMessage(eventId, guestId, nickname, content, replyToMessageId = null, mentions = null) {
  const body = { guestId, nickname, content }
  if (replyToMessageId) body.replyToMessageId = replyToMessageId
  if (mentions && mentions.length) body.mentions = mentions
  const res = await fetch(`${BASE}/events/${eventId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send message')
  }
  return res.json()
}

// ── @mention autocomplete ──────────────────────────────────────────────────────
// context: 'city' | 'event' | 'topic'. id: city numeric id, or event/topic hex id.
// Registered, in-context users only (backend excludes guests + the caller).
export async function fetchMentionSuggestions(context, id, q) {
  const path = context === 'city'  ? `/channels/${id}/mention-suggestions`
             : context === 'event' ? `/events/${id}/mention-suggestions`
             :                       `/topics/${id}/mention-suggestions`
  try {
    const res = await fetch(`${BASE}${path}?q=${encodeURIComponent(q)}`, { credentials: 'include' })
    if (!res.ok) return []
    const data = await res.json()
    return data.suggestions ?? []
  } catch {
    return []
  }
}

// ── Auth & profile ────────────────────────────────────────────────────────────

export async function authSignup(email, password, displayName, username, guestId, mode = null, eulaAccepted = false) {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, display_name: displayName, username, guest_id: guestId, mode, eula_accepted: eulaAccepted }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Signup failed')
  return data // { user }
}

// Real-time username availability + format check for the @-handle picker.
// Returns { valid, available, reason }. Sends credentials so the backend
// excludes the caller's own row when editing in profile.
export async function checkUsernameAvailability(username) {
  const res = await fetch(`${BASE}/username/check?username=${encodeURIComponent(username)}`, {
    credentials: 'include',
  })
  if (!res.ok) return { valid: false, available: false, reason: 'Check failed' }
  return res.json()
}

export async function authLogin(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  return data // { user }
}

export async function authLogout() {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
}

export async function deleteAccount() {
  const res = await fetch(`${BASE}/auth/me`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'Failed to delete account')
  }
}

export async function authForgotPassword(email) {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function authValidateResetToken(token) {
  const res = await fetch(`${BASE}/auth/reset-password/validate?token=${encodeURIComponent(token)}`, {
    credentials: 'include',
  })
  if (!res.ok) return false
  const data = await res.json()
  return data.valid === true
}

export async function authResetPassword(token, password, passwordConfirmation) {
  const res = await fetch(`${BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, password, passwordConfirmation }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Reset failed')
  return data // { user, token }
}

export async function authMe() {
  const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error('Failed to fetch session')
  return res.json() // { user }
}

export async function updateProfile(fields) {
  const res = await fetch(`${BASE}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(fields),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update profile')
  return data // { user }
}

export async function fetchPublicProfile(userId) {
  const res = await fetch(`${BASE}/users/${userId}`, { credentials: 'include' })
  if (!res.ok) throw new Error('User not found')
  return res.json() // { user }
}

export async function fetchUserEvents(userId) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/events`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch user events')
  return res.json() // { events }
}

// ── Friends ────────────────────────────────────────────────────────────────────

export async function fetchUserFriends(userId, { page = 1, limit = 20 } = {}) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/friends?page=${page}&limit=${limit}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch friends')
  return res.json() // { friends, total, page, hasMore }
}

// Send a friend request. Backend mutual-add returns { ok: true, friend: true }
// when both users had pending requests to each other (auto-accepted).
export async function sendFriendRequest(userId) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/friends`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error('Failed to send friend request')
  return res.json()  // { ok: true, friend?: true, request?: {...} }
}

export async function removeFriend(userId) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/friends`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to remove friend')
  return res.json()
}

export async function acceptFriendRequest(requestId) {
  const res = await fetch(`${BASE}/friend-requests/${encodeURIComponent(requestId)}/accept`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to accept friend request')
  return res.json()
}

export async function declineFriendRequest(requestId) {
  const res = await fetch(`${BASE}/friend-requests/${encodeURIComponent(requestId)}/decline`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to decline friend request')
  return res.json()
}

export async function cancelFriendRequest(requestId) {
  const res = await fetch(`${BASE}/friend-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to cancel friend request')
  return res.json()
}

export async function fetchIncomingFriendRequests() {
  const res = await fetch(`${BASE}/friend-requests/incoming`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch incoming friend requests')
  const data = await res.json()
  return data.requests ?? []
}

export async function fetchOutgoingFriendRequests() {
  const res = await fetch(`${BASE}/friend-requests/outgoing`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch outgoing friend requests')
  const data = await res.json()
  return data.requests ?? []
}

export async function fetchIncomingFriendRequestCount() {
  const res = await fetch(`${BASE}/friend-requests/incoming-count`, { credentials: 'include' })
  if (!res.ok) return 0
  const data = await res.json()
  return data.count ?? 0
}

// ── Conversations (DMs) ───────────────────────────────────────────────────────

// Active hangouts a user created or joined - for the profile "Hangouts" tab.
export async function fetchUserHangouts(userId) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/hangouts`, { credentials: 'include' })
  if (!res.ok) return { hangouts: [] }
  return res.json() // { hangouts }
}

// Challenges the user created or accepted - for the profile "Challenges"
// tab. Mirrors fetchUserHangouts/fetchUserEvents. Backend already exists
// at GET /users/{userId}/challenges; the mobile app calls it via its own
// helper, this is the web parity.
export async function fetchUserChallenges(userId) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/challenges`, { credentials: 'include' })
  if (!res.ok) return { challenges: [] }
  return res.json() // { challenges }
}

// Public "Success challenges" showcase - completed, well-rated challenges
// (global, or ?cityId). Guest-readable. { items, hasMore }.
export async function fetchChallengeShowcase({ cityId, limit = 30, before } = {}) {
  const q = new URLSearchParams()
  if (cityId) q.set('cityId', String(cityId))
  if (limit)  q.set('limit', String(limit))
  if (before) q.set('before', String(before))
  try {
    const res = await fetch(`${BASE}/challenges/showcase?${q.toString()}`, { credentials: 'include' })
    if (!res.ok) return { items: [], hasMore: false }
    return res.json()
  } catch { return { items: [], hasMore: false } }
}

export async function fetchMyEvents(guestId) {
  const res = await fetch(`${BASE}/users/me/events?guestId=${encodeURIComponent(guestId)}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch my events')
  return res.json() // { events }
}

// Preflight for the 1-event-per-day rule. Cheap COUNT; safe on every CTA tap.
// Pass an optional `date` (YYYY-MM-DD) to check a specific host day -
// used by the create form when the user picks a non-today date.
// Returns { canCreate, isLegend, todayCount, date, limit }.
export async function fetchCanCreateEvent(channelId, guestId, date) {
  const qs = new URLSearchParams()
  if (channelId) qs.set('channelId', String(channelId))
  if (guestId)   qs.set('guestId',   guestId)
  if (date)      qs.set('date',      date)
  const res = await fetch(`${BASE}/users/me/can-create-event?${qs.toString()}`, { credentials: 'include' })
  if (!res.ok) {
    // On any non-2xx, assume the user CAN create - the POST will enforce the
    // rule server-side and route to the limit screen via the error code.
    return { canCreate: true, isLegend: false, todayCount: 0, limit: 1 }
  }
  return res.json()
}

export async function updateEvent(eventId, guestId, fields) {
  const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, ...fields }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update event')
  return data // updated event
}

export async function deleteEvent(eventId, guestId) {
  const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete event')
  }
  return res.json()
}

export async function fetchConversations() {
  const res = await fetch(`${BASE}/conversations`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch conversations')
  return res.json() // { dms, events }
}

export async function fetchConversationsUnread() {
  const res = await fetch(`${BASE}/conversations/unread`, { credentials: 'include' })
  if (res.status === 401) return null   // session gone - caller should clear auth state
  if (!res.ok) throw new Error('Failed to fetch conversations unread')
  return res.json() // { has_unread: bool }
}

export async function createOrGetDirectConversation(targetUserId) {
  const res = await fetch(`${BASE}/conversations/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ targetUserId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to open conversation')
  return data // { conversation, otherUser }
}

export async function fetchConversationMessages(conversationId, { beforeId, limit } = {}) {
  const params = new URLSearchParams({ limit: String(limit ?? 50) })
  if (beforeId) params.set('before_id', beforeId)
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages?${params}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json() // { messages, hasMore }
}

export async function markConversationRead(conversationId) {
  // Fire-and-forget - UI is already updated optimistically; ignore failures silently.
  await fetch(`${BASE}/conversations/${conversationId}/mark-read`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {})
}

export async function markEventRead(eventId) {
  // Fire-and-forget - ignore failures silently.
  await fetch(`${BASE}/events/${eventId}/mark-read`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {})
}

export async function sendConversationMessage(conversationId, content, replyToMessageId = null) {
  const body = { content }
  if (replyToMessageId) body.replyToMessageId = replyToMessageId
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to send message')
  return data // { message }
}

export async function sendConversationImageMessage(conversationId, imageUrl) {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ type: 'image', imageUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send image')
  }
  return res.json() // { message }
}

export async function sendEventImageMessage(eventId, guestId, nickname, imageUrl) {
  const res = await fetch(`${BASE}/events/${eventId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ guestId, nickname, type: 'image', imageUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to send image')
  }
  return res.json()
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function fetchNotifications({ limit = 50, offset = 0 } = {}) {
  const res = await fetch(`${BASE}/notifications?limit=${limit}&offset=${offset}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch notifications')
  return res.json() // { notifications, unread_count }
}

export async function fetchUnreadCount() {
  const res = await fetch(`${BASE}/notifications/unread-count`, { credentials: 'include' })
  if (res.status === 401) return null   // session gone - caller should clear auth state
  if (!res.ok) throw new Error('Failed to fetch unread count')
  return res.json() // { count }
}

export async function markNotificationsRead(ids) {
  const body = Array.isArray(ids) ? { ids } : { all: true }
  await fetch(`${BASE}/notifications/mark-read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  }).catch(() => {})
}

export async function fetchNotificationPreferences() {
  const res = await fetch(`${BASE}/notification-preferences`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch preferences')
  return res.json() // { preferences }
}

export async function updateNotificationPreferences(prefs) {
  const res = await fetch(`${BASE}/notification-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(prefs),
  })
  if (!res.ok) throw new Error('Failed to update preferences')
  return res.json() // { preferences }
}

// ── Push subscriptions ────────────────────────────────────────────────────────
// Note: push.js handles the full registration flow (SW + browser permission).
// These helpers are thin HTTP wrappers used internally by push.js.

export async function fetchVapidPublicKey() {
  const res = await fetch(`${BASE}/push/vapid-public-key`, { credentials: 'include' })
  if (!res.ok) return null
  const data = await res.json()
  return data.key ?? null
}

// ── Vibes ─────────────────────────────────────────────────────────────────────

export async function fetchUserVibes(userId, { limit = 20, offset = 0 } = {}) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/vibes?limit=${limit}&offset=${offset}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch vibes')
  return res.json()
}

export async function postVibe(userId, { rating, message }) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(userId)}/vibes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ rating, message }),
  })
  if (!res.ok) throw new Error('Failed to post vibe')
  return res.json()
}

// ── Reactions ─────────────────────────────────────────────────────────────────

export async function toggleChannelReaction(channelId, messageId, emoji, guestId) {
  const res = await fetch(`${BASE}/channels/${channelId}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ emoji, guestId }),
  })
  if (!res.ok) throw new Error('Failed to toggle reaction')
  return res.json() // { reactions: [{emoji, count, self}] }
}

// PR33 - toggle a reaction on a challenge-channel message. Same shape /
// allowed emojis as channels + events; broadcasts via WS.
export async function toggleChallengeReaction(challengeId, messageId, emoji, guestId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ emoji, guestId }),
  })
  if (!res.ok) throw new Error('Failed to toggle reaction')
  return res.json() // { reactions: [{emoji, count, self}] }
}

export async function toggleEventReaction(eventId, messageId, emoji, guestId) {
  const res = await fetch(`${BASE}/events/${eventId}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ emoji, guestId }),
  })
  if (!res.ok) throw new Error('Failed to toggle reaction')
  return res.json()
}

export async function toggleDmReaction(conversationId, messageId, emoji) {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ emoji }),
  })
  if (!res.ok) throw new Error('Failed to toggle reaction')
  return res.json()
}

// ── Edit / delete (channel: city+event+topic share the same endpoint) ──────
// Backend validates ownership: userId for registered, guestId for guest.
export async function editChannelMessage(messageId, content, guestId = null) {
  const body = { content }
  if (guestId) body.guestId = guestId
  const res = await fetch(`${BASE}/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to edit message')
  return res.json()
}

export async function deleteChannelMessage(messageId, guestId = null) {
  const body = {}
  if (guestId) body.guestId = guestId
  const res = await fetch(`${BASE}/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to delete message')
  return res.json()
}

// ── DM edit / delete (auth required - sender_id ownership) ─────────────────
export async function editDmMessage(messageId, content) {
  const res = await fetch(`${BASE}/dm-messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Failed to edit DM message')
  return res.json()
}

export async function deleteDmMessage(messageId) {
  const res = await fetch(`${BASE}/dm-messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to delete DM message')
  return res.json()
}


export class DuplicateReportError extends Error {
  constructor(existing) {
    super('already_reported')
    this.name     = 'DuplicateReportError'
    this.existing = existing // { id, created_at, status }
  }
}

export async function submitReport({ reason, guestId, targetUserId, targetGuestId, targetNickname }) {
  const res = await fetch(`${BASE}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      reason,
      guestId:         guestId       ?? undefined,
      target_user_id:  targetUserId  ?? null,
      target_guest_id: targetGuestId ?? null,
      target_nickname: targetNickname ?? null,
    }),
  })
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}))
    throw new DuplicateReportError(data.existing_report ?? null)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'Failed to submit report')
  }
  return res.json()
}

export async function fetchReportStatus({ guestId, targetUserId, targetGuestId }) {
  const qs = new URLSearchParams()
  if (guestId)       qs.set('guestId',         guestId)
  if (targetUserId)  qs.set('target_user_id',  targetUserId)
  if (targetGuestId) qs.set('target_guest_id', targetGuestId)
  const res = await fetch(`${BASE}/reports/status?${qs.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) return { reported: false }
  return res.json() // { reported: bool, existing_report?: {...} }
}

export async function fetchLinkPreview(url) {
  const res = await fetch(`${BASE}/link-preview?url=${encodeURIComponent(url)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.preview ?? null
}

// ── Challenge privacy (mutual go-private + anonymize-me) ─────────────────────

// Returns:
//   { currentVisibility, myVote, creatorVote, acceptorVote, acceptorUserId,
//     canVote, votes: [...] }
// 404 when caller isn't creator/acceptor; UI should hide the panel in that case.
// ── Challenge participation (join / leave / moderation) ─────────────────────

// Publicly visible channel members (people who clicked Join). Returns
// { members: [{id, displayName, username, thumbAvatarUrl, joinedAt}], count }.
// 404 when the viewer is out of visibility scope on a friends/private row.
export async function fetchChannelParticipants(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/channel-participants`, {
    credentials: 'include',
  })
  if (!res.ok) return { members: [], count: 0 }
  return res.json()
}

// "Am I in?" probe. Returns { isIn, isKicked, notificationPreference }.
// Anon viewer always gets { isIn:false, reason:'anon' }.
export async function fetchMyChallengeParticipation(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/participants/me`, {
    credentials: 'include',
  })
  if (!res.ok) return { isIn: false }
  return res.json()
}

export async function joinChallenge(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/join`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to join')
    err.code   = data.code || null
    throw err
  }
  return res.json() // { count, isIn:true }
}

export async function leaveChallenge(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/participants/me`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to leave')
    err.code   = data.code || null
    throw err
  }
  return res.json()
}

export async function kickChallengeParticipant(challengeId, userId, reason = null) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/participants/${encodeURIComponent(userId)}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(reason ? { reason } : {}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to remove participant')
    err.code   = data.code || null
    throw err
  }
  return res.json()
}

export async function setChallengeVisibility(challengeId, visibility) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/visibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ visibility }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to update visibility')
    err.code   = data.code || null
    throw err
  }
  return res.json()
}

export async function setChallengeCloseToJoins(challengeId, closed) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/close-to-new-joins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ closed }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update')
  }
  return res.json()
}

export async function setChallengeNotificationPreference(challengeId, preference) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/notification-preference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ preference }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update')
  }
  return res.json()
}

export async function fetchChallengePrivacy(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/privacy`, {
    credentials: 'include',
  })
  if (!res.ok) return null
  return res.json()
}

export async function voteChallengePrivacy(challengeId, vote) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/privacy/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ vote }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err  = new Error(data.error || 'Failed to vote')
    err.code   = data.code || null
    throw err
  }
  return res.json() // { ok, myVote, flippedToPrivate, visibility }
}

export async function clearChallengePrivacyVote(challengeId) {
  const res = await fetch(`${BASE}/challenges/${encodeURIComponent(challengeId)}/privacy/vote`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to clear vote')
  }
  return res.json()
}

