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
  let reconnectMs = 2000   // start at 2s, doubles up to 30s (mirrors native socket.ts)
  let destroyed = false
  const handlers = {}

  // Last joinRoom call — replayed automatically on reconnect
  let pendingJoin = null
  // Last joinEvent call — replayed automatically on reconnect
  let pendingEventJoin = null
  // Last joinConversation call — replayed automatically on reconnect
  let pendingConversationJoin = null
  // Last joinTopic call — replayed automatically on reconnect
  let pendingTopicJoin = null

  function connect() {
    if (destroyed) return
    console.log('[socket] connecting to', WS_URL)
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log('[socket] ✓ connected')
      reconnectMs = 2000  // reset backoff on successful connection
      if (pendingJoin) {
        console.log('[socket] replaying joinRoom', pendingJoin)
        send({ event: 'joinRoom', ...pendingJoin })
      }
      if (pendingEventJoin) {
        console.log('[socket] replaying joinEvent', pendingEventJoin)
        send({ event: 'joinEvent', ...pendingEventJoin })
      }
      if (pendingConversationJoin) {
        console.log('[socket] replaying joinConversation', pendingConversationJoin)
        send({ event: 'joinConversation', ...pendingConversationJoin })
      }
      if (pendingTopicJoin) {
        console.log('[socket] replaying joinTopic', pendingTopicJoin)
        send({ event: 'joinTopic', ...pendingTopicJoin })
      }
    }

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      console.debug('[socket] ←', msg.event, msg)
      handlers[msg.event]?.(msg)
    }

    ws.onclose = (e) => {
      if (!destroyed) {
        console.warn(`[socket] closed (code=${e.code}). reconnecting in ${reconnectMs}ms…`)
        reconnectTimer = setTimeout(() => {
          reconnectMs = Math.min(reconnectMs * 1.5, 30_000)
          connect()
        }, reconnectMs)
      } else {
        console.warn(`[socket] closed (code=${e.code}). not reconnecting (destroyed)`)
      }
    }

    ws.onerror = (e) => {
      console.error('[socket] ✗ error — is the WS server running at', WS_URL, '?', e)
      ws.close()
    }
  }

  function send(data) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  // WS server stores city rooms with integer keys (Map<number, …>).
  // The API returns channelId as a string; sending a string joins a different
  // Map entry than the integer key, so web and native users would never see
  // each other. Coerce to int before every city-scoped send.
  function numericCityId(cityId) {
    const n = parseInt(cityId, 10)
    return isNaN(n) ? cityId : n
  }

  connect()

  return {
    /** Join a city room. Replayed automatically on reconnect. */
    joinRoom(cityId, sessionId, nickname, userId = null) {
      const cid = numericCityId(cityId)
      console.log('[socket] → joinRoom', { cityId: cid, sessionId, nickname, userId })
      pendingJoin = { cityId: cid, sessionId, nickname, userId }
      send({ event: 'joinRoom', cityId: cid, sessionId, nickname, userId })
    },

    /** Leave a city room (e.g. before switching cities). */
    leaveRoom(cityId, sessionId) {
      const cid = numericCityId(cityId)
      console.log('[socket] → leaveRoom', { cityId: cid, sessionId })
      pendingJoin = null
      send({ event: 'leaveRoom', cityId: cid, sessionId })
    },

    /** Notify others that this user started typing. */
    typingStart(cityId, sessionId, nickname) {
      send({ event: 'typingStart', cityId: numericCityId(cityId), sessionId, nickname })
    },

    /** Notify others that this user stopped typing. */
    typingStop(cityId, sessionId) {
      send({ event: 'typingStop', cityId: numericCityId(cityId), sessionId })
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

    /** Join a topic (pulse) room. Replayed automatically on reconnect. */
    joinTopic(topicId, sessionId) {
      pendingTopicJoin = { topicId, sessionId }
      send({ event: 'joinTopic', topicId, sessionId })
    },

    /** Leave a topic room (e.g. on back navigation). */
    leaveTopic(topicId, sessionId) {
      pendingTopicJoin = null
      send({ event: 'leaveTopic', topicId, sessionId })
    },

    /** Subscribe to real-time messages for a DM conversation. Replayed automatically on reconnect. */
    joinConversation(conversationId, userId) {
      pendingConversationJoin = { conversationId, userId }
      send({ event: 'joinConversation', conversationId, userId })
    },

    /** Unsubscribe from a DM conversation room. */
    leaveConversation(conversationId, userId) {
      pendingConversationJoin = null
      send({ event: 'leaveConversation', conversationId, userId })
    },

    /** Keep presence alive. Call when tab regains focus. */
    heartbeat(cityId, sessionId) {
      const cid = numericCityId(cityId)
      console.debug('[socket] → heartbeat', { cityId: cid, sessionId })
      send({ event: 'heartbeat', cityId: cid, sessionId })
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
