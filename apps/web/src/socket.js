/**
 * Hilads WebSocket client
 *
 * Contract
 * --------
 * Client → Server  : joinRoom(cityId, sessionId, nickname, userId?)
 *                    leaveRoom(cityId, sessionId)
 *                    heartbeat(cityId, sessionId)
 *                    joinEvent(eventId, sessionId)
 *                    leaveEvent(eventId, sessionId)
 *
 * Server → Client  : presenceSnapshot(cityId, users[{sessionId,nickname,userId?}], count)
 *                    userJoined(cityId, user)
 *                    userLeft(cityId, user)
 *                    onlineCountUpdated(cityId, count)
 *                    event_presence_update(eventId, count)
 */

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8081'

console.log('[socket] WS_URL =', WS_URL)

export function createSocket() {
  let ws = null
  let reconnectTimer = null
  let destroyed = false
  const handlers = {}

  // Last joinRoom call — replayed automatically on reconnect
  let pendingJoin = null
  // Last joinEvent call — replayed automatically on reconnect
  let pendingEventJoin = null

  function connect() {
    if (destroyed) return
    console.log('[socket] connecting to', WS_URL)
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log('[socket] ✓ connected')
      if (pendingJoin) {
        console.log('[socket] replaying joinRoom', pendingJoin)
        send({ event: 'joinRoom', ...pendingJoin })
      }
      if (pendingEventJoin) {
        console.log('[socket] replaying joinEvent', pendingEventJoin)
        send({ event: 'joinEvent', ...pendingEventJoin })
      }
    }

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      console.debug('[socket] ←', msg.event, msg)
      handlers[msg.event]?.(msg)
    }

    ws.onclose = (e) => {
      console.warn('[socket] closed (code=%d). %s', e.code, destroyed ? 'not reconnecting (destroyed)' : 'reconnecting in 3s…')
      if (!destroyed) reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = (e) => {
      console.error('[socket] ✗ error — is the WS server running at', WS_URL, '?', e)
      ws.close()
    }
  }

  function send(data) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  connect()

  return {
    /** Join a city room. Replayed automatically on reconnect. */
    joinRoom(cityId, sessionId, nickname, userId = null) {
      console.log('[socket] → joinRoom', { cityId, sessionId, nickname, userId })
      pendingJoin = { cityId, sessionId, nickname, userId }
      send({ event: 'joinRoom', cityId, sessionId, nickname, userId })
    },

    /** Leave a city room (e.g. before switching cities). */
    leaveRoom(cityId, sessionId) {
      console.log('[socket] → leaveRoom', { cityId, sessionId })
      pendingJoin = null
      send({ event: 'leaveRoom', cityId, sessionId })
    },

    /** Notify others that this user started typing. */
    typingStart(cityId, sessionId, nickname) {
      send({ event: 'typingStart', cityId, sessionId, nickname })
    },

    /** Notify others that this user stopped typing. */
    typingStop(cityId, sessionId) {
      send({ event: 'typingStop', cityId, sessionId })
    },

    /** Join an event room. Replayed automatically on reconnect. */
    joinEvent(eventId, sessionId) {
      console.log('[socket] → joinEvent', { eventId, sessionId })
      pendingEventJoin = { eventId, sessionId }
      send({ event: 'joinEvent', eventId, sessionId })
    },

    /** Leave an event room (e.g. back to city, or switching events). */
    leaveEvent(eventId, sessionId) {
      console.log('[socket] → leaveEvent', { eventId, sessionId })
      pendingEventJoin = null
      send({ event: 'leaveEvent', eventId, sessionId })
    },

    /** Toggle participation in an event. */
    toggleParticipation(eventId, sessionId) {
      send({ event: 'toggleParticipation', eventId, sessionId })
    },

    /** Subscribe to real-time messages for a DM conversation. */
    joinConversation(conversationId, userId) {
      send({ event: 'joinConversation', conversationId, userId })
    },

    /** Unsubscribe from a DM conversation room. */
    leaveConversation(conversationId, userId) {
      send({ event: 'leaveConversation', conversationId, userId })
    },

    /** Keep presence alive. Call when tab regains focus. */
    heartbeat(cityId, sessionId) {
      console.debug('[socket] → heartbeat', { cityId, sessionId })
      send({ event: 'heartbeat', cityId, sessionId })
    },

    /** Register a handler for a server event. */
    on(event, handler) {
      handlers[event] = handler
    },

    /** Close the connection and stop reconnecting. */
    disconnect() {
      destroyed = true
      clearTimeout(reconnectTimer)
      ws?.close()
    },
  }
}
