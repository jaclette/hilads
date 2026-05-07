/**
 * Hilads WebSocket client
 *
 * Contract
 * --------
 * Client → Server  : joinRoom(cityId, sessionId, nickname, userId?)
 *                    leaveRoom(cityId, sessionId)
 *                    heartbeat(cityId, sessionId)
 *                    typingStart(cityId, sessionId, nickname)
 *                    typingStop(cityId, sessionId)
 *                    joinEvent(eventId, sessionId)
 *                    leaveEvent(eventId, sessionId)
 *                    joinTopic(topicId, sessionId)
 *                    leaveTopic(topicId, sessionId)
 *                    joinConversation(conversationId, userId)
 *                    leaveConversation(conversationId, userId)
 *                    joinUser(userId)                       — per-user channel
 *
 * Server → Client  : presenceSnapshot(cityId, users[{sessionId,nickname,userId?}], count)
 *                    userJoined(cityId, user)
 *                    userLeft(cityId, user)
 *                    onlineCountUpdated(cityId, count)
 *                    typingUsers(cityId, users[])
 *                    newMessage(channelId, message)
 *                    newConversationMessage(conversationId, message)
 *                    event_presence_update(eventId, count)
 *                    event_participants_update(eventId, count)
 *                    new_event(channelId, hiladsEvent)
 *                    newTopic(channelId, topic)
 *                    friendRequestReceived | friendRequestAccepted |
 *                      friendRequestDeclined | friendRequestCancelled  (per-user)
 *
 * Lifecycle events (synthetic — not from server):
 *                    connected   — fired after onopen + room replays
 *                    disconnected — fired on onclose
 *
 * on(event, handler) returns an unsubscribe function. Multiple handlers
 * can subscribe to the same event name simultaneously (Set-based dispatch),
 * mirroring native HiladsSocket behaviour.
 */

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8081'

console.log('[socket] WS_URL =', WS_URL)

export function createSocket() {
  let ws = null
  let reconnectTimer = null
  let reconnectMs = 2000   // used after rapid-retry window expires
  let rapidRetries = 0     // counts fast retries during cold-start window
  let destroyed = false

  // During a Render cold start (~30-50s) the server hasn't bound to the port
  // yet, so every attempt closes with 1006 in <100ms. Rather than letting the
  // exponential backoff climb to 15-30s (making the user wait long after the
  // server is actually up), we retry at a fixed 3s for the first
  // RAPID_RETRY_MAX attempts, then switch to normal backoff.
  const RAPID_RETRY_MAX = 15   // 15 × 3s = 45s fast window
  const RAPID_RETRY_MS  = 3000

  // Multi-handler dispatch: Map<eventName, Set<handler>>
  // Each on() call adds to the Set; the returned fn removes from it.
  const handlers = new Map()

  // Last join payloads — replayed on reconnect to restore room membership
  let pendingJoin             = null
  let pendingEventJoin        = null
  let pendingConversationJoin = null
  let pendingTopicJoin        = null
  let pendingUserJoin         = null  // per-user channel for friend reqs etc.

  // ── Dispatch ────────────────────────────────────────────────────────────────

  function dispatch(event, data) {
    handlers.get(event)?.forEach(h => {
      try { h(data) } catch (err) { console.error('[socket] handler error:', event, err) }
    })
    // Wildcard — useful for debugging; mirrors native HiladsSocket
    if (event !== '*') handlers.get('*')?.forEach(h => {
      try { h(data) } catch {}
    })
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  function connect() {
    if (destroyed) return
    console.log('[socket] connecting to', WS_URL)
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log('[socket] ✓ connected')
      reconnectMs = 2000  // reset backoff
      rapidRetries = 0    // reset cold-start counter

      // Replay room joins so server restores membership after reconnect
      if (pendingJoin)             send({ event: 'joinRoom',          ...pendingJoin })
      if (pendingEventJoin)        send({ event: 'joinEvent',         ...pendingEventJoin })
      if (pendingConversationJoin) send({ event: 'joinConversation',  ...pendingConversationJoin })
      if (pendingTopicJoin)        send({ event: 'joinTopic',         ...pendingTopicJoin })
      if (pendingUserJoin)         send({ event: 'joinUser',          ...pendingUserJoin })

      // Notify subscribers — useful for catch-up fetches after a disconnect gap
      dispatch('connected', {})
    }

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      console.debug('[socket] ←', msg.event, msg)
      dispatch(msg.event, msg)
    }

    ws.onclose = (e) => {
      dispatch('disconnected', { code: e.code })
      if (!destroyed) {
        let delay
        if (rapidRetries < RAPID_RETRY_MAX) {
          // Fast retry: server may be cold-starting (Render free tier).
          // Keep hammering every 3s so we connect quickly once it's up.
          rapidRetries++
          delay = RAPID_RETRY_MS
        } else {
          // Server appears persistently unavailable — back off normally.
          delay = reconnectMs
          reconnectMs = Math.min(reconnectMs * 1.5, 30_000)
        }
        console.warn(`[socket] closed (code=${e.code}). reconnecting in ${delay}ms… (retry ${rapidRetries}/${RAPID_RETRY_MAX})`)
        reconnectTimer = setTimeout(connect, delay)
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
    /** True when the WebSocket connection is open. */
    get isConnected() {
      return ws?.readyState === WebSocket.OPEN
    },

    /** Join a city room. Replayed automatically on reconnect. */
    joinRoom(cityId, sessionId, nickname, userId = null, mode = null) {
      const cid = numericCityId(cityId)
      console.log('[socket] → joinRoom', { cityId: cid, sessionId, nickname, userId, mode })
      pendingJoin = { cityId: cid, sessionId, nickname, userId, mode }
      send({ event: 'joinRoom', cityId: cid, sessionId, nickname, userId, ...(mode ? { mode } : {}) })
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

    /**
     * Subscribe to the per-user WS channel — friend-request events, future
     * profile-view bursts, etc. Replayed on reconnect. Safe to call before
     * the socket is open: send() drops while closed and the pendingUserJoin
     * payload fires on the 'connected' replay.
     */
    joinUser(userId) {
      if (!userId) return
      pendingUserJoin = { userId }
      send({ event: 'joinUser', userId })
    },

    /** Keep presence alive. Call when tab regains focus. */
    heartbeat(cityId, sessionId) {
      const cid = numericCityId(cityId)
      console.debug('[socket] → heartbeat', { cityId: cid, sessionId })
      send({ event: 'heartbeat', cityId: cid, sessionId })
    },

    /**
     * Subscribe to a server event. Returns an unsubscribe function.
     * Multiple handlers for the same event coexist (Set-based dispatch).
     * Special events: 'connected', 'disconnected' (lifecycle), '*' (all events).
     */
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event).add(handler)
      return () => handlers.get(event)?.delete(handler)
    },

    /**
     * Broadcast a reaction animation to everyone in the same city channel.
     * type: 'heart' | 'like' | 'laugh' | 'wow' | 'fire'
     * Purely visual — does not affect stored reaction counts.
     */
    sendReaction(type, messageId, cityId, userId) {
      send({
        event:     'reaction',
        type,
        messageId,
        cityId:    numericCityId(cityId),
        userId:    userId ?? null,
        timestamp: Date.now(),
      })
    },

    /** Close the connection and stop reconnecting. */
    disconnect() {
      destroyed = true
      clearTimeout(reconnectTimer)
      ws?.close()
    },
  }
}
