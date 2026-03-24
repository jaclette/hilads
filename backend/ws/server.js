/**
 * Hilads WebSocket Presence Server
 *
 * Contract
 * --------
 * Client → Server  : joinRoom(cityId, sessionId, nickname)
 *                    leaveRoom(cityId, sessionId)
 *                    heartbeat(cityId, sessionId)
 *                    joinEvent(eventId, sessionId)
 *                    leaveEvent(eventId, sessionId)
 *
 * Server → Client  : presenceSnapshot(cityId, users, count)
 *                    userJoined(cityId, user)
 *                    userLeft(cityId, user)
 *                    onlineCountUpdated(cityId, count)
 *                    event_presence_update(eventId, count)
 *                    event_participants_update(eventId, count)
 *
 * PHP API → WS (internal HTTP :8082)
 *                    POST /broadcast/event-participants  { eventId, count }
 *
 * All events are JSON objects with an `event` field.
 * Presence is scoped by cityId and keyed by sessionId.
 * Event presence (here) is in-memory; participation (going) is persisted by the PHP API.
 */

import { WebSocketServer } from 'ws'
import { createServer } from 'http'

const PORT = process.env.PORT || 8081
const INTERNAL_PORT = process.env.INTERNAL_PORT || 8082
const HEARTBEAT_TTL_MS = 120_000  // session expires after 120s without heartbeat
const CLEANUP_INTERVAL_MS = 60_000 // check for stale sessions every 60s
const PING_INTERVAL_MS = 30_000   // detect dead TCP connections
const TYPING_TTL_MS = 8_000       // auto-clear typing if no typingStop within 8s

// rooms: Map<cityId, Map<sessionId, { sessionId, nickname, ws, lastSeen }>>
const rooms = new Map()

// typing: Map<cityId, Map<sessionId, { sessionId, nickname, timer }>>
const typing = new Map()

// eventRooms: Map<eventId, Map<sessionId, { sessionId, ws }>>
const eventRooms = new Map()

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
}

// ── Server ─────────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    switch (msg.event) {
      case 'joinRoom':     return handleJoinRoom(ws, msg)
      case 'leaveRoom':    return handleLeaveRoom(ws, msg)
      case 'heartbeat':    return handleHeartbeat(ws, msg)
      case 'typingStart':  return handleTypingStart(ws, msg)
      case 'typingStop':   return handleTypingStop(ws, msg)
      case 'joinEvent':  return handleJoinEvent(ws, msg)
      case 'leaveEvent': return handleLeaveEvent(ws, msg)
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

// ── Internal HTTP server (PHP API → WS broadcast) ──────────────────────────────

const httpServer = createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    try {
      if (req.method === 'POST' && req.url === '/broadcast/event-participants') {
        const { eventId, count } = JSON.parse(body)
        broadcastParticipantCount(eventId, count)
        res.writeHead(200); res.end('ok')
      } else if (req.method === 'POST' && req.url === '/broadcast/message') {
        const { channelId, message } = JSON.parse(body)
        broadcastNewMessage(channelId, message)
        res.writeHead(200); res.end('ok')
      } else {
        res.writeHead(404); res.end('not found')
      }
    } catch {
      res.writeHead(400); res.end('bad request')
    }
  })
})

httpServer.listen(INTERNAL_PORT)

console.log(`Hilads WS server listening on ws://localhost:${PORT}`)
console.log(`Hilads WS internal HTTP listening on http://localhost:${INTERNAL_PORT}`)
