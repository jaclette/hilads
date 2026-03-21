import { useState, useEffect, useRef } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage } from './api'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const FAKE_NAMES = ['Alex', 'Maya', 'Tom', 'Sora', 'Leo', 'Zara', 'Kai', 'Nina', 'Felix', 'Mia', 'Sam', 'Yuki', 'Ryo', 'Cleo', 'Jude']

function randomActivity() {
  if (Math.random() < 0.35) {
    const count = 15 + Math.floor(Math.random() * 35)
    return `🔥 ${count} people are here right now`
  }
  const name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)]
  return `👋 ${name} just joined`
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
  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const fluctuateRef = useRef(null)
  const activityRef = useRef(null)
  const activeRef = useRef(false)
  const knownIdsRef = useRef(new Set())
  const locPromiseRef = useRef(null)

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
      setFeed((prev) => [
        ...prev,
        { type: 'activity', id: `act-${Date.now()}`, text: randomActivity() },
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
      knownIdsRef.current = new Set(data.messages.map((m) => m.id))

      const total = data.messages.length
      const initialItems = data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        return {
          type: 'message',
          staggerDelay: staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined,
          ...m,
        }
      })

      setFeed(initialItems)
      setStatus('ready')

      activeRef.current = true
      scheduleActivity(true)

      pollRef.current = setInterval(async () => {
        const latest = await fetchMessages(location.channelId)
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(m.id))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(m.id))
          setFeed((prev) => [...prev, ...newMsgs.map((m) => ({ type: 'message', ...m }))])
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
      const msg = await sendMessage(channelId, guest.guestId, content)
      knownIdsRef.current.add(msg.id)
      setFeed((prev) => [...prev, { type: 'message', ...msg }])
      setInput('')
    } catch (err) {
      alert(err.message)
    } finally {
      setSending(false)
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

  // ── Chat ───────────────────────────────────────────────────────────────────

  return (
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
          <span className="you-badge">{guest?.nickname}</span>
        </div>
      </header>

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
              <div key={item.id} className="feed-activity">
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
  )
}
