/**
 * Hilads WebSocket client
 *
 * Contract
 * --------
 * Client → Server  : joinRoom(cityId, sessionId, nickname)
 *                    leaveRoom(cityId, sessionId)
 *                    heartbeat(cityId, sessionId)
 *
 * Server → Client  : presenceSnapshot(cityId, users, count)
 *                    userJoined(cityId, user)
 *                    userLeft(cityId, user)
 *                    onlineCountUpdated(cityId, count)
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
    joinRoom(cityId, sessionId, nickname) {
      console.log('[socket] → joinRoom', { cityId, sessionId, nickname })
      pendingJoin = { cityId, sessionId, nickname }
      send({ event: 'joinRoom', cityId, sessionId, nickname })
    },

    /** Leave a city room (e.g. before switching cities). */
    leaveRoom(cityId, sessionId) {
      console.log('[socket] → leaveRoom', { cityId, sessionId })
      pendingJoin = null
      send({ event: 'leaveRoom', cityId, sessionId })
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
