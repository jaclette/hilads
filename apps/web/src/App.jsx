import { useState, useEffect, useRef } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage, fetchChannels, joinChannel, disconnectBeacon } from './api'
import { createSocket } from './socket'
import { cityFlag } from './cityMeta'
import Logo from './components/Logo'

// ── Helpers ───────────────────────────────────────────────────────────────────

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'],
  ['#ff6a9f', '#fb7185'],
  ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'],
  ['#fb923c', '#fbbf24'],
  ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'],
  ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

const PLACEHOLDERS = [
  (city) => `What's on in ${city} right now?`,
  (city) => `Say something to ${city}...`,
  (city) => `Talk to the people of ${city}...`,
  (city) => `Drop a message for ${city}...`,
]

function randomActivity() {
  const count = 15 + Math.floor(Math.random() * 35)
  return { subtype: 'crowd', text: `🔥 ${count} people are here right now` }
}

function typingText(users, mySessionId) {
  const others = users.filter(u => u.sessionId !== mySessionId)
  if (others.length === 0) return null
  if (others.length === 1) return `${others[0].nickname} is typing…`
  if (others.length === 2) return `${others[0].nickname} and ${others[1].nickname} are typing…`
  return 'Several people are typing…'
}

function messageKey(m) {
  if (m.type === 'system' && m.event === 'join') return `system_${m.createdAt}_${m.nickname}`
  return m.id
}

function toFeedItem(m, staggerDelay) {
  if (m.type === 'system' && m.event === 'join') {
    return {
      type: 'activity',
      subtype: 'join',
      id: messageKey(m),
      text: `👋 ${m.nickname} just joined`,
    }
  }
  return { type: 'message', staggerDelay, ...m }
}

const NB_ADJECTIVES = ['Swift', 'Cool', 'Bright', 'Bold', 'Wild', 'Calm', 'Soft', 'Sharp', 'Quick', 'Zen', 'Lucky', 'Brave']
const NB_NOUNS = ['Panda', 'Fox', 'Otter', 'Wolf', 'Eagle', 'Tiger', 'Bear', 'Hawk', 'Lynx', 'Owl', 'Crab', 'Deer']

function generateNickname() {
  const adj = NB_ADJECTIVES[Math.floor(Math.random() * NB_ADJECTIVES.length)]
  const noun = NB_NOUNS[Math.floor(Math.random() * NB_NOUNS.length)]
  return `${adj}${noun}`
}

// Unique per browser tab — stored in sessionStorage so it survives hot reloads but not new tabs
function getOrCreateSessionId() {
  let id = sessionStorage.getItem('hilads_sid')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('hilads_sid', id)
  }
  return id
}

// Build the onlineUsers array for the sidebar/strip, marking the current user.
// Users come from presenceSnapshot (keyed by sessionId).
function buildOnlineUsers(users, mySessionId) {
  return users.map(u => ({
    id: u.sessionId,
    sessionId: u.sessionId,
    nickname: u.nickname,
    isMe: u.sessionId === mySessionId,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [status, setStatus] = useState('onboarding') // onboarding | joining | ready | error
  const [error, setError] = useState(null)
  const [city, setCity] = useState(null)
  const [channelId, setChannelId] = useState(null)
  const [guest, setGuest] = useState(null)
  const [nickname, setNickname] = useState(generateNickname)
  const [feed, setFeed] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [onlineCount, setOnlineCount] = useState(null)
  const [showCityPicker, setShowCityPicker] = useState(false)
  const [channels, setChannels] = useState([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [fadingIds, setFadingIds] = useState(new Set())
  const [onlineUsers, setOnlineUsers] = useState([])
  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const activityRef = useRef(null)
  const activeRef = useRef(false)
  const knownIdsRef = useRef(new Set())
  const locPromiseRef = useRef(null)
  const activeChannelRef = useRef(null) // guards against rapid-switch race conditions
  const sessionIdRef = useRef(getOrCreateSessionId())
  const pollFnRef = useRef(null)      // current room's poll function — called immediately on tab focus
  const socketRef = useRef(null)      // WebSocket presence client
  const nicknameRef = useRef(nickname) // tracks current nickname for use in closures
  const heartbeatRef = useRef(null)   // periodic heartbeat interval
  const [typingUsers, setTypingUsers] = useState([])
  const typingTimeoutRef = useRef(null) // debounce timer for typingStop
  const isTypingRef = useRef(false)     // true while typingStart has been sent

  useEffect(() => {
    // start geolocation immediately in the background while user sees onboarding
    locPromiseRef.current = startGeolocation()

    // Remove this tab from presence on close — sendBeacon survives page unload
    const handleUnload = () => {
      if (activeChannelRef.current) {
        socketRef.current?.leaveRoom(activeChannelRef.current, sessionIdRef.current)
      }
      disconnectBeacon(sessionIdRef.current)
    }
    window.addEventListener('beforeunload', handleUnload)

    // When returning to a hidden tab: re-assert presence and refresh messages.
    // Send joinRoom (not just heartbeat) so the session is re-registered if it somehow expired.
    const handleVisibilityChange = () => {
      if (!document.hidden && activeRef.current) {
        if (activeChannelRef.current) {
          socketRef.current?.joinRoom(activeChannelRef.current, sessionIdRef.current, nicknameRef.current)
        }
        pollFnRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(pollRef.current)
      clearInterval(heartbeatRef.current)
      activeRef.current = false
      clearTimeout(activityRef.current)
      clearTimeout(typingTimeoutRef.current)
      socketRef.current?.disconnect()
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  async function startGeolocation() {
    const position = await getPosition()
    const location = await resolveLocation(position.coords.latitude, position.coords.longitude)
    setCity(location.city)
    return location
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, () =>
        reject(new Error('Location access denied'))
      )
    })
  }

  function scheduleActivity(isFirst = false) {
    const delay = isFirst ? 6000 + Math.random() * 6000 : 22000 + Math.random() * 38000
    activityRef.current = setTimeout(() => {
      if (!activeRef.current) return
      const activity = randomActivity()
      setFeed((prev) => [
        ...prev,
        { type: 'activity', id: `act-${Date.now()}`, subtype: activity.subtype, text: activity.text },
      ])
      scheduleActivity()
    }, delay)
  }

  function scheduleEphemeral(id) {
    setTimeout(() => {
      setFadingIds((prev) => new Set([...prev, id]))
      setTimeout(() => {
        setFeed((prev) => prev.filter((f) => f.id !== id))
        setFadingIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      }, 600)
    }, 5000)
  }

  async function handleJoin(e) {
    e.preventDefault()
    const name = nickname.trim() || generateNickname()
    setNickname(name)
    nicknameRef.current = name
    setStatus('joining')
    try {
      const location = await locPromiseRef.current
      const session = await createGuestSession(name)
      setGuest(session)
      setChannelId(location.channelId)
      activeChannelRef.current = location.channelId

      // Emit join event before fetching messages so it's included
      const joinData = await joinChannel(location.channelId, sessionIdRef.current, session.guestId, name)
      const joinKey = messageKey(joinData.message)

      const data = await fetchMessages(location.channelId)
      knownIdsRef.current = new Set(data.messages.map(messageKey))

      const total = data.messages.length
      const initialItems = data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      })

      setFeed(initialItems)
      setOnlineUsers([{ id: 'me', sessionId: sessionIdRef.current, nickname: name, isMe: true }])
      setOnlineCount(joinData.onlineCount ?? null)
      setStatus('ready')
      scheduleEphemeral(joinKey)

      activeRef.current = true
      scheduleActivity(true)

      // ── Socket: real-time presence ───────────────────────────────────────────
      const socket = socketRef.current ?? createSocket()
      socketRef.current = socket

      socket.on('presenceSnapshot', ({ cityId, users, count }) => {
        console.debug('[presence] snapshot', cityId, count, 'users:', users.map(u => u.nickname))
        if (activeChannelRef.current !== cityId) return
        setOnlineUsers(buildOnlineUsers(users, sessionIdRef.current))
        setOnlineCount(count)
      })

      socket.on('userJoined', ({ cityId, user }) => {
        console.debug('[presence] userJoined', cityId, user.nickname)
        if (activeChannelRef.current !== cityId) return
        setOnlineUsers((prev) => {
          if (prev.some((u) => u.sessionId === user.sessionId)) return prev
          return [...prev, { id: user.sessionId, sessionId: user.sessionId, nickname: user.nickname, isMe: false }]
        })
      })

      socket.on('userLeft', ({ cityId, user }) => {
        console.debug('[presence] userLeft', cityId, user.nickname)
        if (activeChannelRef.current !== cityId) return
        setOnlineUsers((prev) => prev.filter((u) => u.sessionId !== user.sessionId))
      })

      socket.on('onlineCountUpdated', ({ cityId, count }) => {
        console.debug('[presence] onlineCountUpdated', cityId, count)
        if (activeChannelRef.current !== cityId) return
        setOnlineCount(count)
      })

      socket.on('typingUsers', ({ cityId, users }) => {
        if (activeChannelRef.current !== cityId) return
        setTypingUsers(users)
      })

      socket.joinRoom(location.channelId, sessionIdRef.current, name)

      // ── Periodic heartbeat: keeps session alive regardless of tab visibility ──
      // Server TTL is 120s. We beat every 20s so the user stays online even when
      // the browser throttles background timers (worst-case ~60s between beats).
      // Intentionally no !document.hidden check — presence must stay alive in background tabs.
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = setInterval(() => {
        if (activeRef.current && activeChannelRef.current) {
          socketRef.current?.heartbeat(activeChannelRef.current, sessionIdRef.current)
        }
      }, 20_000)

      // ── Poll: messages only ──────────────────────────────────────────────────
      const doPoll = async () => {
        if (!activeRef.current) return
        const latest = await fetchMessages(location.channelId)
        if (activeChannelRef.current !== location.channelId) return // discard if switched away
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          const newItems = newMsgs.map((m) => toFeedItem(m))
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doPoll
      clearInterval(pollRef.current)
      pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function stopTyping() {
    clearTimeout(typingTimeoutRef.current)
    if (isTypingRef.current) {
      isTypingRef.current = false
      socketRef.current?.typingStop(activeChannelRef.current, sessionIdRef.current)
    }
  }

  function handleInputChange(e) {
    setInput(e.target.value)
    if (!socketRef.current || !activeChannelRef.current) return
    if (!isTypingRef.current) {
      isTypingRef.current = true
      socketRef.current.typingStart(activeChannelRef.current, sessionIdRef.current, nicknameRef.current)
    }
    clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(stopTyping, 1500)
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    stopTyping()
    setSending(true)
    try {
      const msg = await sendMessage(channelId, sessionIdRef.current, guest.guestId, nickname, content)
      knownIdsRef.current.add(msg.id)
      setFeed((prev) => [...prev, { type: 'message', ...msg }])
      setInput('')
    } catch (err) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }

  async function openCityPicker() {
    setShowCityPicker(true)
    setChannelsLoading(true)
    try {
      const data = await fetchChannels()
      setChannels(data.channels)
    } catch {
      setChannels([])
    } finally {
      setChannelsLoading(false)
    }
  }

  async function switchCity(newChannelId, newCityName) {
    if (newChannelId === channelId) {
      setShowCityPicker(false)
      return
    }
    setShowCityPicker(false)

    // stop everything tied to the previous room
    activeRef.current = false
    pollFnRef.current = null // prevent visibility handler from calling old room's poll
    clearTimeout(activityRef.current)
    clearTimeout(typingTimeoutRef.current)
    isTypingRef.current = false
    setTypingUsers([])
    clearInterval(pollRef.current)
    clearInterval(heartbeatRef.current)
    socketRef.current?.leaveRoom(channelId, sessionIdRef.current)

    // mark which channel we're switching to — used to discard stale async results
    activeChannelRef.current = newChannelId

    // reset all room-specific state immediately so UI never shows stale data
    setFeed([])
    setOnlineUsers([])
    knownIdsRef.current = new Set()
    setCity(newCityName)
    setChannelId(newChannelId)

    try {
      // Emit join event (also handles leaving previous channel) before fetching
      const joinData = await joinChannel(newChannelId, sessionIdRef.current, guest.guestId, nickname, channelId)

      // another switch happened while we were joining — discard
      if (activeChannelRef.current !== newChannelId) return

      const joinKey = messageKey(joinData.message)

      const data = await fetchMessages(newChannelId)

      // another switch happened while we were fetching — discard this result
      if (activeChannelRef.current !== newChannelId) return

      knownIdsRef.current = new Set(data.messages.map(messageKey))
      const total = data.messages.length
      const initialItems = data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      })
      setFeed(initialItems)
      setOnlineUsers([{ id: 'me', sessionId: sessionIdRef.current, nickname, isMe: true }])
      setOnlineCount(joinData.onlineCount ?? null)
      scheduleEphemeral(joinKey)

      activeRef.current = true
      scheduleActivity(true)

      // Socket: join new room — existing handlers (set up in handleJoin) remain active
      socketRef.current?.joinRoom(newChannelId, sessionIdRef.current, nickname)

      // Restart heartbeat for the new room (same policy — no !document.hidden)
      heartbeatRef.current = setInterval(() => {
        if (activeRef.current && activeChannelRef.current) {
          socketRef.current?.heartbeat(activeChannelRef.current, sessionIdRef.current)
        }
      }, 20_000)

      // Poll: messages only
      const doPoll = async () => {
        if (!activeRef.current) return
        const latest = await fetchMessages(newChannelId)
        if (activeChannelRef.current !== newChannelId) return // discard if switched away again
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          const newItems = newMsgs.map((m) => toFeedItem(m))
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doPoll
      pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)
    } catch {
      // silently fail — user stays with empty feed for new city
    }
  }

  const typingLabel = typingText(typingUsers, sessionIdRef.current)

  // ── Onboarding ─────────────────────────────────────────────────────────────

  if (status === 'onboarding') {
    const [c1, c2] = avatarColors(nickname || 'A')
    return (
      <div className="screen ob-screen">
        <div className="ob-card">
          <div className="ob-brand">
            <Logo variant="wordmark" size="lg" />
          </div>

          <div className="ob-sep" />

          <div className="ob-city-block">
            {city ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '2rem', lineHeight: 1 }}>{cityFlag(city)}</span>
                  <span className="ob-city-name">{city}</span>
                </div>
                <span className="ob-city-sub">people are chatting live right now</span>
              </>
            ) : (
              <span className="ob-locating">› locating...</span>
            )}
          </div>

          <form className="ob-form" onSubmit={handleJoin}>
            <label className="ob-label">Your name</label>
            <div className="ob-input-row">
              <span
                className="ob-avatar-preview"
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
              >
                {(nickname[0] || 'A').toUpperCase()}
              </span>
              <input
                className="ob-input"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                autoFocus
                placeholder="Your nickname"
              />
            </div>

            <button type="submit" className="ob-btn">
              {city ? `Join ${city}` : 'Join Chat'} →
            </button>

            <p className="ob-hint">// anonymous · no sign-up</p>
          </form>
        </div>
      </div>
    )
  }

  // ── Joining (transition) ───────────────────────────────────────────────────

  if (status === 'joining') {
    return (
      <div className="screen center">
        <div className="loading-spinner" />
        <p className="loading-text">Joining {city || 'the chat'}...</p>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className="screen center">
        <p className="error-emoji">😬</p>
        <p className="error-text">{error}</p>
        <button
          className="retry-btn"
          onClick={() => {
            locPromiseRef.current = startGeolocation()
            setStatus('onboarding')
            setError(null)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  // ── Online users panel (shared between sidebar and mobile strip) ───────────

  function OnlineUserAvatar({ user }) {
    const [c1, c2] = avatarColors(user.nickname)
    return (
      <span
        className="online-avatar"
        title={user.isMe ? `${user.nickname} (you)` : user.nickname}
        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
        data-me={user.isMe ? 'true' : undefined}
      >
        {user.nickname[0].toUpperCase()}
      </span>
    )
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      <div className="screen chat">
        <header className="chat-header">
          <div className="header-left">
            <Logo variant="icon" size="sm" />
            <div className="header-divider" />
            <div className="online-dot" />
            <div className="header-city">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{cityFlag(city)}</span>
                <span className="city-name">{city}</span>
              </div>
              <span className="online-label">
                {onlineCount != null ? `${onlineCount} people online` : 'live now'}
              </span>
            </div>
          </div>
          <div className="header-right">
            <button className="change-city-btn" onClick={openCityPicker} title="Switch city">
              <GlobeIcon />
              <span>Switch</span>
            </button>
            <span className="you-badge">{guest?.nickname}</span>
          </div>
        </header>

        {/* Mobile-only online strip */}
        {onlineUsers.length > 0 && (
          <div className="online-mobile-strip">
            {onlineUsers.map((user) => (
              <OnlineUserAvatar key={user.id} user={user} />
            ))}
          </div>
        )}

        <div className="messages">
          {feed.length === 0 && (
            <div className="empty">
              <p className="empty-icon">👋</p>
              <p>Be the first to say something in {city}!</p>
            </div>
          )}
          {feed.map((item, i) => {
            if (item.type === 'activity') {
              return (
                <div
                  key={item.id}
                  className={item.subtype === 'join'
                    ? `feed-join${fadingIds.has(item.id) ? ' feed-join--exit' : ''}`
                    : 'feed-activity'}
                >
                  {item.text}
                </div>
              )
            }

            const isMine = item.guestId === guest?.guestId
            const prevItem = feed[i - 1]
            const isGrouped = prevItem?.type === 'message' && prevItem.guestId === item.guestId
            const [c1, c2] = avatarColors(item.nickname)

            return (
              <div
                key={item.id}
                className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : '', 'animate'].filter(Boolean).join(' ')}
                style={item.staggerDelay ? { animationDelay: item.staggerDelay } : undefined}
              >
                {!isMine && !isGrouped && (
                  <div className="msg-meta">
                    <span
                      className="msg-avatar"
                      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                    >
                      {item.nickname[0].toUpperCase()}
                    </span>
                    <span className="msg-author" style={{ color: c1 }}>{item.nickname}</span>
                  </div>
                )}
                <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''} ${isGrouped && !isMine ? 'grouped' : ''}`}>
                  <span className="msg-content">{item.content}</span>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {typingLabel && (
          <div className="typing-indicator">
            <span className="typing-dots">
              <span /><span /><span />
            </span>
            {typingLabel}
          </div>
        )}

        <form className="input-bar" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={city ? PLACEHOLDERS[channelId % PLACEHOLDERS.length](city) : ''}
            maxLength={1000}
            autoFocus
          />
          <button type="submit" disabled={sending || !input.trim()} className="send-btn">
            <SendIcon />
          </button>
        </form>
      </div>

      {/* City picker modal */}
      {showCityPicker && (
        <div className="city-picker-overlay" onClick={() => setShowCityPicker(false)}>
          <div className="city-picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="city-picker-handle" />
            <div className="city-picker-header">
              <span className="city-picker-title">Switch city</span>
              <button className="city-picker-close" onClick={() => setShowCityPicker(false)}>✕</button>
            </div>
            <div className="city-picker-list">
              {channelsLoading ? (
                <div className="city-picker-loading">Loading cities...</div>
              ) : [...channels].sort((a, b) => {
                const aCurrent = a.channelId === channelId
                const bCurrent = b.channelId === channelId
                if (aCurrent) return -1
                if (bCurrent) return 1
                // highest active users first
                if (b.activeUsers !== a.activeUsers) return b.activeUsers - a.activeUsers
                // then highest message count
                if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount
                // finally alphabetical
                return a.city.localeCompare(b.city)
              }).map((ch) => {
                const isActive = ch.channelId === channelId
                const hasActivity = ch.activeUsers > 0
                return (
                  <button
                    key={ch.channelId}
                    className={`city-row${isActive ? ' active' : ''}`}
                    onClick={() => switchCity(ch.channelId, ch.city)}
                  >
                    <div className="city-row-left">
                      <span className={`activity-dot${hasActivity ? ' live' : ''}`} />
                      <span style={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>{cityFlag(ch.city)}</span>
                      <span className="city-row-name">{ch.city}</span>
                      {isActive && <span className="city-row-current">you're here</span>}
                    </div>
                    <div className="city-row-stats">
                      {ch.activeUsers > 0 && <span className="city-row-users">{ch.activeUsers} online</span>}
                      <span className="city-row-count">{ch.messageCount} msgs</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Desktop-only sidebar */}
      {onlineUsers.length > 0 && (
        <aside className="online-sidebar">
          <p className="online-sidebar-title">Online · {onlineUsers.length}</p>
          {onlineUsers.map((user) => {
            const [c1, c2] = avatarColors(user.nickname)
            return (
              <div key={user.id} className="sidebar-user">
                <span
                  className="online-avatar"
                  style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  data-me={user.isMe ? 'true' : undefined}
                >
                  {user.nickname[0].toUpperCase()}
                </span>
                <span className="sidebar-user-name">
                  {user.isMe ? <><strong>{user.nickname}</strong> <span className="sidebar-you">(you)</span></> : user.nickname}
                </span>
              </div>
            )
          })}
        </aside>
      )}
    </div>
  )
}
