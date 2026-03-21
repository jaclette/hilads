import { useState, useEffect, useRef, useMemo } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage, fetchChannels } from './api'

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
  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const fluctuateRef = useRef(null)
  const activityRef = useRef(null)
  const activeRef = useRef(false)
  const knownIdsRef = useRef(new Set())
  const locPromiseRef = useRef(null)

  // Derive online users from recent message senders — real participants, always in sync
  const onlineUsers = useMemo(() => {
    if (!guest) return []
    const seen = new Set()
    const users = []
    seen.add(guest.guestId)
    users.push({ id: 'me', guestId: guest.guestId, nickname: nickname, isMe: true })
    for (let i = feed.length - 1; i >= 0; i--) {
      const item = feed[i]
      if (item.type !== 'message' || seen.has(item.guestId)) continue
      seen.add(item.guestId)
      users.push({ id: item.guestId, guestId: item.guestId, nickname: item.nickname, isMe: false })
      if (users.length >= 12) break
    }
    return users
  }, [feed, guest, nickname])

  useEffect(() => {
    // start geolocation immediately in the background while user sees onboarding
    locPromiseRef.current = startGeolocation()
    return () => {
      clearInterval(pollRef.current)
      clearInterval(fluctuateRef.current)
      activeRef.current = false
      clearTimeout(activityRef.current)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  async function startGeolocation() {
    const position = await getPosition()
    const location = await resolveLocation(position.coords.latitude, position.coords.longitude)
    setCity(location.city)
    setOnlineCount(((location.channelId * 37 + 5) % 43) + 12)
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

  async function handleJoin(e) {
    e.preventDefault()
    const name = nickname.trim() || generateNickname()
    setNickname(name)
    setStatus('joining')
    try {
      const location = await locPromiseRef.current
      const session = await createGuestSession(name)
      setGuest(session)
      setChannelId(location.channelId)

      fluctuateRef.current = setInterval(() => {
        setOnlineCount((n) => Math.max(5, n + Math.floor(Math.random() * 5) - 2))
      }, 8000)

      const data = await fetchMessages(location.channelId)
      knownIdsRef.current = new Set(data.messages.map(messageKey))

      const total = data.messages.length
      const initialItems = data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      })

      setFeed(initialItems)
      setStatus('ready')

      activeRef.current = true
      scheduleActivity(true)

      clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        if (document.hidden) return
        const latest = await fetchMessages(location.channelId)
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          setFeed((prev) => [...prev, ...newMsgs.map((m) => toFeedItem(m))])
        }
      }, 3000)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const msg = await sendMessage(channelId, guest.guestId, nickname, content)
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

    // stop current polling & activity
    activeRef.current = false
    clearTimeout(activityRef.current)
    clearInterval(pollRef.current)

    // reset feed for new city
    setFeed([])
    knownIdsRef.current = new Set()
    setCity(newCityName)
    setChannelId(newChannelId)

    try {
      const data = await fetchMessages(newChannelId)
      knownIdsRef.current = new Set(data.messages.map(messageKey))
      const total = data.messages.length
      const initialItems = data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      })
      setFeed(initialItems)

      activeRef.current = true
      scheduleActivity(true)

      pollRef.current = setInterval(async () => {
        if (document.hidden) return
        const latest = await fetchMessages(newChannelId)
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          setFeed((prev) => [...prev, ...newMsgs.map((m) => toFeedItem(m))])
        }
      }, 3000)
    } catch {
      // silently fail — user stays with empty feed for new city
    }
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  if (status === 'onboarding') {
    const [c1, c2] = avatarColors(nickname || 'A')
    return (
      <div className="screen ob-screen">
        <div className="ob-card">
          <div className="ob-brand">hilads</div>

          <div className="ob-city-block">
            {city ? (
              <>
                <span className="ob-city-name">{city}</span>
                <span className="ob-city-sub">people are chatting live right now</span>
              </>
            ) : (
              <span className="ob-locating">📍 Finding your city...</span>
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

            <p className="ob-hint">anonymous · no sign-up needed</p>
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
            <div className="online-dot" />
            <div className="header-city">
              <span className="city-name">{city}</span>
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
                  className={item.subtype === 'join' ? 'feed-join' : 'feed-activity'}
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

        <form className="input-bar" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
            <div className="city-picker-header">
              <span className="city-picker-title">Switch city</span>
              <button className="city-picker-close" onClick={() => setShowCityPicker(false)}>✕</button>
            </div>
            <div className="city-picker-list">
              {channelsLoading ? (
                <div className="city-picker-loading">Loading cities...</div>
              ) : channels.map((ch) => {
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
