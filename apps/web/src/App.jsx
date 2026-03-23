import { useState, useEffect, useRef } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage, fetchChannels, joinChannel, disconnectBeacon, uploadImage, sendImageMessage, fetchEvents, fetchCityEvents, fetchEventMessages, sendEventMessage, fetchEventParticipants, toggleEventParticipation } from './api'
import { createSocket } from './socket'
import { cityFlag, EVENT_ICONS } from './cityMeta'
import { getTimeLabel } from './eventUtils'
import Logo from './components/Logo'
import EventsSidebar from './components/EventsSidebar'
import CreateEventPage from './components/CreateEventModal'

// ── Helpers ───────────────────────────────────────────────────────────────────


// ── Bottom nav icons ──────────────────────────────────────────────────────────

const NAV_ICON_PROPS = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.75',
  strokeLinecap: 'round', strokeLinejoin: 'round',
}

function NavIconEvents() {
  return (
    <svg {...NAV_ICON_PROPS}>
      {/* Outer flame */}
      <path d="M12 2C9 6.5 6 10 6 14a6 6 0 0 0 12 0c0-4-3-7.5-6-12z" />
      {/* Inner flame core */}
      <path d="M12 9c-1.5 2-2.5 3.5-2.5 5a2.5 2.5 0 0 0 5 0c0-1.5-1-3-2.5-5z" strokeWidth="1.4" />
      {/* Live dot */}
      <circle cx="18.5" cy="5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function NavIconCity() {
  return (
    <svg {...NAV_ICON_PROPS}>
      {/* Globe outline */}
      <circle cx="12" cy="12" r="9" />
      {/* Longitude ellipse */}
      <ellipse cx="12" cy="12" rx="3.5" ry="9" />
      {/* Equator */}
      <line x1="3" y1="12" x2="21" y2="12" />
      {/* Active location dot */}
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function NavIconPeople() {
  return (
    <svg {...NAV_ICON_PROPS}>
      {/* Back person */}
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21c0-3.3 2.7-6 6-6" />
      {/* Front person */}
      <circle cx="15.5" cy="8" r="3.5" />
      <path d="M8 21a9 9 0 0 1 14 0" />
      {/* Green presence dot — always green, not accent */}
      <circle cx="20.5" cy="3.5" r="2.5" fill="var(--green)" stroke="var(--bg)" strokeWidth="1" />
    </svg>
  )
}

function NavIconProfile() {
  return (
    <svg {...NAV_ICON_PROPS}>
      {/* Head */}
      <circle cx="12" cy="8" r="4" />
      {/* Shoulders */}
      <path d="M4 21a9 9 0 0 1 16 0" />
      {/* Status dot */}
      <circle cx="19.5" cy="5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ── Chat icons ────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
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
  () => `Say hi 👋`,
  () => `Who's out tonight?`,
  () => `Any plans? 👀`,
  () => `What's the vibe right now?`,
  () => `Anyone up for something? 🍻`,
  () => `Drop a message…`,
]

const AMBIENT_MESSAGES = [
  () => `🔥 People are arriving`,
  () => `🍻 Who's out tonight?`,
  () => `💬 The city is waking up`,
  () => `🌙 Night owls are online`,
  () => `👀 Someone just arrived`,
  () => `🔥 New face in the city`,
  () => `🎉 The vibe is alive right now`,
  () => `🗺️ Explorers checking in`,
]

function randomActivity() {
  const fn = AMBIENT_MESSAGES[Math.floor(Math.random() * AMBIENT_MESSAGES.length)]
  return { subtype: 'crowd', text: fn() }
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

const JOIN_TEMPLATES = [
  (n) => `👋 ${n} just landed`,
  (n) => `🔥 ${n} joined the vibe`,
  (n) => `🍻 ${n} is here`,
  (n) => `👀 ${n} just showed up`,
  (n) => `✨ ${n} arrived`,
]

function toFeedItem(m, staggerDelay) {
  if (m.type === 'system' && m.event === 'join') {
    const tpl = JOIN_TEMPLATES[Math.floor(Math.random() * JOIN_TEMPLATES.length)]
    return {
      type: 'activity',
      subtype: 'join',
      id: messageKey(m),
      text: tpl(m.nickname),
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

const IDENTITY_KEY = 'hilads_identity'

function saveIdentity(nickname, channelId, city) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ nickname, channelId, city }))
}

function loadIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (!raw) return null
    const { nickname, channelId, city } = JSON.parse(raw)
    if (!nickname?.trim() || !channelId) return null
    return { nickname: nickname.trim(), channelId, city: city ?? null }
  } catch {
    return null
  }
}

function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY)
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
  const [nickname, setNickname] = useState(() => loadIdentity()?.nickname ?? generateNickname())
  const [feed, setFeed] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [onlineCount, setOnlineCount] = useState(null)
  const [showCityPicker, setShowCityPicker] = useState(false)
  const [channels, setChannels] = useState([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [fadingIds, setFadingIds] = useState(new Set())
  const [onlineUsers, setOnlineUsers] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [uploading, setUploading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  // Events state
  const [events, setEvents] = useState([])
  const [cityEvents, setCityEvents] = useState([])
  const [previewEvents, setPreviewEvents] = useState([])
  const [previewEventCount, setPreviewEventCount] = useState(0)
  const [previewTimezone, setPreviewTimezone] = useState('UTC')
  const [previewLiveCount] = useState(() => 15 + Math.floor(Math.random() * 35))
  const [channelEventCounts, setChannelEventCounts] = useState({})
  const [activeEventId, setActiveEventId] = useState(null)
  const [activeEvent, setActiveEvent] = useState(null)
  const [showEventDrawer, setShowEventDrawer] = useState(false)
  const [showPeopleDrawer, setShowPeopleDrawer] = useState(false)
  const [showProfileDrawer, setShowProfileDrawer] = useState(false)
  const [profileNickInput, setProfileNickInput] = useState('')
  const [showCreateEvent, setShowCreateEvent] = useState(false)
  const [createFromDrawer, setCreateFromDrawer] = useState(false)
  const [cityTimezone, setCityTimezone] = useState('UTC')
  const [eventPresence, setEventPresence] = useState({}) // { [eventId]: count }
  const [eventParticipants, setEventParticipants] = useState({}) // { [eventId]: number }
  const [participatedEvents, setParticipatedEvents] = useState(new Set()) // eventIds user toggled
  const [cityCountry, setCityCountry] = useState(null)
  // 'pending' | 'resolving' | 'denied' | 'error'
  const [geoState, setGeoState] = useState('pending')
  const [obPickingCity, setObPickingCity] = useState(false)
  const [obChannels, setObChannels] = useState([])
  const [obChannelsLoading, setObChannelsLoading] = useState(false)
  const [obChannelEventCounts, setObChannelEventCounts] = useState({})
  const [citySearchQuery, setCitySearchQuery] = useState('')

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
  const typingTimeoutRef = useRef(null) // debounce timer for typingStop
  const isTypingRef = useRef(false)     // true while typingStart has been sent
  const fileInputRef = useRef(null)

  // Events refs
  const activeEventIdRef = useRef(null)
  const eventsPolRef = useRef(null)
  const cityEventsPolRef = useRef(null)

  useEffect(() => {
    // start geolocation immediately in the background while user sees onboarding
    locPromiseRef.current = startGeolocation()

    // auto-rejoin if the user has a saved identity
    const saved = loadIdentity()
    if (saved) handleJoin(null, saved)

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

    const handleKeyDown = (e) => { if (e.key === 'Escape') setLightboxUrl(null) }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearInterval(pollRef.current)
      clearInterval(heartbeatRef.current)
      clearInterval(eventsPolRef.current)
      clearInterval(cityEventsPolRef.current)
      activeRef.current = false
      clearTimeout(activityRef.current)
      clearTimeout(typingTimeoutRef.current)
      socketRef.current?.disconnect()
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  async function startGeolocation() {
    setGeoState('pending')
    try {
      const position = await getPosition()
      setGeoState('resolving')
      const location = await resolveLocation(position.coords.latitude, position.coords.longitude)
      setCity(location.city)
      setCityCountry(location.country ?? null)
      setPreviewTimezone(location.timezone ?? 'UTC')
      setGeoState('resolved')
      fetchEvents(location.channelId).then(data => {
        const tz = location.timezone ?? 'UTC'
        const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
        const todayEvents = data.events.filter(e =>
          new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
        )
        setPreviewEventCount(todayEvents.length)
        const now = Date.now()
        const filtered = todayEvents
          .filter(e => (e.starts_at * 1000 - now) / 60000 >= -30)
          .sort((a, b) => a.starts_at - b.starts_at)
          .slice(0, 3)
        setPreviewEvents(filtered)
      }).catch(() => {})
      return location
    } catch (err) {
      // GeolocationPositionError.PERMISSION_DENIED = code 1
      // POSITION_UNAVAILABLE = 2, TIMEOUT = 3 — permission was granted but no fix
      if (err && err.code === 1) {
        setGeoState('denied')
      } else {
        // covers: no geolocation API, GPS unavailable/timeout, network/server error
        setGeoState('error')
      }
      return null
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'))
        return
      }
      // Pass the raw GeolocationPositionError so callers can inspect .code
      navigator.geolocation.getCurrentPosition(resolve, (err) => reject(err))
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

  async function handleJoin(e, rejoinData = null) {
    if (e) e.preventDefault()
    const name = rejoinData?.nickname ?? (nickname.trim() || generateNickname())
    setNickname(name)
    nicknameRef.current = name
    setStatus('joining')
    try {
      const location = rejoinData
        ? { channelId: rejoinData.channelId, city: rejoinData.city, timezone: 'UTC' }
        : await locPromiseRef.current
      if (!location && !rejoinData) {
        // Geo was denied before a city was selected — return to onboarding
        setStatus('onboarding')
        return
      }
      if (rejoinData?.city) setCity(rejoinData.city)
      const session = await createGuestSession(name)
      setGuest(session)
      setChannelId(location.channelId)
      setCityTimezone(location.timezone ?? 'UTC')
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
      saveIdentity(name, location.channelId, location.city ?? rejoinData?.city ?? null)
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

      socket.on('event_presence_update', ({ eventId, count }) => {
        setEventPresence(prev => ({ ...prev, [eventId]: count }))
      })

      socket.on('event_participants_update', ({ eventId, count }) => {
        setEventParticipants(prev => ({ ...prev, [eventId]: count }))
      })

      // Socket: handle newEvent for real-time events list refresh
      socket.on('newEvent', ({ cityId }) => {
        if (activeChannelRef.current !== cityId) return
        fetchEvents(cityId).then(data => {
          if (activeChannelRef.current === cityId) setEvents(data.events)
        }).catch(() => {})
      })

      socket.joinRoom(location.channelId, sessionIdRef.current, name)

      // ── Periodic heartbeat: keeps session alive regardless of tab visibility ──
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

      // ── Events: fetch + poll (30s) ───────────────────────────────────────────
      const doEventsPoll = async () => {
        if (!activeRef.current) return
        try {
          const [evData, cityEvData] = await Promise.all([
            fetchEvents(location.channelId),
            fetchCityEvents(location.channelId),
          ])
          if (activeChannelRef.current === location.channelId) {
            setEvents(evData.events)
            setCityEvents(cityEvData.events)
          }
        } catch { /* ignore */ }
      }
      doEventsPoll()
      clearInterval(eventsPolRef.current)
      eventsPolRef.current = setInterval(doEventsPoll, 30_000)
    } catch (err) {
      if (rejoinData) {
        // stored channel may no longer exist — fall back to home
        clearIdentity()
        setStatus('onboarding')
      } else {
        setError(err.message)
        setStatus('error')
      }
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

  async function handleImageSelect(e) {
    const file = e.target.files?.[0]
    // Reset so selecting the same file again triggers onChange
    e.target.value = ''
    if (!file) return

    // Client-side pre-flight — real validation happens on the server too
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      alert('Please select a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image too large. Max size: 10 MB.')
      return
    }

    stopTyping()
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      const msg = await sendImageMessage(channelId, sessionIdRef.current, guest.guestId, nickname, url)
      knownIdsRef.current.add(msg.id)
      setFeed((prev) => [...prev, { ...msg }])
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    stopTyping()
    setSending(true)
    try {
      let msg
      if (activeEventIdRef.current) {
        msg = await sendEventMessage(activeEventIdRef.current, guest.guestId, nickname, content)
      } else {
        msg = await sendMessage(channelId, sessionIdRef.current, guest.guestId, nickname, content)
      }
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
    setCitySearchQuery('')
    setChannelsLoading(true)
    setChannelEventCounts({})
    let loadedChannels = []
    try {
      const data = await fetchChannels()
      loadedChannels = data.channels
      setChannels(loadedChannels)
    } catch {
      setChannels([])
    } finally {
      setChannelsLoading(false)
    }
    if (loadedChannels.length === 0) return
    // Fetch event counts only for cities that have any activity.
    // Inactive cities (0 users, 0 messages) almost certainly have no events — skip them.
    // This keeps the call count small while guaranteeing correct counts for all visible rows.
    const candidates = loadedChannels.filter(ch => ch.activeUsers > 0 || ch.messageCount > 0)
    const counts = {}
    await Promise.allSettled(candidates.map(async (ch) => {
      try {
        const [evData, cityEvData] = await Promise.all([
          fetchEvents(ch.channelId),
          fetchCityEvents(ch.channelId),
        ])
        const tz = ch.timezone || 'UTC'
        const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
        const hiladsCount = evData.events.filter(e =>
          new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
        ).length
        const cityCount = (cityEvData.events ?? []).filter(e =>
          new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
        ).length
        counts[ch.channelId] = hiladsCount + cityCount
      } catch { /* ignore */ }
    }))
    setChannelEventCounts({ ...counts })
  }

  async function openObCityPicker() {
    setObPickingCity(true)
    setCitySearchQuery('')
    setObChannelsLoading(true)
    setObChannelEventCounts({})
    let loadedChannels = []
    try {
      const data = await fetchChannels()
      loadedChannels = data.channels
      setObChannels(loadedChannels)
    } catch {
      setObChannels([])
    } finally {
      setObChannelsLoading(false)
    }
    if (loadedChannels.length === 0) return
    const candidates = loadedChannels.filter(ch => ch.activeUsers > 0 || ch.messageCount > 0)
    const counts = {}
    await Promise.allSettled(candidates.map(async (ch) => {
      try {
        const [evData, cityEvData] = await Promise.all([
          fetchEvents(ch.channelId),
          fetchCityEvents(ch.channelId),
        ])
        const tz = ch.timezone || 'UTC'
        const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
        const hiladsCount = evData.events.filter(e =>
          new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
        ).length
        const cityCount = (cityEvData.events ?? []).filter(e =>
          new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
        ).length
        counts[ch.channelId] = hiladsCount + cityCount
      } catch { /* ignore */ }
    }))
    setObChannelEventCounts({ ...counts })
  }

  function joinCityFromOb(newChannelId, cityName, timezone, country) {
    setObPickingCity(false)
    setCity(cityName)
    setCityCountry(country ?? null)
    locPromiseRef.current = Promise.resolve({ channelId: newChannelId, city: cityName, timezone: timezone ?? 'UTC', country: country ?? null })
    handleJoin(null)
  }

  function retryGeo() {
    setGeoState('pending')
    locPromiseRef.current = startGeolocation()
  }

  async function switchCity(newChannelId, newCityName, newCityTimezone, newCityCountry) {
    if (newChannelId === channelId) {
      setShowCityPicker(false)
      return
    }
    setShowCityPicker(false)
    setCityCountry(newCityCountry ?? null)

    // stop everything tied to the previous room
    activeRef.current = false
    pollFnRef.current = null // prevent visibility handler from calling old room's poll
    clearTimeout(activityRef.current)
    clearTimeout(typingTimeoutRef.current)
    isTypingRef.current = false
    setTypingUsers([])
    clearInterval(pollRef.current)
    clearInterval(heartbeatRef.current)
    clearInterval(eventsPolRef.current)
    clearInterval(cityEventsPolRef.current)
    socketRef.current?.leaveRoom(channelId, sessionIdRef.current)

    // mark which channel we're switching to — used to discard stale async results
    activeChannelRef.current = newChannelId

    // reset all room-specific state immediately so UI never shows stale data
    setFeed([])
    setOnlineUsers([])
    knownIdsRef.current = new Set()
    setCity(newCityName)
    setChannelId(newChannelId)
    saveIdentity(nickname, newChannelId, newCityName)
    setCityTimezone(newCityTimezone ?? 'UTC')
    setEvents([])
    setCityEvents([])
    setActiveEventId(null)
    setActiveEvent(null)
    activeEventIdRef.current = null

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

      // Events: fetch + poll for new city
      const doEventsPoll = async () => {
        if (!activeRef.current) return
        try {
          const [evData, cityEvData] = await Promise.all([
            fetchEvents(newChannelId),
            fetchCityEvents(newChannelId),
          ])
          if (activeChannelRef.current === newChannelId) {
            setEvents(evData.events)
            setCityEvents(cityEvData.events)
          }
        } catch { /* ignore */ }
      }
      doEventsPoll()
      eventsPolRef.current = setInterval(doEventsPoll, 30_000)
    } catch {
      // silently fail — user stays with empty feed for new city
    }
  }

  // Switch to an event's chat
  function handleSelectEvent(event) {
    if (activeEventIdRef.current === event.id) {
      setShowEventDrawer(false)
      return
    }

    // Leave previous event if switching from one event to another
    if (activeEventIdRef.current) {
      socketRef.current?.leaveEvent(activeEventIdRef.current, sessionIdRef.current)
    }

    // Pause city/current-event polling
    clearInterval(pollRef.current)
    pollFnRef.current = null

    const eid = event.id
    activeEventIdRef.current = eid
    socketRef.current?.joinEvent(eid, sessionIdRef.current)
    setActiveEventId(eid)
    setActiveEvent(event)
    setShowEventDrawer(false)
    setFeed([])
    knownIdsRef.current = new Set()

    const doPoll = async () => {
      if (!activeRef.current) return
      const latest = await fetchEventMessages(eid)
      if (activeEventIdRef.current !== eid) return
      const newMsgs = latest.messages.filter(m => !knownIdsRef.current.has(m.id))
      if (newMsgs.length > 0) {
        newMsgs.forEach(m => knownIdsRef.current.add(m.id))
        setFeed(prev => [...prev, ...newMsgs.map(m => ({ type: 'message', ...m }))])
      }
    }

    doPoll()
    pollFnRef.current = doPoll
    pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)
  }

  // Fetch persistent participation state when active event changes
  useEffect(() => {
    if (!activeEvent?.id || !sessionIdRef.current) return
    fetchEventParticipants(activeEvent.id, sessionIdRef.current).then(({ count, isIn }) => {
      setEventParticipants(prev => ({ ...prev, [activeEvent.id]: count }))
      setParticipatedEvents(prev => {
        const next = new Set(prev)
        isIn ? next.add(activeEvent.id) : next.delete(activeEvent.id)
        return next
      })
    }).catch(() => {})
  }, [activeEvent?.id])

  // Bulk-fetch participant counts for all today's events when the Hot drawer opens
  useEffect(() => {
    if (!showEventDrawer || !sessionIdRef.current) return
    const tz = cityTimezone || 'UTC'
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
    const isEventToday = e => new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz }) === today
    ;[...events, ...cityEvents].filter(isEventToday).forEach(event => {
      fetchEventParticipants(event.id, sessionIdRef.current).then(({ count, isIn }) => {
        setEventParticipants(prev => ({ ...prev, [event.id]: count }))
        setParticipatedEvents(prev => {
          const next = new Set(prev)
          isIn ? next.add(event.id) : next.delete(event.id)
          return next
        })
      }).catch(() => {})
    })
  }, [showEventDrawer])

  // Toggle "I'm in" participation for an event
  async function handleToggleParticipation(eventId) {
    try {
      const { count, isIn } = await toggleEventParticipation(eventId, sessionIdRef.current)
      setEventParticipants(prev => ({ ...prev, [eventId]: count }))
      setParticipatedEvents(prev => {
        const next = new Set(prev)
        isIn ? next.add(eventId) : next.delete(eventId)
        return next
      })
    } catch {
      // silent — state stays as-is
    }
  }

  // Return to city chat from an event
  function handleBackToCity() {
    if (activeEventIdRef.current) {
      socketRef.current?.leaveEvent(activeEventIdRef.current, sessionIdRef.current)
    }

    clearInterval(pollRef.current)
    pollFnRef.current = null

    const cid = activeChannelRef.current
    activeEventIdRef.current = null
    setActiveEventId(null)
    setActiveEvent(null)
    setFeed([])
    knownIdsRef.current = new Set()

    // Re-fetch city messages
    fetchMessages(cid).then(data => {
      if (activeEventIdRef.current !== null || activeChannelRef.current !== cid) return
      knownIdsRef.current = new Set(data.messages.map(messageKey))
      const total = data.messages.length
      setFeed(data.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      }))
    }).catch(() => {})

    const doPoll = async () => {
      if (!activeRef.current) return
      const latest = await fetchMessages(cid)
      if (activeChannelRef.current !== cid || activeEventIdRef.current !== null) return
      const newMsgs = latest.messages.filter(m => !knownIdsRef.current.has(messageKey(m)))
      if (newMsgs.length > 0) {
        newMsgs.forEach(m => knownIdsRef.current.add(messageKey(m)))
        const items = newMsgs.map(m => toFeedItem(m))
        setFeed(prev => [...prev, ...items])
        items.forEach(item => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
      }
    }

    pollFnRef.current = doPoll
    pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)
  }

  // Refresh events list after creation
  function handleEventCreated(newEvent) {
    setShowCreateEvent(false)
    setCreateFromDrawer(false)
    // Optimistic update: show the new event immediately using the POST response,
    // so the creator doesn't see a blank gap while the re-fetch is in flight.
    if (newEvent?.id) {
      setEvents(prev => [...prev, newEvent])
    }
    // Confirm with server (catches any server-side pruning or ordering)
    const cid = activeChannelRef.current
    if (!cid) return
    fetchEvents(cid).then(data => {
      if (activeChannelRef.current === cid) setEvents(data.events)
    }).catch(() => {})
  }

  const typingLabel = typingText(typingUsers, sessionIdRef.current)

  // ── City scoring ────────────────────────────────────────────────────────────

  function cityScore(ch, eventCount) {
    return (eventCount * 10) + (ch.activeUsers * 3)
  }

  // ── Shared city row renderer ────────────────────────────────────────────────

  function renderCityRow(ch, eventCount, onClick, isActive = false) {
    const hasActivity = ch.activeUsers > 0
    return (
      <button
        key={ch.channelId}
        className={`city-row${isActive ? ' active' : ''}`}
        onClick={() => onClick(ch)}
      >
        <div className="city-row-left">
          <span className={`activity-dot${hasActivity ? ' live' : ''}`} />
          <span style={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>{cityFlag(ch.country)}</span>
          <span className="city-row-name">{ch.city}</span>
          {isActive && <span className="city-row-current">you're here</span>}
        </div>
        <div className="city-row-stats">
          {ch.activeUsers > 0 && <span className="city-row-users">{ch.activeUsers} online</span>}
          {eventCount > 0 && <span className="city-row-events">🔥 {eventCount} {eventCount === 1 ? 'event' : 'events'}</span>}
          {ch.messageCount > 0 && <span className="city-row-count">{ch.messageCount} msgs</span>}
        </div>
      </button>
    )
  }

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
                <div>
                  <span className="ob-city-name">{city} <span style={{ fontSize: '0.8em', verticalAlign: 'middle', WebkitTextFillColor: 'initial' }}>{cityFlag(cityCountry)}</span></span>
                </div>
                <p className="ob-tagline">See who's around. Say hi instantly.</p>
                <span className="ob-live"><span className="ob-live-fire">🔥</span> {previewLiveCount} {previewLiveCount === 1 ? 'person' : 'people'} hanging out right now</span>
                {previewEventCount > 0 && (
                  <span className="ob-city-sub ob-event-count">
                    🔥 {previewEventCount} event{previewEventCount > 1 ? 's' : ''} happening today
                  </span>
                )}
                {previewEvents.length > 0 ? (
                  <div className="ob-events-preview">
                    {previewEvents.map(e => (
                      <div key={e.id} className="ob-event-row">
                        <span className="ob-event-title">{EVENT_ICONS[e.type] ?? '📌'} {e.title}</span>
                        <span className="ob-event-time">{getTimeLabel(e.starts_at, previewTimezone)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : geoState === 'denied' ? (
              <>
                <span className="ob-geo-status ob-geo-status--denied">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  Location off
                </span>
                <p className="ob-geo-headline">Pick a city<br />and jump in</p>
              </>
            ) : geoState === 'error' ? (
              <>
                <span className="ob-geo-status ob-geo-status--warn">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  Couldn't reach your location
                </span>
                <p className="ob-geo-headline">Pick a city<br />and jump in</p>
              </>
            ) : geoState === 'resolving' ? (
              <span className="ob-locating">› locating...</span>
            ) : (
              <span className="ob-locating">› requesting location...</span>
            )}
          </div>

          <form className="ob-form" onSubmit={(geoState === 'denied' || geoState === 'error') ? (e) => { e.preventDefault(); openObCityPicker() } : handleJoin}>
            {(geoState === 'denied' || geoState === 'error') ? (
              <>
                <button type="submit" className="ob-btn">Browse cities →</button>
                <label className="ob-label" style={{ marginTop: 4 }}>Your name</label>
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
                    placeholder="Say hi as..."
                  />
                </div>
                {navigator.geolocation && (
                  <button type="button" className="ob-geo-retry" onClick={retryGeo}>
                    {geoState === 'error' ? 'Try again' : 'Use my location instead'}
                  </button>
                )}
              </>
            ) : (
              <>
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
                    placeholder="Say hi as..."
                  />
                </div>
                <button type="submit" className="ob-btn">
                  {city ? `Join ${city}` : 'Join Chat'} →
                </button>
              </>
            )}
            <p className="ob-hint">// anonymous · no sign-up</p>
          </form>
        </div>

        {obPickingCity && (
          <div className="full-page">
            <div className="page-header">
              <button className="page-back-btn" onClick={() => setObPickingCity(false)}>←</button>
              <span className="page-title">Pick a city</span>
            </div>
            <div className="city-search-wrap">
              <input
                className="city-search-input"
                type="search"
                placeholder="Search a city…"
                value={citySearchQuery}
                onChange={e => setCitySearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="page-body">
              {obChannelsLoading ? (
                <div className="city-skeleton">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="city-skeleton-row">
                      <div className="city-skeleton-left">
                        <div className="skel skel-dot" />
                        <div className="skel skel-flag" />
                        <div className="skel skel-name" style={{ width: `${52 + (i * 17) % 34}%` }} />
                      </div>
                      <div className="skel skel-stat" />
                    </div>
                  ))}
                </div>
              ) : (() => {
                const q = citySearchQuery.trim().toLowerCase()
                const sorted = [...obChannels]
                  .filter(ch => !q || ch.city.toLowerCase().includes(q))
                  .sort((a, b) => {
                    const scoreA = cityScore(a, obChannelEventCounts[a.channelId] ?? 0)
                    const scoreB = cityScore(b, obChannelEventCounts[b.channelId] ?? 0)
                    if (scoreB !== scoreA) return scoreB - scoreA
                    return a.city.localeCompare(b.city)
                  })
                if (sorted.length === 0) return <div className="city-no-results">No city found for "{citySearchQuery}"</div>
                if (q) {
                  return sorted.map(ch => renderCityRow(
                    ch,
                    obChannelEventCounts[ch.channelId] ?? 0,
                    (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country)
                  ))
                }
                const top10 = sorted
                  .filter(ch => cityScore(ch, obChannelEventCounts[ch.channelId] ?? 0) > 0)
                  .slice(0, 10)
                if (top10.length === 0) return <div className="city-no-results">No active cities right now</div>
                return (
                  <>
                    <div className="city-list-label">Top cities right now</div>
                    {top10.map(ch => renderCityRow(
                      ch,
                      obChannelEventCounts[ch.channelId] ?? 0,
                      (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country)
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        )}
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

      {/* Events sidebar — desktop only */}
      <EventsSidebar
        events={events}
        cityEvents={cityEvents}
        activeEventId={activeEventId}
        cityTimezone={cityTimezone}
        eventPresence={eventPresence}
        eventParticipants={eventParticipants}
        onSelectEvent={handleSelectEvent}
        onCreateClick={() => setShowCreateEvent(true)}
      />

      <div className="screen chat">
        <header className="chat-header">
          {activeEvent ? (
            /* Event mode */
            <div className="event-header">
              <div className="event-header-top">
                <button className="event-back-btn" onClick={handleBackToCity}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <span className="event-back-label">{city}</span>
                </button>
                <button
                  className={`event-join-btn${participatedEvents.has(activeEvent.id) ? ' event-join-btn--active' : ''}`}
                  onClick={() => handleToggleParticipation(activeEvent.id)}
                >
                  {participatedEvents.has(activeEvent.id) ? 'Going' : 'Join'}
                </button>
              </div>
              <div className="event-header-body">
                <span className="event-header-title">{activeEvent.title}</span>
                <span className="event-meta-label">
                  {getTimeLabel(activeEvent.starts_at, cityTimezone || 'UTC')}
                  {activeEvent.location_hint && ` · ${activeEvent.location_hint}`}
                  {` · ${eventPresence[activeEvent.id] ?? 0} here · ${eventParticipants[activeEvent.id] ?? 0} going`}
                </span>
              </div>
            </div>
          ) : (
            /* City mode: centered hero header */
            <div className="header-hero">
              <Logo variant="icon" size="lg" />
              <div className="header-hero-city">
                <span className="header-hero-name">
                  {cityFlag(cityCountry)} {city}
                </span>
                <span className="online-label">
                  <span className="online-pulse" />
                  {onlineCount != null ? `${onlineCount} hanging out` : 'live now'}
                </span>
              </div>
            </div>
          )}
          {/* Desktop-only controls */}
          <div className="header-desktop-controls">
            <button className="change-city-btn" onClick={openCityPicker} title="Switch city">
              🌍 <span className="city-btn-name">{city || '…'}</span> <span className="city-btn-arrow">⌄</span>
            </button>
            <span className="you-badge">👤 {guest?.nickname}</span>
          </div>
        </header>

        <div className="messages">
          {feed.length === 0 && (
            <div className="empty">
              <p className="empty-icon">{activeEvent ? '💬' : '🔥'}</p>
              <p className="empty-title">
                {activeEvent ? `${activeEvent.title}` : 'People are arriving'}
              </p>
              <p className="empty-sub">
                {activeEvent
                  ? 'Be the first to chat here 👇'
                  : 'Be the first to say hi 👇'
                }
              </p>
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
            // group consecutive messages/images from the same sender
            const isGrouped = prevItem?.guestId === item.guestId && prevItem?.type !== 'activity'
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
                  {item.type === 'image' ? (
                    <img
                      src={item.imageUrl}
                      className="msg-image"
                      alt="shared image"
                      onClick={() => setLightboxUrl(item.imageUrl)}
                    />
                  ) : (
                    <span className="msg-content">{item.content}</span>
                  )}
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
          {/* Hidden file picker — triggered by the image button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleImageSelect}
          />
          <button
            type="button"
            className="upload-btn"
            title={activeEventId ? 'Images not supported in event chat' : 'Send image'}
            disabled={uploading || sending || !!activeEventId}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <span className="upload-spinner" /> : <ImageIcon />}
          </button>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={activeEvent
              ? `Chat about ${activeEvent.title}…`
              : city ? PLACEHOLDERS[channelId % PLACEHOLDERS.length]() : ''
            }
            maxLength={1000}
            autoFocus
          />
          <button type="submit" disabled={sending || !input.trim()} className="send-btn">
            <SendIcon />
          </button>
        </form>

        {/* Bottom navigation — mobile only */}
        <nav className="bottom-nav">
          <button
            className={`bottom-nav-tab${showEventDrawer ? ' active' : ''}`}
            onClick={() => setShowEventDrawer(true)}
          >
            <span className="bottom-nav-icon"><NavIconEvents /></span>
            <span className="bottom-nav-label">Hot</span>
          </button>
          <button
            className={`bottom-nav-tab${showCityPicker ? ' active' : ''}`}
            onClick={openCityPicker}
          >
            <span className="bottom-nav-icon"><NavIconCity /></span>
            <span className="bottom-nav-label">Cities</span>
          </button>
          <button
            className={`bottom-nav-tab${showPeopleDrawer ? ' active' : ''}`}
            onClick={() => setShowPeopleDrawer(true)}
          >
            <span className="bottom-nav-icon"><NavIconPeople /></span>
            <span className="bottom-nav-label">Here</span>
          </button>
          <button
            className={`bottom-nav-tab${showProfileDrawer ? ' active' : ''}`}
            onClick={() => { setProfileNickInput(nickname); setShowProfileDrawer(true) }}
          >
            <span className="bottom-nav-icon"><NavIconProfile /></span>
            <span className="bottom-nav-label">Me</span>
          </button>
        </nav>
      </div>

      {/* ── Full-screen pages ─────────────────────────── */}

      {showCityPicker && (
        <div className="full-page">
          <div className="page-header">
            <button className="page-back-btn" onClick={() => setShowCityPicker(false)}>←</button>
            <span className="page-title">Switch city</span>
          </div>
          <div className="city-search-wrap">
            <input
              className="city-search-input"
              type="search"
              placeholder="Search a city…"
              value={citySearchQuery}
              onChange={e => setCitySearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="page-body">
            {channelsLoading ? (
              <div className="city-skeleton">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="city-skeleton-row">
                    <div className="city-skeleton-left">
                      <div className="skel skel-dot" />
                      <div className="skel skel-flag" />
                      <div className="skel skel-name" style={{ width: `${52 + (i * 17) % 34}%` }} />
                    </div>
                    <div className="skel skel-stat" />
                  </div>
                ))}
              </div>
            ) : (() => {
              const q = citySearchQuery.trim().toLowerCase()
              const sorted = [...channels]
                .filter(ch => !q || ch.city.toLowerCase().includes(q))
                .sort((a, b) => {
                  const scoreA = cityScore(a, channelEventCounts[a.channelId] ?? 0)
                  const scoreB = cityScore(b, channelEventCounts[b.channelId] ?? 0)
                  if (scoreB !== scoreA) return scoreB - scoreA
                  return a.city.localeCompare(b.city)
                })
              if (sorted.length === 0) return <div className="city-no-results">No city found for "{citySearchQuery}"</div>
              if (q) {
                // Search mode — all matches, full metrics, no limit
                return sorted.map(ch => renderCityRow(
                  ch,
                  channelEventCounts[ch.channelId] ?? 0,
                  (ch) => switchCity(ch.channelId, ch.city, ch.timezone, ch.country),
                  ch.channelId === channelId
                ))
              }
              // Default mode — top 10 active cities only (score > 0)
              const top10 = sorted
                .filter(ch => cityScore(ch, channelEventCounts[ch.channelId] ?? 0) > 0)
                .slice(0, 10)
              if (top10.length === 0) return <div className="city-no-results">No active cities right now</div>
              return (
                <>
                  <div className="city-list-label">Top cities right now</div>
                  {top10.map(ch => renderCityRow(
                    ch,
                    channelEventCounts[ch.channelId] ?? 0,
                    (ch) => switchCity(ch.channelId, ch.city, ch.timezone, ch.country),
                    ch.channelId === channelId
                  ))}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {showEventDrawer && (
        <div className="full-page">
          <div className="page-header">
            <button className="page-back-btn" onClick={() => setShowEventDrawer(false)}>←</button>
            <span className="page-title">Hot</span>
          </div>
          <div className="page-body page-body--has-fab">
            {(() => {
              const openCreate = () => { setShowEventDrawer(false); setShowCreateEvent(true); setCreateFromDrawer(true) }
              const tz = cityTimezone || 'UTC'
              const isEventToday = e => {
                const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
                const eventDay = new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: tz })
                return today === eventDay
              }
              const todayHilads = events.filter(isEventToday)
              const todayCity = cityEvents.filter(isEventToday)
              const renderEventRow = event => {
                const going = eventParticipants[event.id] ?? 0
                return (
                  <button
                    key={event.id}
                    className={`city-row${activeEventId === event.id ? ' active' : ''}${going >= 3 ? ' event-row--buzzing' : ''}`}
                    onClick={() => handleSelectEvent(event)}
                  >
                    <div className="city-row-left">
                      <span className="city-row-name">
                        {EVENT_ICONS[event.type] ?? '📌'} {event.title}
                      </span>
                      <span className="city-row-current">
                        {new Date(event.starts_at * 1000).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })}
                        {event.location_hint && ` · ${event.location_hint}`}
                      </span>
                    </div>
                    {going > 0 && (
                      <div className="city-row-stats">
                        <span className="event-going-count">👥 {going}</span>
                      </div>
                    )}
                  </button>
                )
              }
              if (todayHilads.length === 0 && todayCity.length === 0) {
                return (
                  <div className="events-empty-state">
                    <p className="events-empty-title">Nothing on yet</p>
                    <p className="events-empty-sub">Be the first to make something happen in {city}</p>
                    <button className="events-empty-cta" onClick={openCreate}>Create event</button>
                  </div>
                )
              }
              return (
                <>
                  {todayCity.length > 0 && <p className="events-group-label" style={{ padding: '10px 12px 2px' }}>Hilads Events</p>}
                  {todayHilads.length === 0 && todayCity.length > 0 && <p className="events-empty-drawer" style={{ padding: '8px 12px' }}>No Hilads events today</p>}
                  {todayHilads.map(renderEventRow)}
                  {todayCity.length > 0 && <p className="events-group-label events-group-label--city" style={{ padding: '10px 12px 2px' }}>City Events</p>}
                  {todayCity.map(renderEventRow)}
                </>
              )
            })()}
          </div>
          {/* Floating action button */}
          <button
            className="events-fab"
            onClick={() => { setShowEventDrawer(false); setShowCreateEvent(true); setCreateFromDrawer(true) }}
            aria-label="Create event"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      )}

      {showPeopleDrawer && (
        <div className="full-page">
          <div className="page-header">
            <button className="page-back-btn" onClick={() => setShowPeopleDrawer(false)}>←</button>
            <span className="page-title">People here · {onlineUsers.length}</span>
          </div>
          <div className="page-body">
            {onlineUsers.map((user) => {
              const [c1, c2] = avatarColors(user.nickname)
              return (
                <div key={user.id} className="people-drawer-row">
                  <span
                    className="online-avatar"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                    data-me={user.isMe ? 'true' : undefined}
                  >
                    {user.nickname[0].toUpperCase()}
                  </span>
                  <span className="people-drawer-name">
                    {user.nickname}
                    {user.isMe && <span className="people-drawer-you"> (you)</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showProfileDrawer && (
        <div className="full-page">
          <div className="page-header">
            <button className="page-back-btn" onClick={() => setShowProfileDrawer(false)}>←</button>
            <span className="page-title">Your profile</span>
          </div>
          <div className="page-body page-body--centered">
            {(() => {
              const [c1, c2] = avatarColors(profileNickInput || nickname)
              return (
                <div className="profile-avatar-row">
                  <span
                    className="online-avatar profile-avatar-lg"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    {(profileNickInput || nickname)[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
              )
            })()}
            <div className="modal-field">
              <label className="modal-label">Nickname</label>
              <input
                className="modal-input"
                type="text"
                value={profileNickInput}
                onChange={(e) => setProfileNickInput(e.target.value)}
                maxLength={20}
                placeholder="Your name..."
              />
            </div>
            <button
              className="modal-submit"
              onClick={() => {
                const trimmed = profileNickInput.trim()
                if (trimmed) {
                  setNickname(trimmed)
                  nicknameRef.current = trimmed
                  saveIdentity(trimmed, channelId, city)
                }
                setShowProfileDrawer(false)
              }}
              disabled={!profileNickInput.trim()}
            >
              Save
            </button>
            <p className="profile-hint">// anonymous · no sign-up</p>
          </div>
        </div>
      )}

      {/* Create event — full-screen page */}
      {showCreateEvent && (
        <CreateEventPage
          channelId={channelId}
          guest={guest}
          nickname={nickname}
          cityTimezone={cityTimezone}
          onCreated={handleEventCreated}
          onBack={() => {
            setShowCreateEvent(false)
            if (createFromDrawer) { setShowEventDrawer(true) }
            setCreateFromDrawer(false)
          }}
        />
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
                  {user.nickname}
                  {user.isMe && <span className="sidebar-you"> (you)</span>}
                </span>
              </div>
            )
          })}
        </aside>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
          <img
            src={lightboxUrl}
            className="lightbox-img"
            alt="full-size preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
