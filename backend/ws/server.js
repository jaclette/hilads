/**
 * Hilads WebSocket Presence + Messaging Server
 *
 * Contract
 * --------
 * Client → Server  : joinRoom(cityId, sessionId, nickname, userId?)
 *                    leaveRoom(cityId, sessionId)
 *                    heartbeat(cityId, sessionId)
 *                    joinEvent(eventId, sessionId)
 *                    leaveEvent(eventId, sessionId)
 *                    joinConversation(conversationId, userId)
 *                    leaveConversation(conversationId, userId)
 *
 * Server → Client  : presenceSnapshot(cityId, users[{sessionId,nickname,userId?}], count)
 *                    userJoined(cityId, user)
 *                    userLeft(cityId, user)
 *                    onlineCountUpdated(cityId, count)
 *                    event_presence_update(eventId, count)
 *                    event_participants_update(eventId, count)
 *                    newConversationMessage(conversationId, message)
 *
 * PHP API → WS (same port as WS, plain HTTP POST — Render proxies both)
 *                    POST /broadcast/event-participants   { eventId, count }
 *                    POST /broadcast/message              { channelId, message }
 *                    POST /broadcast/conversation-message { conversationId, message }
 *
 * All events are JSON objects with an `event` field.
 *
 * Architecture note: WS upgrades and broadcast HTTP requests share the same
 * port. Render's proxy routes WebSocket upgrades to the WS server and
 * regular HTTP POSTs to the HTTP handler on the same process.
 */

import { WebSocketServer } from 'ws'
import { createServer } from 'http'

const PORT = process.env.PORT || 8081
const INTERNAL_TOKEN = process.env.WS_INTERNAL_TOKEN || ''
const HEARTBEAT_TTL_MS = 120_000  // session expires after 120s without heartbeat
const CLEANUP_INTERVAL_MS = 60_000 // check for stale sessions every 60s
const PING_INTERVAL_MS = 30_000   // detect dead TCP connections
const TYPING_TTL_MS = 8_000       // auto-clear typing if no typingStop within 8s
const ALLOWED_ORIGINS = new Set(
  (process.env.WS_ALLOWED_ORIGINS || 'https://hilads.vercel.app')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
)

// rooms: Map<cityId, Map<sessionId, { sessionId, nickname, ws, lastSeen }>>
const rooms = new Map()

// typing: Map<cityId, Map<sessionId, { sessionId, nickname, timer }>>
const typing = new Map()

// eventRooms: Map<eventId, Map<sessionId, { sessionId, ws }>>
const eventRooms = new Map()

// dmRooms: Map<conversationId, Map<userId, { userId, ws }>>
// Keyed by userId (not sessionId) because DMs are tied to registered accounts.
const dmRooms = new Map()

// ── Helpers ────────────────────────────────────────────────────────────────────

function getRoom(cityId) {
  if (!rooms.has(cityId)) rooms.set(cityId, new Map())
  return rooms.get(cityId)
}

function roomUsers(cityId) {
  const room = rooms.get(cityId)
  if (!room) return []
  return [...room.values()].map(s => ({ sessionId: s.sessionId, nickname: s.nickname, userId: s.userId ?? null }))
}

function broadcast(cityId, data, exclude = null) {
  const room = rooms.get(cityId)
  if (!room) return
  const msg = JSON.stringify(data)
  for (const session of room.values()) {
    if (session.ws !== exclude && session.ws.readyState === 1 /* OPEN */) {
      session.ws.send(msg)
    }
  }
}

function sendSnapshot(ws, cityId) {
  const users = roomUsers(cityId)
  ws.send(JSON.stringify({ event: 'presenceSnapshot', cityId, users, count: users.length }))
}

// ── Typing helpers ─────────────────────────────────────────────────────────────

function getTypingRoom(cityId) {
  if (!typing.has(cityId)) typing.set(cityId, new Map())
  return typing.get(cityId)
}

// Clears a session's typing entry and its auto-expire timer.
// Returns true if something was cleared (so caller knows to re-broadcast).
function clearTyping(cityId, sessionId) {
  const tRoom = typing.get(cityId)
  if (!tRoom) return false
  const entry = tRoom.get(sessionId)
  if (!entry) return false
  clearTimeout(entry.timer)
  tRoom.delete(sessionId)
  return true
}

// Sends the current typing list to everyone in the room.
function broadcastTyping(cityId) {
  const tRoom = typing.get(cityId)
  const users = tRoom
    ? [...tRoom.values()].map(t => ({ sessionId: t.sessionId, nickname: t.nickname }))
    : []
  broadcast(cityId, { event: 'typingUsers', cityId, users })
}

// ── Stale session cleanup ──────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now()
  for (const [cityId, room] of rooms) {
    for (const [sessionId, session] of room) {
      if (now - session.lastSeen > HEARTBEAT_TTL_MS) {
        console.log(`[WS] cleanup: evicting ${session.nickname} (${sessionId.slice(0, 8)}) from city ${cityId}`)
        // Notify the evicted session itself before removing — its WS connection is still alive
        if (session.ws.readyState === 1 /* OPEN */) {
          session.ws.send(JSON.stringify({
            event: 'userLeft', cityId, user: { sessionId, nickname: session.nickname },
          }))
        }
        room.delete(sessionId)
        if (clearTyping(cityId, sessionId)) broadcastTyping(cityId)
        broadcast(cityId, { event: 'userLeft', cityId, user: { sessionId, nickname: session.nickname } })
        broadcast(cityId, { event: 'onlineCountUpdated', cityId, count: room.size })
      }
    }
  }
}, CLEANUP_INTERVAL_MS)

// ── Event handlers ─────────────────────────────────────────────────────────────

function handleJoinRoom(ws, { cityId, sessionId, nickname, userId }) {
  const room = getRoom(cityId)
  const isNew = !room.has(sessionId)

  console.log(`[WS] joinRoom: ${nickname} (${sessionId.slice(0, 8)}) -> city ${cityId} (${isNew ? 'new' : 'rejoin'})`)
  room.set(sessionId, { sessionId, nickname, userId: userId ?? null, ws, lastSeen: Date.now() })

  // Always send full snapshot to the joining client (includes themselves)
  sendSnapshot(ws, cityId)

  if (isNew) {
    // Notify existing clients of the new user
    broadcast(cityId, { event: 'userJoined', cityId, user: { sessionId, nickname, userId: userId ?? null } }, ws)
    broadcast(cityId, { event: 'onlineCountUpdated', cityId, count: room.size }, ws)
  }
}

function handleLeaveRoom(ws, { cityId, sessionId }) {
  const room = rooms.get(cityId)
  if (!room) return
  const session = room.get(sessionId)
  if (!session) return

  console.log(`[WS] leaveRoom: ${session.nickname} (${sessionId.slice(0, 8)}) <- city ${cityId}`)
  room.delete(sessionId)
  if (clearTyping(cityId, sessionId)) broadcastTyping(cityId)
  broadcast(cityId, { event: 'userLeft', cityId, user: { sessionId, nickname: session.nickname } })
  broadcast(cityId, { event: 'onlineCountUpdated', cityId, count: room.size })
}

function handleHeartbeat(ws, { cityId, sessionId }) {
  const session = rooms.get(cityId)?.get(sessionId)
  if (session) {
    session.lastSeen = Date.now()
    console.log(`[WS] heartbeat: ${session.nickname} in city ${cityId}`)
  } else {
    console.log(`[WS] heartbeat: unknown session ${sessionId.slice(0, 8)} in city ${cityId} — ignored`)
  }
}

function handleTypingStart(ws, { cityId, sessionId, nickname }) {
  // Ignore if the session isn't in the room (prevents spoofing from unknown sessions)
  if (!rooms.get(cityId)?.has(sessionId)) return

  const tRoom = getTypingRoom(cityId)
  const existing = tRoom.get(sessionId)
  if (existing) clearTimeout(existing.timer)

  // Auto-clear after TYPING_TTL_MS — safety net for crashed clients
  const timer = setTimeout(() => {
    tRoom.delete(sessionId)
    broadcastTyping(cityId)
  }, TYPING_TTL_MS)

  tRoom.set(sessionId, { sessionId, nickname, timer })
  broadcastTyping(cityId)
}

function handleTypingStop(ws, { cityId, sessionId }) {
  if (clearTyping(cityId, sessionId)) broadcastTyping(cityId)
}

// ── Event presence helpers ──────────────────────────────────────────────────────

function getEventRoom(eventId) {
  if (!eventRooms.has(eventId)) eventRooms.set(eventId, new Map())
  return eventRooms.get(eventId)
}

function broadcastEventCount(eventId) {
  const room = eventRooms.get(eventId)
  if (!room) return
  const count = room.size
  const msg = JSON.stringify({ event: 'event_presence_update', eventId, count })
  for (const session of room.values()) {
    if (session.ws.readyState === 1 /* OPEN */) session.ws.send(msg)
  }
}

function broadcastParticipantCount(eventId, count) {
  const room = eventRooms.get(eventId)
  if (!room) return
  const msg = JSON.stringify({ event: 'event_participants_update', eventId, count })
  for (const session of room.values()) {
    if (session.ws.readyState === 1 /* OPEN */) session.ws.send(msg)
  }
}

function handleJoinEvent(ws, { eventId, sessionId }) {
  const room = getEventRoom(eventId)
  room.set(sessionId, { sessionId, ws })
  console.log(`[WS] joinEvent: ${sessionId.slice(0, 8)} -> event ${eventId} (${room.size} in room)`)
  broadcastEventCount(eventId)
}

function handleLeaveEvent(ws, { eventId, sessionId }) {
  const room = eventRooms.get(eventId)
  if (!room) return
  room.delete(sessionId)
  console.log(`[WS] leaveEvent: ${sessionId.slice(0, 8)} <- event ${eventId} (${room.size} in room)`)
  if (room.size === 0) eventRooms.delete(eventId)
  else broadcastEventCount(eventId)
}

// ── DM conversation helpers ────────────────────────────────────────────────────

function handleJoinConversation(ws, { conversationId, userId }) {
  if (!conversationId || !userId) return
  if (!dmRooms.has(conversationId)) dmRooms.set(conversationId, new Map())
  dmRooms.get(conversationId).set(userId, { userId, ws })
  console.log(`[WS] joinConversation: user ${userId.slice(0, 8)} -> dm ${conversationId.slice(0, 8)}`)
}

function handleLeaveConversation(ws, { conversationId, userId }) {
  const room = dmRooms.get(conversationId)
  if (!room) return
  room.delete(userId)
  if (room.size === 0) dmRooms.delete(conversationId)
  console.log(`[WS] leaveConversation: user ${userId?.slice(0, 8)} <- dm ${conversationId?.slice(0, 8)}`)
}

function broadcastConversationMessage(conversationId, message) {
  const room = dmRooms.get(conversationId)
  if (!room) return
  const payload = JSON.stringify({ event: 'newConversationMessage', conversationId, message })
  for (const { ws } of room.values()) {
    if (ws.readyState === 1 /* OPEN */) ws.send(payload)
  }
}

// Remove a disconnected ws from all rooms it was part of
function removeWs(ws) {
  for (const [cityId, room] of rooms) {
    for (const [sessionId, session] of room) {
      if (session.ws === ws) {
        room.delete(sessionId)
        if (clearTyping(cityId, sessionId)) broadcastTyping(cityId)
        broadcast(cityId, { event: 'userLeft', cityId, user: { sessionId, nickname: session.nickname } })
        broadcast(cityId, { event: 'onlineCountUpdated', cityId, count: room.size })
      }
    }
  }
  for (const [eventId, room] of eventRooms) {
    for (const [sessionId, session] of room) {
      if (session.ws === ws) {
        room.delete(sessionId)
        if (room.size === 0) eventRooms.delete(eventId)
        else broadcastEventCount(eventId)
      }
    }
  }
  for (const [conversationId, room] of dmRooms) {
    for (const [userId, member] of room) {
      if (member.ws === ws) {
        room.delete(userId)
        if (room.size === 0) dmRooms.delete(conversationId)
      }
    }
  }
}

// ── HTTP server (shared: WS upgrades + broadcast routes) ───────────────────────
//
// Both WebSocket client connections and PHP broadcast POSTs go through the same
// port. Render's proxy sends WS upgrades to the WS handler and plain HTTP POSTs
// to the HTTP handler — no separate internal port needed.

function handleBroadcastRequest(req, res) {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    console.log(`[internal] ${req.method} ${req.url} from ${req.socket.remoteAddress} body-len=${body.length}`)
    try {
      if (INTERNAL_TOKEN) {
        const provided = req.headers['x-internal-token']
        if (provided !== INTERNAL_TOKEN) {
          console.log(`[internal] ✗ auth FAILED (provided=${provided ? provided.slice(0, 6) + '...' : 'none'})`)
          res.writeHead(403); res.end('forbidden')
          return
        }
      }

      if (req.method === 'POST' && req.url === '/broadcast/event-participants') {
        const { eventId, count } = JSON.parse(body)
        const room = eventRooms.get(eventId)
        console.log(`[internal] broadcast event-participants eventId=${eventId} count=${count} roomSize=${room ? room.size : 0}`)
        broadcastParticipantCount(eventId, count)
        res.writeHead(200); res.end('ok')

      } else if (req.method === 'POST' && req.url === '/broadcast/message') {
        const { channelId, message } = JSON.parse(body)
        const isCity = typeof channelId === 'number'
        const room = isCity ? rooms.get(channelId) : eventRooms.get(channelId)
        console.log(`[internal] broadcast message channelId=${JSON.stringify(channelId)} isCity=${isCity} roomSize=${room ? room.size : 0}`)
        broadcastNewMessage(channelId, message)
        res.writeHead(200); res.end('ok')

      } else if (req.method === 'POST' && req.url === '/broadcast/conversation-message') {
        const { conversationId, message } = JSON.parse(body)
        const room = dmRooms.get(conversationId)
        console.log(`[internal] broadcast conversation-message convId=${conversationId ? conversationId.slice(0, 8) : 'null'} roomSize=${room ? room.size : 0}`)
        broadcastConversationMessage(conversationId, message)
        res.writeHead(200); res.end('ok')

      } else if (req.method === 'POST' && req.url === '/broadcast/new-event') {
        const { channelId, hiladsEvent } = JSON.parse(body)
        const room = rooms.get(channelId)
        console.log(`[internal] broadcast new-event channelId=${channelId} eventId=${hiladsEvent?.id} roomSize=${room ? room.size : 0}`)
        broadcastNewEvent(channelId, hiladsEvent)
        res.writeHead(200); res.end('ok')

      } else if (req.method === 'GET' && req.url === '/health') {
        // Health check endpoint — Render and uptime monitors can probe this
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, clients: wss.clients.size }))

      } else {
        console.log(`[internal] ✗ unknown route ${req.method} ${req.url}`)
        res.writeHead(404); res.end('not found')
      }
    } catch (err) {
      console.log(`[internal] ✗ error: ${err.message}`)
      res.writeHead(400); res.end('bad request')
    }
  })
}

const httpServer = createServer(handleBroadcastRequest)

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin
  // Allow connections from:
  //   - no origin header (native apps, curl, server-to-server)
  //   - "null" origin string (React Native on Android via OkHttp)
  //   - the WS server's own hostname (OkHttp computes origin from the WS URL)
  //   - explicitly allowed web origins (browsers)
  const wsHost = req.headers.host  // e.g. "hilads-ws.onrender.com"
  const selfOrigin = wsHost ? `https://${wsHost}` : null
  if (origin && origin !== 'null' && origin !== selfOrigin && !ALLOWED_ORIGINS.has(origin)) {
    console.log(`[WS] rejected origin: "${origin}" (allowed: ${[...ALLOWED_ORIGINS].join(', ')})`)
    ws.close(1008, 'Origin not allowed')
    return
  }

  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    switch (msg.event) {
      case 'joinRoom':           return handleJoinRoom(ws, msg)
      case 'leaveRoom':          return handleLeaveRoom(ws, msg)
      case 'heartbeat':          return handleHeartbeat(ws, msg)
      case 'typingStart':        return handleTypingStart(ws, msg)
      case 'typingStop':         return handleTypingStop(ws, msg)
      case 'joinEvent':          return handleJoinEvent(ws, msg)
      case 'leaveEvent':         return handleLeaveEvent(ws, msg)
      case 'joinConversation':   return handleJoinConversation(ws, msg)
      case 'leaveConversation':  return handleLeaveConversation(ws, msg)
    }
  })

  ws.on('close', () => removeWs(ws))
  ws.on('error', () => ws.close())
})

// Detect and terminate dead connections (no pong response)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue }
    ws.isAlive = false
    ws.ping()
  }
}, PING_INTERVAL_MS)

// ── New-event broadcast ─────────────────────────────────────────────────────────

// Pushes a new_event notification to all clients in the city room so in-app
// banners appear without requiring a push notification.
// channelId is an integer (city room key).
function broadcastNewEvent(channelId, hiladsEvent) {
  const room = rooms.get(channelId)
  if (!room) return
  const msg = JSON.stringify({ event: 'new_event', channelId, hiladsEvent })
  for (const session of room.values()) {
    if (session.ws.readyState === 1 /* OPEN */) session.ws.send(msg)
  }
}

// ── Message broadcast ───────────────────────────────────────────────────────────

// channelId is an integer for city channels, a hex string for event channels.
// Pushes a newMessage event to all connected clients in that room.
function broadcastNewMessage(channelId, message) {
  const isCity = typeof channelId === 'number'
  const room   = isCity ? rooms.get(channelId) : eventRooms.get(channelId)
  if (!room) return
  const msg = JSON.stringify({ event: 'newMessage', channelId, message })
  for (const session of room.values()) {
    if (session.ws.readyState === 1 /* OPEN */) session.ws.send(msg)
  }
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Hilads server listening on port ${PORT} (WS + HTTP broadcast)`)
  console.log(`INTERNAL_TOKEN=${INTERNAL_TOKEN ? 'set' : 'none'} ALLOWED_ORIGINS=${[...ALLOWED_ORIGINS].join(',')}`)
})
