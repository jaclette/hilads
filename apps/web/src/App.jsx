import { useState, useEffect, useRef, useMemo } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage, fetchChannels, joinChannel, disconnectBeacon, uploadImage, sendImageMessage, fetchEvents, fetchCityEvents, fetchCityMembers, fetchEventMessages, sendEventMessage, sendEventImageMessage, fetchEventParticipants, toggleEventParticipation, authMe, authLogout, createOrGetDirectConversation, fetchConversations, markEventRead, fetchCityBySlug, fetchEventById, fetchUnreadCount, fetchMyEvents, deleteEvent, fetchUserEvents, fetchUserFriends } from './api'
import { createSocket } from './socket'
import { cityFlag, EVENT_ICONS } from './cityMeta'
import { getTimeLabel, getEventLocation, getEventMapsUrl, formatTime } from './eventUtils'
import Logo from './components/Logo'
import EventsSidebar from './components/EventsSidebar'
import CreateEventPage from './components/CreateEventModal'
import AuthScreen from './components/AuthScreen'
import ProfileScreen from './components/ProfileScreen'
import PublicProfileScreen from './components/PublicProfileScreen'
import GuestProfileCard from './components/GuestProfileCard'
import ConversationsScreen from './components/ConversationsScreen'
import DirectMessageScreen from './components/DirectMessageScreen'
import NotificationsScreen from './components/NotificationsScreen'
import BackButton from './components/BackButton'
import SendButton from './components/SendButton'
import InstallPromptBanner from './components/InstallPromptBanner'
import useBeforeInstallPrompt from './hooks/useBeforeInstallPrompt'
import { registerPush, unregisterPush } from './push'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cityToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseDeepLink() {
  const path = window.location.pathname
  const cityMatch  = path.match(/^\/city\/([^/]+)$/)
  const eventMatch = path.match(/^\/event\/([a-f0-9]{16})$/)
  if (cityMatch)           return { type: 'city',          slug: cityMatch[1] }
  if (eventMatch)          return { type: 'event',         id: eventMatch[1] }
  if (path === '/conversations') return { type: 'conversations' }
  if (path === '/notifications') return { type: 'notifications' }
  return null
}

function pushUrl(path) {
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path)
  }
}

function setPageMeta(title, description) {
  document.title = title
  let desc = document.querySelector('meta[name="description"]')
  if (!desc) { desc = document.createElement('meta'); desc.name = 'description'; document.head.appendChild(desc) }
  desc.content = description
  let ogTitle = document.querySelector('meta[property="og:title"]')
  if (!ogTitle) { ogTitle = document.createElement('meta'); ogTitle.setAttribute('property', 'og:title'); document.head.appendChild(ogTitle) }
  ogTitle.content = title
  let ogDesc = document.querySelector('meta[property="og:description"]')
  if (!ogDesc) { ogDesc = document.createElement('meta'); ogDesc.setAttribute('property', 'og:description'); document.head.appendChild(ogDesc) }
  ogDesc.content = description
  let ogUrl = document.querySelector('meta[property="og:url"]')
  if (!ogUrl) { ogUrl = document.createElement('meta'); ogUrl.setAttribute('property', 'og:url'); document.head.appendChild(ogUrl) }
  ogUrl.content = window.location.href
}

async function share(title, url) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return } catch (_) { /* user cancelled */ }
  }
  // navigator.clipboard requires HTTPS + user gesture; unavailable on http or older Safari
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch (_) {}
  }
  // Fallback: execCommand works on Safari and http
  try {
    const el = document.createElement('input')
    el.value = url
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return 'copied'
  } catch (_) {}
}

// ── Bottom nav icons ──────────────────────────────────────────────────────────

const NAV_ICON_PROPS = {
  width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.9',
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
      <circle cx="18.5" cy="5" r="2.2" fill="var(--hot-dot)" stroke="none" />
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
      <circle cx="19.5" cy="5" r="2.2" fill="var(--profile-dot)" stroke="none" />
    </svg>
  )
}

// ── Chat icons ────────────────────────────────────────────────────────────────

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
  if (name == null) console.warn('[avatarColors] called with', name, new Error().stack?.split('\n')[2]?.trim())
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── My event row (used in both guest and registered Me screens) ──────────────

function MyEventRow({ event, cityTimezone, onSelect, onDelete }) {
  const now = Date.now() / 1000
  const isLive = event.starts_at <= now && event.expires_at > now
  return (
    <div className="my-event-row">
      <button className="my-event-row-body" onClick={onSelect}>
        <span className="my-event-title">{EVENT_ICONS[event.type] ?? '📌'} {event.title}</span>
        <span className="my-event-meta">
          {event.recurrence_label
            ? event.recurrence_label
            : getTimeLabel(event.starts_at, cityTimezone || 'UTC') + (event.ends_at ? ` → ${formatTime(event.ends_at, cityTimezone || 'UTC')}` : '')}
        </span>
        <span className={`my-event-badge${isLive ? ' my-event-badge--live' : (event.recurrence_label ? ' my-event-badge--recurring' : '')}`}>
          {isLive ? 'Live' : (event.recurrence_label ? '↻ Recurring' : 'Upcoming')}
        </span>
      </button>
      <button className="my-event-delete" onClick={onDelete} aria-label="Delete event">✕</button>
    </div>
  )
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

// ── Vibe display ──────────────────────────────────────────────────────────────

const VIBE_META = {
  party:       { emoji: '🔥', label: 'Party' },
  board_games: { emoji: '🎲', label: 'Board Games' },
  coffee:      { emoji: '☕', label: 'Coffee' },
  music:       { emoji: '🎧', label: 'Music' },
  food:        { emoji: '🍜', label: 'Food' },
  chill:       { emoji: '🧘', label: 'Chill' },
}

function messageKey(m) {
  if (m.type === 'system' && m.event === 'join') return `system_${m.createdAt}_${m.nickname}`
  return m.id
}

// ── Message time / date utilities (mirrors native src/lib/messageTime.ts) ─────

function normalizePgTs(ts) {
  return ts
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
}

function tsToMs(ts) {
  if (ts === undefined || ts === null || ts === '') return 0
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts
  const ms = new Date(normalizePgTs(ts)).getTime()
  return isNaN(ms) ? 0 : ms
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function msgIsSameDay(ts1, ts2) {
  if (!ts1 || !ts2) return true
  return startOfDay(new Date(tsToMs(ts1))).getTime() ===
         startOfDay(new Date(tsToMs(ts2))).getTime()
}

function formatMsgTime(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatMsgDateLabel(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date()
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString([], opts)
}

const JOIN_TEMPLATES = [
  (n) => `👋 ${n} just landed`,
  (n) => `🔥 ${n} joined the vibe`,
  (n) => `🍻 ${n} is here`,
  (n) => `👀 ${n} just showed up`,
  (n) => `✨ ${n} arrived`,
]

// lastJoinAtRef: pass the component ref so join messages are throttled to 1 per 8s.
// Returns null for suppressed joins — callers must filter nulls.
function toFeedItem(m, staggerDelay, lastJoinAtRef = null) {
  if (m.type === 'system' && m.event === 'join') {
    if (lastJoinAtRef) {
      const now = Date.now()
      if (now - lastJoinAtRef.current < 8000) return null // throttle rapid joins
      lastJoinAtRef.current = now
    }
    const tpl = JOIN_TEMPLATES[Math.floor(Math.random() * JOIN_TEMPLATES.length)]
    return { type: 'activity', subtype: 'join', id: messageKey(m), text: tpl(m.nickname), createdAt: m.createdAt, nickname: m.nickname, userId: m.userId ?? null, guestId: m.guestId ?? null }
  }
  // Weather system messages have no nickname/id — render as a subtle activity line.
  if (m.type === 'system' && m.event === 'weather') {
    console.log('[feed] weather system message:', m.content)
    return { type: 'activity', subtype: 'weather', id: `weather_${m.createdAt}`, text: m.content, createdAt: m.createdAt }
  }
  // Guard: any other system message that slips through has no nickname — skip it rather than crash.
  if (m.type === 'system') {
    console.warn('[feed] unhandled system message — skipping:', m)
    return null
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

async function fetchVisibleCityEventCount(channel) {
  const [hiladsResult, cityResult] = await Promise.allSettled([
    fetchEvents(channel.channelId),
    fetchCityEvents(channel.channelId),
  ])

  const hiladsCount = hiladsResult.status === 'fulfilled'
    ? (hiladsResult.value.events ?? []).length
    : null
  const publicCount = cityResult.status === 'fulfilled'
    ? (cityResult.value.events ?? []).length
    : null

  if (hiladsCount === null && publicCount === null) {
    throw new Error('Failed to fetch city event count')
  }

  if (hiladsResult.status === 'rejected' || cityResult.status === 'rejected') {
    console.warn('[city-count] partial fetch failure', {
      channelId: channel.channelId,
      hiladsOk: hiladsResult.status === 'fulfilled',
      publicOk: cityResult.status === 'fulfilled',
    })
  }

  const resolvedHilads = hiladsCount ?? 0
  const resolvedPublic = publicCount ?? 0
  const total = resolvedHilads + resolvedPublic

  return total
}

function rankCitiesForList(channels, fallbackCounts = {}) {
  return [...channels].sort((a, b) => {
    const scoreA = ((fallbackCounts[a.channelId] ?? 0) * 10) + (a.activeUsers * 3) + a.messageCount
    const scoreB = ((fallbackCounts[b.channelId] ?? 0) * 10) + (b.activeUsers * 3) + b.messageCount
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.city.localeCompare(b.city)
  })
}

function getDefaultCityTargets(channels, limit = 10) {
  return rankCitiesForList(channels).slice(0, limit)
}

function getSearchCityTargets(channels, query, limit = 12) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return rankCitiesForList(
    channels.filter(ch => ch.city.toLowerCase().includes(q))
  ).slice(0, limit)
}

// Unique per page load — generated fresh so duplicated tabs never share a sessionId.
// Stored as a module-level constant so the same ID is used across re-renders and
// Vite HMR fast-refresh (where the module is preserved, not reloaded).
const PAGE_SESSION_ID = crypto.randomUUID()

const IDENTITY_KEY = 'hilads_identity'

function saveIdentity(nickname, channelId, city, timezone = null) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ nickname, channelId, city, timezone }))
}

function loadIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (!raw) return null
    const { nickname, channelId, city, timezone } = JSON.parse(raw)
    if (!nickname?.trim() || !channelId) return null
    return { nickname: nickname.trim(), channelId, city: city ?? null, timezone: timezone ?? null }
  } catch {
    return null
  }
}

function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY)
}

async function hydrateSavedLocation(rejoinData) {
  if (!rejoinData?.channelId) return null
  if (rejoinData.timezone) {
    return {
      channelId: rejoinData.channelId,
      city: rejoinData.city ?? null,
      timezone: rejoinData.timezone,
      country: rejoinData.country ?? null,
    }
  }

  try {
    const data = await fetchChannels()
    const match = (data.channels ?? []).find(ch => ch.channelId === rejoinData.channelId)
    if (match) {
      return {
        channelId: match.channelId,
        city: match.city,
        timezone: match.timezone ?? 'UTC',
        country: match.country ?? null,
      }
    }
  } catch {}

  return {
    channelId: rejoinData.channelId,
    city: rejoinData.city ?? null,
    timezone: 'UTC',
    country: rejoinData.country ?? null,
  }
}

const WELCOME_KEY = 'hilads_welcomed'

function hasBeenWelcomed(channelId) {
  try {
    const raw = localStorage.getItem(WELCOME_KEY)
    return raw ? !!JSON.parse(raw)[channelId] : false
  } catch { return false }
}

function markWelcomed(channelId) {
  try {
    const raw = localStorage.getItem(WELCOME_KEY)
    const map = raw ? JSON.parse(raw) : {}
    map[channelId] = 1
    localStorage.setItem(WELCOME_KEY, JSON.stringify(map))
  } catch {}
}

// Build the onlineUsers array for the sidebar/strip, marking the current user.
// Users come from presenceSnapshot (keyed by sessionId).
function buildOnlineUsers(users, mySessionId) {
  return users.map(u => ({
    id: u.sessionId,
    sessionId: u.sessionId,
    nickname: u.nickname,
    userId: u.userId ?? null,
    isRegistered: !!u.userId,
    isMe: u.sessionId === mySessionId,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const installPrompt = useBeforeInstallPrompt()
  const [status, setStatus] = useState('onboarding') // onboarding | joining | ready | error
  const [error, setError] = useState(null)
  const [city, setCity] = useState(null)
  const [channelId, setChannelId] = useState(null)
  const [guest, setGuest] = useState(null)
  const [nickname, setNickname] = useState(() => loadIdentity()?.nickname ?? generateNickname())
  const [feed, setFeed] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [onlineCount, setOnlineCount] = useState(null)
  const weatherLabel = useMemo(() => {
    const w = feed.find(item => item.type === 'activity' && item.subtype === 'weather')
    return w?.text ?? null
  }, [feed])
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
  const [crewMembers,  setCrewMembers]  = useState([])
  const [crewPage,     setCrewPage]     = useState(1)
  const [crewHasMore,  setCrewHasMore]  = useState(false)
  const [crewLoading,  setCrewLoading]  = useState(false)
  const [filterBadge,  setFilterBadge]  = useState(null)
  const [filterVibe,   setFilterVibe]   = useState(null)
  const [viewingProfile, setViewingProfile] = useState(null) // { userId, nickname } for public profile
  const [guestProfile,   setGuestProfile]   = useState(null) // { guestId, nickname } for guest-only profiles
  const [showConversations, setShowConversations] = useState(false)
  const [activeDm, setActiveDm] = useState(null) // { conversation, otherUser }
  const [conversations, setConversations] = useState(null) // { dms, events }
  const [showProfileDrawer, setShowProfileDrawer] = useState(false)
  const [showAuthScreen, setShowAuthScreen] = useState(false)
  const [account, setAccount] = useState(null)        // null = guest, object = registered
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifUnreadCount, setNotifUnreadCount] = useState(0)

  // Single source of truth for the current user's display name.
  // Registered users always use backend display_name; guests use localStorage nickname.
  const activeNickname = account?.display_name ?? nickname

  const hasAnyUnread = (conversations?.dms?.some(dm => dm.has_unread) || conversations?.events?.some(ev => ev.has_unread)) ?? false

  const [profileNickInput, setProfileNickInput] = useState('')
  const [showCreateEvent, setShowCreateEvent] = useState(false)
  const [createFromDrawer, setCreateFromDrawer] = useState(false)
  const [showEditEvent, setShowEditEvent] = useState(false)
  const [showEditPulse, setShowEditPulse] = useState(false)
  const [successToast, setSuccessToast] = useState(null) // { msg: string }
  const [myEvents, setMyEvents] = useState([])
  const [myEventsLoaded, setMyEventsLoaded] = useState(false)
  const [myFriends, setMyFriends] = useState([])
  const [myFriendsLoaded, setMyFriendsLoaded] = useState(false)
  const [cityTimezone, setCityTimezone] = useState('UTC')
  const [eventPresence, setEventPresence] = useState({}) // { [eventId]: count }
  const [eventParticipants, setEventParticipants] = useState({}) // { [eventId]: number }
  const [participatedEvents, setParticipatedEvents] = useState(new Set()) // eventIds user toggled
  const [hotEventsStatus, setHotEventsStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [cityCountry, setCityCountry] = useState(null)
  // 'pending' | 'resolving' | 'denied' | 'error'
  const [geoState, setGeoState] = useState('pending')
  const [obPickingCity, setObPickingCity] = useState(false)
  const [obShowAuth, setObShowAuth] = useState(false)
  const [obChannels, setObChannels] = useState([])
  const [obChannelsLoading, setObChannelsLoading] = useState(false)
  const [obChannelEventCounts, setObChannelEventCounts] = useState({})
  const [citySearchQuery, setCitySearchQuery] = useState('')

  // ── City crew fetch — triggered when people drawer opens or filters change ──
  const crewChannelRef = useRef(null)
  useEffect(() => {
    if (!showPeopleDrawer || !channelId) return
    const cid = channelId
    crewChannelRef.current = cid
    setCrewMembers([])
    setCrewPage(1)
    setCrewHasMore(false)
    setCrewLoading(true)
    fetchCityMembers(cid, { page: 1, badge: filterBadge, vibe: filterVibe })
      .then(data => {
        if (crewChannelRef.current !== cid) return
        setCrewMembers(data.members)
        setCrewHasMore(data.hasMore)
        setCrewPage(1)
      })
      .catch(() => {})
      .finally(() => { if (crewChannelRef.current === cid) setCrewLoading(false) })
  }, [showPeopleDrawer, channelId, filterBadge, filterVibe])

  function loadMoreCrew() {
    if (!channelId || crewLoading || !crewHasMore) return
    const cid  = channelId
    const next = crewPage + 1
    setCrewLoading(true)
    fetchCityMembers(cid, { page: next, badge: filterBadge, vibe: filterVibe })
      .then(data => {
        if (crewChannelRef.current !== cid) return
        setCrewMembers(prev => [...prev, ...data.members])
        setCrewHasMore(data.hasMore)
        setCrewPage(next)
      })
      .catch(() => {})
      .finally(() => { if (crewChannelRef.current === cid) setCrewLoading(false) })
  }

  const bottomRef = useRef(null)
  const pollRef = useRef(null)
  const activityRef = useRef(null)
  const activeRef = useRef(false)
  const knownIdsRef = useRef(new Set())
  const lastJoinAtRef = useRef(0)          // throttle: timestamp of last join shown in feed
  const promptsShownRef = useRef(new Set())// tracks which prompt subtypes have been injected
  const prevEventCountRef = useRef(0)      // detects new events added to the events list
  const locPromiseRef = useRef(null)
  const openScreenOnJoinRef = useRef(null) // set by deep link; opened after handleJoin completes
  const activeChannelRef = useRef(null) // guards against rapid-switch race conditions
  const chatInputRef = useRef(null)
  const sessionIdRef = useRef(PAGE_SESSION_ID)
  const pollFnRef = useRef(null)      // current room's poll function — called immediately on tab focus
  const socketRef = useRef(null)      // WebSocket presence client
  const nicknameRef = useRef(nickname) // tracks current nickname for use in closures
  const accountRef  = useRef(account)  // tracks current account for use in closures
  const heartbeatRef = useRef(null)   // periodic heartbeat interval
  const typingTimeoutRef = useRef(null) // debounce timer for typingStop
  const isTypingRef = useRef(false)     // true while typingStart has been sent
  const fileInputRef = useRef(null)
  const cityCountLoadingRef = useRef(new Set())
  const obCityCountLoadingRef = useRef(new Set())

  // Events refs
  const activeEventIdRef = useRef(null)
  const eventsPolRef = useRef(null)
  const cityEventsPolRef = useRef(null)

  const hasInstallFeedPrompt = feed.some(item => item.type === 'prompt' && item.subtype === 'install')
  const installBannerUsesBottomNav = !showCityPicker && !showEventDrawer && !showPeopleDrawer
  const showInstallOnMainSurface = status === 'ready' && (
    (!showCityPicker && !showEventDrawer && !showPeopleDrawer && !showProfileDrawer && !showConversations && !showNotifications && !showCreateEvent && !showEditEvent)
    || showCityPicker
    || showEventDrawer
    || (showPeopleDrawer && !viewingProfile)
  )
  const showInstallBanner = showInstallOnMainSurface && installPrompt.shouldShowBanner && !hasInstallFeedPrompt
  const compactInstallText = installPrompt.canUseNativePrompt
    ? 'Add Hilads to home screen'
    : installPrompt.instructionText

  async function loadExactCityCounts(targetChannels, setCounts, loadingRef) {
    const queue = targetChannels.filter(ch => {
      if (!ch?.channelId) return false
      if (loadingRef.current.has(ch.channelId)) return false
      loadingRef.current.add(ch.channelId)
      return true
    })

    const concurrency = 3
    const worker = async () => {
      while (queue.length > 0) {
        const ch = queue.shift()
        if (!ch) return
        try {
          const total = await fetchVisibleCityEventCount(ch)
          setCounts(prev => ({ ...prev, [ch.channelId]: total }))
        } catch (err) {
          console.warn('[city-count] failed', { channelId: ch.channelId, error: err?.message ?? String(err) })
        } finally {
          loadingRef.current.delete(ch.channelId)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  }

  function injectFeedInstallMessage() {
    if (
      activeEventIdRef.current ||
      installPrompt.feedPromptSeen ||
      showInstallBanner ||
      !installPrompt.shouldShowBanner
    ) {
      return
    }

    setFeed(prev => {
      if (prev.some(item => item.type === 'prompt' && item.subtype === 'install')) return prev
      installPrompt.markFeedPromptShown()
      promptsShownRef.current.add('install')
      return [
        ...prev,
        {
          type: 'prompt',
          subtype: 'install',
          id: `prompt-install-${Date.now()}`,
          text: '✨ Add Hilads to your home screen\nNever miss what\'s happening in your city',
          cta: installPrompt.canUseNativePrompt ? 'Add' : 'How'
        },
      ]
    })
  }

  // Fetch conversations whenever the account changes so the unread dot is always current.
  useEffect(() => {
    if (!account) { setConversations(null); return }
    fetchConversations().then(setConversations).catch(err => {
      console.warn('[hilads] background conversations sync failed:', err?.message ?? String(err))
    })
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load "My events" whenever the profile drawer opens (guest or registered).
  useEffect(() => {
    if (!showProfileDrawer || !guest?.guestId) return
    setMyEventsLoaded(false)
    fetchMyEvents(guest.guestId)
      .then(data => { setMyEvents(data.events ?? []); setMyEventsLoaded(true) })
      .catch(() => setMyEventsLoaded(true))
  }, [showProfileDrawer]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load my friends whenever the profile drawer opens (registered only).
  useEffect(() => {
    if (!showProfileDrawer || !account?.id) return
    setMyFriendsLoaded(false)
    fetchUserFriends(account.id)
      .then(data => { setMyFriends(data.friends ?? []); setMyFriendsLoaded(true) })
      .catch(() => setMyFriendsLoaded(true))
  }, [showProfileDrawer]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll notification unread count every 30s for registered users.
  useEffect(() => {
    if (!account) { setNotifUnreadCount(0); return }
    let cancelled = false
    const poll = () => fetchUnreadCount().then(d => { if (!cancelled) setNotifUnreadCount(d.count) }).catch(() => {})
    poll()
    const interval = setInterval(poll, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  // Register push when account becomes available (login/register or page reload with session).
  // Also handles silent re-registration when permission was already granted.
  useEffect(() => {
    if (!account) return
    registerPush().catch(() => {})
  }, [account?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle navigate messages from the service worker (push notification click).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handler = (e) => {
      if (e.data?.type !== 'navigate') return
      const url  = e.data.url ?? '/'
      const path = new URL(url, window.location.origin).pathname
      if (path === '/conversations') { setShowConversations(true); return }
      if (path === '/notifications')  { setShowNotifications(true); return }
      const eventMatch = path.match(/^\/event\/([a-f0-9]{16})$/)
      if (eventMatch) {
        const eid = eventMatch[1]
        const ev  = events.find(e => e.id === eid) ?? cityEvents.find(e => e.id === eid)
        if (ev) handleSelectEvent(ev)
        else    setShowEventDrawer(true)
        return
      }
      const userMatch = path.match(/^\/user\/([a-f0-9-]+)$/)
      if (userMatch) {
        setViewingProfile({ userId: userMatch[1], nickname: '' })
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [events, cityEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep accountRef + nicknameRef in sync so closures always see the latest identity.
  // Also re-assert WS presence when login/logout happens mid-session.
  useEffect(() => {
    accountRef.current = account
    // Registered users: override nicknameRef with the backend display_name immediately.
    if (account?.display_name) {
      nicknameRef.current = account.display_name
    }
    if (status === 'ready' && activeChannelRef.current && socketRef.current) {
      socketRef.current.joinRoom(
        activeChannelRef.current,
        sessionIdRef.current,
        nicknameRef.current,
        account?.id ?? null,
      )
    }
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep link resolution on cold load ─────────────────────────────────────
  // Runs once. If the URL is /city/:slug or /event/:id, override geolocation
  // by pointing locPromiseRef at the linked city before handleJoin fires.
  useEffect(() => {
    const link = parseDeepLink()
    if (!link) return

    if (link.type === 'city') {
      locPromiseRef.current = fetchCityBySlug(link.slug).then(data => {
        if (!data) return null
        setCity(data.city)
        setCityCountry(data.country)
        setCityTimezone(data.timezone)
        return { channelId: data.channelId, city: data.city, timezone: data.timezone, country: data.country }
      })
    }

    if (link.type === 'event') {
      locPromiseRef.current = fetchEventById(link.id).then(async data => {
        if (!data) return null
        const { event, cityName, country, timezone } = data
        setCity(cityName)
        setCityCountry(country)
        setCityTimezone(timezone)
        // After join the city, open the event — defer until handleJoin completes
        setTimeout(() => handleSelectEvent(event), 800)
        return { channelId: event.channel_id, city: cityName, timezone, country }
      })
    }

    if (link.type === 'conversations') openScreenOnJoinRef.current = 'conversations'
    if (link.type === 'notifications')  openScreenOnJoinRef.current = 'notifications'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // start geolocation immediately — runs concurrently with auth check
    locPromiseRef.current = locPromiseRef.current ?? startGeolocation()

    // Resolve auth state BEFORE auto-rejoining so handleJoin always has the
    // correct identity. Without this, accountRef.current is null when
    // handleJoin runs and falls back to the guest nickname from localStorage.
    authMe()
      .then(data => {
        if (data) {
          accountRef.current = data.user // sync ref so handleJoin reads it immediately
          setAccount(data.user)
        }
      })
      .catch(() => {/* not logged in or network error — proceed as guest */})
      .finally(() => {
        const saved = loadIdentity()
        if (saved) handleJoin(null, saved)
      })

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
          socketRef.current?.joinRoom(activeChannelRef.current, sessionIdRef.current, nicknameRef.current, accountRef.current?.id ?? null)
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

  useEffect(() => {
    if (!channelId || cityTimezone !== 'UTC') return

    let cancelled = false
    fetchChannels()
      .then(data => {
        if (cancelled) return
        const match = (data.channels ?? []).find(ch => ch.channelId === channelId)
        if (!match?.timezone || match.timezone === 'UTC') return
        setCityTimezone(match.timezone)
        if (city) {
          saveIdentity(activeNickname, channelId, city, match.timezone)
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [channelId, cityTimezone, city, activeNickname])

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

  function injectWelcomeCard(cid, cityName) {
    if (!cityName || hasBeenWelcomed(cid)) return
    markWelcomed(cid)
    setFeed(prev => [...prev, { type: 'welcome', id: `welcome-${cid}`, city: cityName }])
  }

  function scheduleActivity(isFirst = false) {
    // First ambient message: 30s after join. Recurring: every 60–120s.
    // Skipped entirely when the feed already has real user messages (not noisy then).
    const delay = isFirst ? 30000 : 60000 + Math.random() * 60000
    activityRef.current = setTimeout(() => {
      if (!activeRef.current) return
      const activity = randomActivity()
      setFeed((prev) => {
        // Suppress if there are 3+ real messages — city is active enough
        const realMsgs = prev.filter(m => m.type === 'message').length
        if (realMsgs >= 3) return prev
        return [...prev, { type: 'activity', id: `act-${Date.now()}`, subtype: activity.subtype, text: activity.text }]
      })
      scheduleActivity()
    }, delay)
  }

  function schedulePrompts() {
    // Only inject in city chat (not event chat), only once per subtype per session.
    // Each prompt checks activity level before injecting — suppressed when city is busy.

    // explore: 15s, only if feed is still empty
    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('explore')) return
      setFeed(prev => {
        if (prev.filter(m => m.type === 'message').length > 0) return prev
        promptsShownRef.current.add('explore')
        return [...prev, { type: 'prompt', subtype: 'explore', id: `prompt-explore-${Date.now()}`, text: '🔥 See what\'s happening now', cta: 'Explore' }]
      })
    }, 15000)

    // photo: 30s, only if low activity
    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('photo')) return
      setFeed(prev => {
        if (prev.filter(m => m.type === 'message').length >= 3) return prev
        promptsShownRef.current.add('photo')
        return [...prev, { type: 'prompt', subtype: 'photo', id: `prompt-photo-${Date.now()}`, text: '📸 Share what\'s happening', cta: 'Upload' }]
      })
    }, 30000)

    // create-event: 60s, only if low activity
    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('create-event')) return
      setFeed(prev => {
        if (prev.filter(m => m.type === 'message').length >= 3) return prev
        promptsShownRef.current.add('create-event')
        return [...prev, { type: 'prompt', subtype: 'create-event', id: `prompt-create-${Date.now()}`, text: '🎉 Got a plan tonight?', cta: 'Create event' }]
      })
    }, 60000)

    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('install') || installPrompt.feedPromptSeen) return
      injectFeedInstallMessage()
    }, 12000)
  }

  function handlePromptCta(item) {
    setFeed(prev => prev.filter(f => f.id !== item.id))
    if (item.subtype === 'explore') {
      setShowEventDrawer(true)
    } else if (item.subtype === 'photo') {
      fileInputRef.current?.click()
    } else if (item.subtype === 'create-event') {
      setShowCreateEvent(true)
    } else if (item.subtype === 'install') {
      installPrompt.promptInstall().catch(() => {})
    } else if (item.subtype === 'new-event') {
      const event = events.find(e => e.id === item.eventId) ?? cityEvents.find(e => e.id === item.eventId)
      if (event) handleSelectEvent(event)
    }
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
    // Registered users always lead with their backend display_name.
    // This handles the authMe() → handleJoin() race on auto-rejoin.
    const name = accountRef.current?.display_name
      ?? rejoinData?.nickname
      ?? (nickname.trim() || generateNickname())
    setNickname(name)
    nicknameRef.current = name
    setStatus('joining')
    try {
      const location = rejoinData
        ? await hydrateSavedLocation(rejoinData)
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
      setOnlineCount(null) // populated within ~100ms by WS presenceSnapshot
      setStatus('ready')
      saveIdentity(name, location.channelId, location.city ?? rejoinData?.city ?? null, location.timezone ?? null)
      scheduleEphemeral(joinKey)
      injectWelcomeCard(location.channelId, location.city ?? rejoinData?.city ?? null)
      if (openScreenOnJoinRef.current === 'conversations') { setShowConversations(true); openScreenOnJoinRef.current = null }
      if (openScreenOnJoinRef.current === 'notifications') { setShowNotifications(true); openScreenOnJoinRef.current = null }

      activeRef.current = true
      scheduleActivity(true)
      promptsShownRef.current = new Set()
      schedulePrompts()

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
          return [...prev, { id: user.sessionId, sessionId: user.sessionId, nickname: user.nickname, userId: user.userId ?? null, isRegistered: !!user.userId, isMe: false }]
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

      // Socket: push new messages instantly instead of waiting for the 3s poll.
      // The poll remains as a fallback for when WS is disconnected.
      // Sender's own messages are already in knownIds — they're skipped automatically.
      socket.on('newMessage', ({ channelId, message }) => {
        const isCityMsg  = channelId === activeChannelRef.current
        const isEventMsg = channelId === activeEventIdRef.current

        if (!isCityMsg && !isEventMsg) return
        // In event mode: only accept messages for the active event
        if (activeEventIdRef.current && !isEventMsg) return

        const key = isEventMsg ? message.id : messageKey(message)
        if (!key || knownIdsRef.current.has(key)) return
        knownIdsRef.current.add(key)

        if (isEventMsg) {
          setFeed(prev => [...prev, { type: 'message', ...message }])
        } else {
          const item = toFeedItem(message, undefined, lastJoinAtRef)
          if (!item) return // throttled join
          setFeed(prev => [...prev, item])
          if (item.subtype === 'join') scheduleEphemeral(item.id)
        }
      })

      // Socket: handle newEvent for real-time events list refresh
      socket.on('newEvent', ({ cityId }) => {
        if (activeChannelRef.current !== cityId) return
        fetchEvents(cityId).then(data => {
          if (activeChannelRef.current === cityId) {
            setEvents(data.events)
            setHotEventsStatus('ready')
          }
        }).catch(() => {})
      })

      socket.joinRoom(location.channelId, sessionIdRef.current, name, accountRef.current?.id ?? null)

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
          const newItems = newMsgs.map((m) => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doPoll
      clearInterval(pollRef.current)
      pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)

      // ── Events: fetch + poll (30s) ───────────────────────────────────────────
      setHotEventsStatus('loading')
      const doEventsPoll = async (isInitial = false) => {
        if (!activeRef.current) return
        const [hiladsResult, publicResult] = await Promise.allSettled([
          fetchEvents(location.channelId),
          fetchCityEvents(location.channelId),
        ])
        if (activeChannelRef.current !== location.channelId) return

        const hiladsOk = hiladsResult.status === 'fulfilled'
        const publicOk = publicResult.status === 'fulfilled'

        if (hiladsOk) {
          setEvents(hiladsResult.value.events)
        } else if (isInitial) {
          setEvents([])
        }

        if (publicOk) {
          setCityEvents(publicResult.value.events)
        } else if (isInitial) {
          setCityEvents([])
        }

        if (isInitial) {
          setHotEventsStatus(hiladsOk || publicOk ? 'ready' : 'error')
        }
      }
      doEventsPoll(true)
      clearInterval(eventsPolRef.current)
      eventsPolRef.current = setInterval(() => doEventsPoll(false), 30_000)
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
    const localId = `local-img-${Date.now()}`
    try {
      const { url } = await uploadImage(file)
      const msg = activeEventIdRef.current
        ? await sendEventImageMessage(activeEventIdRef.current, guest.guestId, activeNickname, url)
        : await sendImageMessage(channelId, sessionIdRef.current, guest.guestId, activeNickname, url)
      // Reconcile: WS may have already inserted the server message while we were uploading.
      // If so, just add the server ID to knownIds (dedup future echoes) — no feed append needed.
      // If not, append now. localId placeholder was never inserted for images (upload takes time),
      // so there is nothing to replace — just guard against the WS-wins race.
      knownIdsRef.current.add(msg.id)
      setFeed((prev) => {
        if (prev.some(f => f.id === msg.id)) return prev   // WS already inserted it
        return [...prev, { ...msg }]
      })
    } catch (err) {
      console.error('[send-image] failed:', err)
      setSendError("Couldn't send image. Please try again.")
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setUploading(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    stopTyping()

    // Optimistic insert — message appears instantly without waiting for HTTP.
    // Uses a local placeholder ID so the WS echo can be reconciled correctly.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const optimistic = {
      type:      'message',
      id:        localId,
      localId,
      guestId:   guest?.guestId,
      nickname:  activeNickname,
      content:   content.trim(),
      createdAt: Date.now() / 1000,
    }
    setFeed(prev => [...prev, optimistic])
    setInput('')

    setSending(true)
    try {
      let msg
      if (activeEventIdRef.current) {
        msg = await sendEventMessage(activeEventIdRef.current, guest.guestId, activeNickname, content)
      } else {
        msg = await sendMessage(channelId, sessionIdRef.current, guest.guestId, activeNickname, content)
      }

      // Add server ID to knownIds so future WS echoes are skipped.
      knownIdsRef.current.add(msg.id)

      // Reconcile the optimistic placeholder with the confirmed server message.
      // Two cases:
      //   WS arrived first → server message already in feed; just remove the placeholder.
      //   HTTP arrived first → replace placeholder with server-confirmed message.
      setFeed(prev => {
        if (prev.some(f => f.id === msg.id)) {
          // WS beat HTTP — server message is already present; drop the placeholder only.
          return prev.filter(f => f.id !== localId)
        }
        // HTTP beat WS — swap placeholder for server message.
        return prev.map(f => f.id === localId ? { type: 'message', ...msg } : f)
      })

      if (!activeEventIdRef.current && !installPrompt.feedPromptSeen) {
        setTimeout(() => injectFeedInstallMessage(), 300)
      }
    } catch (err) {
      console.error('[send] failed:', err)
      // Remove the optimistic placeholder so the user can retry cleanly.
      setFeed(prev => prev.filter(f => f.id !== localId))
      setSendError("Couldn't send message. Please try again.")
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setSending(false)
    }
  }

  async function openCityPicker() {
    setShowCityPicker(true)
    setCitySearchQuery('')
    setChannelsLoading(true)
    setChannelEventCounts({})
    cityCountLoadingRef.current = new Set()
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
    void loadExactCityCounts(getDefaultCityTargets(loadedChannels), setChannelEventCounts, cityCountLoadingRef)
  }

  async function openObCityPicker() {
    setObPickingCity(true)
    setCitySearchQuery('')
    setObChannelsLoading(true)
    setObChannelEventCounts({})
    obCityCountLoadingRef.current = new Set()
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
    void loadExactCityCounts(getDefaultCityTargets(loadedChannels), setObChannelEventCounts, obCityCountLoadingRef)
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
    saveIdentity(activeNickname, newChannelId, newCityName, newCityTimezone ?? null)
    setCityTimezone(newCityTimezone ?? 'UTC')
    setEvents([])
    setCityEvents([])
    setHotEventsStatus('loading')
    setActiveEventId(null)
    pushUrl(`/city/${cityToSlug(newCityName)}`)
    setPageMeta(`Who's in ${newCityName} right now | Hilads`, `See who's online and what's happening in ${newCityName} right now.`)
    setActiveEvent(null)
    activeEventIdRef.current = null

    try {
      // Emit join event (also handles leaving previous channel) before fetching
      const joinData = await joinChannel(newChannelId, sessionIdRef.current, guest.guestId, activeNickname, channelId)

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
      setOnlineUsers([{ id: 'me', sessionId: sessionIdRef.current, nickname: activeNickname, isMe: true }])
      setOnlineCount(joinData.onlineCount ?? null)
      scheduleEphemeral(joinKey)
      injectWelcomeCard(newChannelId, newCityName)

      activeRef.current = true
      scheduleActivity(true)
      promptsShownRef.current = new Set()
      schedulePrompts()

      // Socket: join new room — existing handlers (set up in handleJoin) remain active
      socketRef.current?.joinRoom(newChannelId, sessionIdRef.current, activeNickname, accountRef.current?.id ?? null)

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
          const newItems = newMsgs.map((m) => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doPoll
      pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)

      // Events: fetch + poll for new city
      const doEventsPoll = async (isInitial = false) => {
        if (!activeRef.current) return
        const [hiladsResult, publicResult] = await Promise.allSettled([
          fetchEvents(newChannelId),
          fetchCityEvents(newChannelId),
        ])
        if (activeChannelRef.current !== newChannelId) return

        const hiladsOk = hiladsResult.status === 'fulfilled'
        const publicOk = publicResult.status === 'fulfilled'

        if (hiladsOk) {
          setEvents(hiladsResult.value.events)
        } else if (isInitial) {
          setEvents([])
        }

        if (publicOk) {
          setCityEvents(publicResult.value.events)
        } else if (isInitial) {
          setCityEvents([])
        }

        if (isInitial) {
          setHotEventsStatus(hiladsOk || publicOk ? 'ready' : 'error')
        }
      }
      doEventsPoll(true)
      eventsPolRef.current = setInterval(() => doEventsPoll(false), 30_000)
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

    // Inject owner prompt + trigger edit-button pulse when entering your own event
    const ownsThisEvent = account
      ? event.created_by === account.id || event.guest_id === guest?.guestId
      : event.guest_id === guest?.guestId
    if (ownsThisEvent) {
      setFeed([{ type: 'owner-prompt', id: '__owner_prompt__' }])
      setShowEditPulse(true)
    } else {
      setFeed([])
      setShowEditPulse(false)
    }
    knownIdsRef.current = new Set()
    pushUrl(`/event/${eid}`)
    setPageMeta(`${event.title} is happening now | Hilads`, `Join ${event.title} on Hilads — see who's there and what's happening.`)

    const doPoll = async () => {
      if (!activeRef.current) return
      const latest = await fetchEventMessages(eid)
      if (activeEventIdRef.current !== eid) return
      const newMsgs = latest.messages.filter(m => !knownIdsRef.current.has(m.id))
      if (newMsgs.length > 0) {
        newMsgs.forEach(m => knownIdsRef.current.add(m.id))
        const items = newMsgs.map(m => toFeedItem(m)).filter(Boolean)
        setFeed(prev => [...prev, ...items])
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

  // Bulk-fetch participant counts for all Hilads events when the Hot drawer opens.
  useEffect(() => {
    if (!showEventDrawer || !sessionIdRef.current) return
    events.forEach(event => {
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
    if (city) {
      pushUrl(`/city/${cityToSlug(city)}`)
      setPageMeta(`Who's in ${city} right now | Hilads`, `See who's online and what's happening in ${city} right now.`)
    }

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
        const items = newMsgs.map(m => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
        setFeed(prev => [...prev, ...items])
        items.forEach(item => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
      }
    }

    pollFnRef.current = doPoll
    pollRef.current = setInterval(() => { if (!document.hidden) doPoll() }, 3000)
  }

  // Refresh event in list after edit
  function handleEventUpdated(updatedEvent) {
    setShowEditEvent(false)
    if (!updatedEvent?.id) return
    setActiveEvent(updatedEvent)
    setEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e))
    setMyEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e))
  }

  // Clean up after event deletion
  function handleEventDeleted(eventId) {
    setShowEditEvent(false)
    setEvents(prev => prev.filter(e => e.id !== eventId))
    setMyEvents(prev => prev.filter(e => e.id !== eventId))
    if (activeEvent?.id === eventId) handleBackToCity()
    setSuccessToast({ msg: 'Event deleted' })
    setTimeout(() => setSuccessToast(null), 3000)
  }

  // Refresh events list after creation
  function handleEventCreated(newEvent) {
    setShowCreateEvent(false)
    setCreateFromDrawer(false)
    // Optimistic update: show the new event immediately using the POST response,
    // so the creator doesn't see a blank gap while the re-fetch is in flight.
    if (newEvent?.id) {
      setEvents(prev => [...prev, newEvent])
      setHotEventsStatus('ready')
      // Creator is auto-joined server-side — reflect that immediately in UI
      setParticipatedEvents(prev => new Set([...prev, newEvent.id]))
      setEventParticipants(prev => ({ ...prev, [newEvent.id]: 1 }))
    }
    // Confirm with server (catches any server-side pruning or ordering)
    const cid = activeChannelRef.current
    if (!cid) return
    fetchEvents(cid).then(data => {
      if (activeChannelRef.current === cid) {
        setEvents(data.events)
        setHotEventsStatus('ready')
      }
    }).catch(() => {})
  }

  const typingLabel = typingText(typingUsers, sessionIdRef.current)

  // Inject a new-event message when events array grows (real-time event added).
  // Only in city chat. Stays in feed permanently like a normal message.
  useEffect(() => {
    if (!activeRef.current || activeEventIdRef.current) {
      prevEventCountRef.current = events.length
      return
    }
    if (events.length > prevEventCountRef.current) {
      const newOnes = events.slice(prevEventCountRef.current)
      newOnes.forEach(event => {
        const id = `event-msg-${event.id}`
        setFeed(prev => {
          if (prev.some(f => f.id === id)) return prev
          return [...prev, { type: 'event', id, eventId: event.id, text: `🔥 New event: ${event.title}`, cta: 'Join' }]
        })
      })
    }
    prevEventCountRef.current = events.length
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── City scoring ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!showCityPicker || channels.length === 0) return
    const targets = citySearchQuery.trim()
      ? getSearchCityTargets(channels, citySearchQuery)
      : getDefaultCityTargets(channels)
    if (targets.length === 0) return
    void loadExactCityCounts(targets, setChannelEventCounts, cityCountLoadingRef)
  }, [showCityPicker, channels, citySearchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!obPickingCity || obChannels.length === 0) return
    const targets = citySearchQuery.trim()
      ? getSearchCityTargets(obChannels, citySearchQuery)
      : getDefaultCityTargets(obChannels)
    if (targets.length === 0) return
    void loadExactCityCounts(targets, setObChannelEventCounts, obCityCountLoadingRef)
  }, [obPickingCity, obChannels, citySearchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  function cityScore(ch, eventCount) {
    return (eventCount * 10) + (ch.activeUsers * 3) + (ch.messageCount * 1)
  }

  // ── Shared city row renderer ────────────────────────────────────────────────

  function renderCityRow(ch, eventCount, onClick, isActive = false, isEventCountResolved = true) {
    const hasActivity = ch.activeUsers > 0
    return (
      <button
        key={ch.channelId}
        className={`city-row${isActive ? ' active' : ''}`}
        onClick={() => onClick(ch)}
      >
        <div className="city-row-top">
          <div className="city-row-left">
            <span className={`activity-dot${hasActivity ? ' live' : ''}`} />
            <span className="city-row-flag" aria-hidden="true">{cityFlag(ch.country)}</span>
            <span className="city-row-name">{ch.city}</span>
          </div>
          {isActive && <span className="city-row-current">you're here</span>}
        </div>
        <div className="city-row-stats">
          {ch.activeUsers > 0 && <span className="city-row-users">{ch.activeUsers} online</span>}
          {!isEventCountResolved && <span className="skel skel-stat city-row-stat-skel" aria-hidden="true" />}
          {isEventCountResolved && eventCount > 0 && <span className="city-row-events">{eventCount} {eventCount === 1 ? 'event' : 'events'}</span>}
          {ch.messageCount > 0 && <span className="city-row-count">{ch.messageCount} msgs</span>}
        </div>
      </button>
    )
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  if (status === 'onboarding') {
    if (obShowAuth) {
      return (
        <AuthScreen
          guestId={guest?.guestId}
          guestNickname={nickname}
          onSuccess={(user) => {
            accountRef.current = user // sync ref before handleJoin reads it
            setAccount(user)
            setObShowAuth(false)
            handleJoin(null)
          }}
          onBack={() => setObShowAuth(false)}
        />
      )
    }

    const [c1, c2] = avatarColors(activeNickname || 'A')
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
                {!account && (
                  <div className="ob-identity-cta">
                    <p className="ob-identity-hint">Don't lose your name 👇</p>
                    <button type="button" className="ob-create-account" onClick={() => setObShowAuth(true)}>
                      ✨ Save my identity
                    </button>
                  </div>
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
                {!account && (
                  <div className="ob-identity-cta">
                    <p className="ob-identity-hint">Don't lose your name 👇</p>
                    <button type="button" className="ob-create-account" onClick={() => setObShowAuth(true)}>
                      ✨ Save my identity
                    </button>
                  </div>
                )}
              </>
            )}
            <p className="ob-hint">// anonymous · no sign-up</p>
          </form>
        </div>

        {obPickingCity && (
          <div className="full-page">
            <div className="page-header">
              <BackButton onClick={() => setObPickingCity(false)} />
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
                    (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country),
                    false,
                    Object.hasOwn(obChannelEventCounts, ch.channelId)
                  ))
                }
                const getScore = ch => cityScore(ch, obChannelEventCounts[ch.channelId] ?? 0)
                const active = [...obChannels]
                  .filter(ch => getScore(ch) > 0)
                  .sort((a, b) => getScore(b) - getScore(a) || a.city.localeCompare(b.city))
                const fillerIds = new Set(active.map(ch => ch.channelId))
                const filler = [...obChannels]
                  .filter(ch => !fillerIds.has(ch.channelId))
                  .sort((a, b) => a.channelId - b.channelId)
                const top10 = [...active, ...filler].slice(0, 10)
                const label = active.length > 0 ? 'Top cities right now' : 'Cities'
                return (
                  <>
                    <div className="city-list-label">{label}</div>
                    {top10.map(ch => renderCityRow(
                      ch,
                      obChannelEventCounts[ch.channelId] ?? 0,
                      (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country),
                      false,
                      Object.hasOwn(obChannelEventCounts, ch.channelId)
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
        {(user.nickname ?? '?')[0].toUpperCase()}
      </span>
    )
  }

  function renderCityHero(className = 'header-hero') {
    return (
      <div className={className}>
        <Logo variant="icon" size="lg" />
        <div className="header-hero-city">
          <span className="header-hero-name">
            <span className="header-hero-flag" aria-hidden="true">{cityFlag(cityCountry)}</span>
            <span>{city}</span>
          </span>
          <span className="online-label">
            <span className="online-pulse" />
            {onlineCount != null ? `${onlineCount} hanging out` : 'live now'}
          </span>
          {weatherLabel && (
            <span className="header-weather">{weatherLabel}</span>
          )}
        </div>
      </div>
    )
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  // True when the active event was created by the current user (guest or registered).
  const isMyEvent = activeEvent
    ? (account
        ? activeEvent.created_by === account.id || activeEvent.guest_id === guest?.guestId
        : activeEvent.guest_id === guest?.guestId)
    : false

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
                <BackButton onClick={handleBackToCity} label={city} className="event-back-btn" ariaLabel={`Back to ${city}`} />
                <div className="event-header-actions">
                  <button
                    className="header-icon-btn"
                    onClick={() => share(activeEvent.title, `${window.location.origin}/event/${activeEvent.id}`)}
                    title="Share this vibe"
                    aria-label="Share event"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                  </button>
                  {/* Edit entry point moved to title row for better visibility */}
                  {account && (
                    <button
                      className={`header-icon-btn${notifUnreadCount > 0 ? ' header-icon-btn--unread' : ''}`}
                      onClick={() => setShowNotifications(true)}
                      title="Notifications"
                      aria-label="Notifications"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      {notifUnreadCount > 0 && (
                        <span className="header-icon-badge">
                          {notifUnreadCount > 9 ? '9+' : notifUnreadCount}
                        </span>
                      )}
                    </button>
                  )}
                  {account && (
                    <button
                      className={`header-icon-btn${hasAnyUnread ? ' header-icon-btn--unread' : ''}`}
                      onClick={() => setShowConversations(true)}
                      title="Messages"
                      aria-label="Messages"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {hasAnyUnread && <span className="header-icon-badge header-icon-badge--dot" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="event-header-body">
                {isMyEvent && (
                  <span className="event-creator-badge">👑 Your event</span>
                )}
                <div className="event-header-title-row">
                  <span className="event-header-title">{activeEvent.title}</span>
                  {isMyEvent ? (
                    <button
                      className={`event-join-btn event-join-btn--edit${showEditPulse ? ' event-join-btn--pulse' : ''}`}
                      onClick={() => setShowEditEvent(true)}
                      onAnimationEnd={() => setShowEditPulse(false)}
                    >
                      ✏️ Edit event
                    </button>
                  ) : (
                    <button
                      className={`event-join-btn${participatedEvents.has(activeEvent.id) ? ' event-join-btn--active' : ''}`}
                      onClick={() => handleToggleParticipation(activeEvent.id)}
                    >
                      {participatedEvents.has(activeEvent.id) ? 'Going' : 'Join'}
                    </button>
                  )}
                </div>
                <span className="event-meta-label">
                  {getTimeLabel(activeEvent.starts_at, cityTimezone || 'UTC')}
                  {activeEvent.ends_at ? ` → ${formatTime(activeEvent.ends_at, cityTimezone || 'UTC')}` : ''}
                  {` · ${eventPresence[activeEvent.id] ?? 0} here · ${eventParticipants[activeEvent.id] ?? 0} going`}
                </span>
                {(() => {
                  const loc = getEventLocation(activeEvent)
                  const url = getEventMapsUrl(activeEvent)
                  if (url) return (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="event-location">
                      📍 {loc}
                    </a>
                  )
                  return <span className="event-location event-location--muted">📍 {loc ?? 'Location not available yet'}</span>
                })()}
              </div>
            </div>
          ) : (
            /* City mode: centered hero header */
            <>
              <div className="header-desktop-layout">
                <div className="header-desktop-zone header-desktop-zone--left">
                  <div className="header-desktop-left">
                    <button className="change-city-btn" onClick={openCityPicker} title="Switch city">
                      🌍 <span className="city-btn-name">{city || '…'}</span> <span className="city-btn-arrow">⌄</span>
                    </button>
                  </div>
                </div>
                <div className="header-desktop-zone header-desktop-zone--center">
                  {renderCityHero('header-hero header-hero--desktop')}
                </div>
                <div className="header-desktop-zone header-desktop-zone--right">
                  <div className="header-desktop-right">
                    <div className="header-desktop-actions">
                      {account && (
                        <button
                          className={`header-icon-btn${notifUnreadCount > 0 ? ' header-icon-btn--unread' : ''}`}
                          onClick={() => setShowNotifications(true)}
                          title="Notifications"
                          aria-label="Notifications"
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                          </svg>
                          {notifUnreadCount > 0 && (
                            <span className="header-icon-badge">
                              {notifUnreadCount > 9 ? '9+' : notifUnreadCount}
                            </span>
                          )}
                        </button>
                      )}
                      {city && (
                        <button
                          className="header-icon-btn"
                          onClick={() => share(`Who's in ${city} right now | Hilads`, `${window.location.origin}/city/${cityToSlug(city)}`)}
                          title="Share city"
                          aria-label="Share city"
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                          </svg>
                        </button>
                      )}
                      {account && (
                        <button
                          className={`header-icon-btn${hasAnyUnread ? ' header-icon-btn--unread' : ''}`}
                          onClick={() => setShowConversations(true)}
                          title="Messages"
                          aria-label="Messages"
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          {hasAnyUnread && <span className="header-icon-badge header-icon-badge--dot" />}
                        </button>
                      )}
                    </div>
                    <span className="you-badge">👤 {activeNickname}</span>
                  </div>
                </div>
              </div>
              {renderCityHero('header-hero header-hero--mobile')}
            </>
          )}
          {/* City header actions: keep the hero full-width by anchoring controls to the sides */}
          {!activeEvent && account && (
            <div className="header-side-control header-side-control--left">
              <button
                className={`header-icon-btn${notifUnreadCount > 0 ? ' header-icon-btn--unread' : ''}`}
                onClick={() => setShowNotifications(true)}
                title="Notifications"
                aria-label="Notifications"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {notifUnreadCount > 0 && (
                  <span className="header-icon-badge">
                    {notifUnreadCount > 9 ? '9+' : notifUnreadCount}
                  </span>
                )}
              </button>
            </div>
          )}
          {!activeEvent && (
            <div className="header-side-control header-side-control--right">
              {city && (
                <button
                  className="header-icon-btn"
                  onClick={() => share(`Who's in ${city} right now | Hilads`, `${window.location.origin}/city/${cityToSlug(city)}`)}
                  title="Share city"
                  aria-label="Share city"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                </button>
              )}
              {account && (
                <button
                  className={`header-icon-btn${hasAnyUnread ? ' header-icon-btn--unread' : ''}`}
                  onClick={() => setShowConversations(true)}
                  title="Messages"
                  aria-label="Messages"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {hasAnyUnread && <span className="header-icon-badge header-icon-badge--dot" />}
                </button>
              )}
            </div>
          )}
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
              if (item.subtype === 'weather') return null
              const isClickable = item.subtype === 'join' && (item.userId || item.guestId)
              return (
                <div
                  key={item.id}
                  className={item.subtype === 'join'
                    ? `feed-join${fadingIds.has(item.id) ? ' feed-join--exit' : ''}${isClickable ? ' feed-join--clickable' : ''}`
                    : 'feed-activity'}
                  onClick={isClickable ? () => {
                    if (item.userId) {
                      setViewingProfile({ userId: item.userId, nickname: item.nickname ?? '' })
                    } else {
                      setGuestProfile({ guestId: item.guestId, nickname: item.nickname ?? '' })
                    }
                  } : undefined}
                >
                  {item.text}
                  {item.createdAt && <span className="feed-join-time">{formatMsgTime(item.createdAt)}</span>}
                </div>
              )
            }

            if (item.type === 'welcome') {
              return (
                <div key={item.id} className="feed-welcome">
                  <div className="feed-welcome-header">
                    <span className="feed-welcome-city">{item.city} is live ✨</span>
                    <button
                      className="feed-welcome-dismiss"
                      onClick={() => setFeed(prev => prev.filter(f => f.id !== item.id))}
                      aria-label="Dismiss"
                    >×</button>
                  </div>
                  <p className="feed-welcome-body">Real people, right now. Say hi, see who's around, or bring a friend in.</p>
                  <div className="feed-welcome-actions">
                    <button
                      className="feed-welcome-btn feed-welcome-btn--primary"
                      onClick={() => {
                        setFeed(prev => prev.filter(f => f.id !== item.id))
                        chatInputRef.current?.focus()
                      }}
                    >Say hi 👋</button>
                    <button
                      className="feed-welcome-btn feed-welcome-btn--secondary"
                      onClick={() => {
                        setFeed(prev => prev.filter(f => f.id !== item.id))
                        share(`Who's in ${item.city} right now | Hilads`, `${window.location.origin}/city/${cityToSlug(item.city)}`)
                      }}
                    >Invite friends</button>
                  </div>
                </div>
              )
            }

            if (item.type === 'owner-prompt') {
              return (
                <div key={item.id} className="feed-owner-prompt">
                  <div className="feed-owner-prompt-body">
                    <span className="feed-owner-prompt-text">🔥 You started this event!</span>
                    <span className="feed-owner-prompt-sub">Make it even better — add a description, update the time, or share it.</span>
                  </div>
                  <button
                    className="feed-owner-prompt-btn"
                    onClick={() => setShowEditEvent(true)}
                  >
                    ✏️ Edit event
                  </button>
                </div>
              )
            }

            if (item.type === 'event') {
              const ev = events.find(e => e.id === item.eventId) ?? cityEvents.find(e => e.id === item.eventId)
              return (
                <div key={item.id} className="feed-prompt">
                  <span className="feed-prompt-text">{item.text}</span>
                  <button className="feed-prompt-btn" onClick={() => ev && handleSelectEvent(ev)}>{item.cta}</button>
                </div>
              )
            }

            if (item.type === 'prompt') {
              return (
                <div key={item.id} className="feed-prompt">
                  <span className="feed-prompt-text">{item.text}</span>
                  <button className="feed-prompt-btn" onClick={() => handlePromptCta(item)}>{item.cta}</button>
                </div>
              )
            }

            const isMine = item.guestId === guest?.guestId
            const prevItem = feed[i - 1]
            const nextItem = feed[i + 1]
            // group consecutive messages/images from the same sender
            const isGrouped = prevItem?.guestId === item.guestId && prevItem?.type !== 'activity'
            // show time below the last bubble in a sender run
            const showTime = !nextItem || nextItem.guestId !== item.guestId || !['text', 'image'].includes(nextItem.type ?? '')
            // show date separator above first message of a new day
            const dateLabel = !msgIsSameDay(item.createdAt, prevItem?.createdAt) ? formatMsgDateLabel(item.createdAt) : null
            const [c1, c2] = avatarColors(item.nickname)

            return (
              <div key={item.id}>
                {dateLabel && (
                  <div className="date-sep">
                    <span className="date-sep-label">{dateLabel}</span>
                  </div>
                )}
                <div
                  className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : '', 'animate'].filter(Boolean).join(' ')}
                  style={item.staggerDelay ? { animationDelay: item.staggerDelay } : undefined}
                >
                  {!isMine && !isGrouped && (
                    <div
                      className={`msg-meta${item.userId ? ' msg-meta--tappable' : ''}`}
                      onClick={item.userId ? () => setViewingProfile({ userId: item.userId, nickname: item.nickname }) : undefined}
                      title={item.userId ? `View ${item.nickname}'s profile` : undefined}
                    >
                      <span
                        className="msg-avatar"
                        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                      >
                        {(item.nickname ?? '?')[0].toUpperCase()}
                      </span>
                      <span className="msg-author" style={{ color: c1 }}>{item.nickname}</span>
                      {item.primaryBadge && <span className={`badge-pill badge-pill--${item.primaryBadge.key}`}>{item.primaryBadge.label}</span>}
                      {item.contextBadge && <span className={`badge-pill badge-pill--${item.contextBadge.key}`}>{item.contextBadge.label}</span>}
                      {item.vibe && VIBE_META[item.vibe] && (
                        <span className="msg-vibe">{VIBE_META[item.vibe].emoji}</span>
                      )}
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
                  {showTime && item.createdAt && (
                    <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatMsgTime(item.createdAt)}</span>
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

        {showInstallBanner && installBannerUsesBottomNav && (
          <div className="chat-install-slot">
            <InstallPromptBanner
              compact
              canInstall={installPrompt.canUseNativePrompt}
              instructionText={compactInstallText}
              manualHelpVisible={installPrompt.manualHelpVisible}
              onAdd={() => installPrompt.promptInstall().catch(() => {})}
              onDismiss={installPrompt.dismissBanner}
            />
          </div>
        )}

        {sendError && (
          <div className="send-error-toast">{sendError}</div>
        )}

        {successToast && (
          <div className="success-toast">{successToast.msg}</div>
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
            title="Send image"
            disabled={uploading || sending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <span className="upload-spinner" /> : <ImageIcon />}
          </button>
          <input
            ref={chatInputRef}
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
          <SendButton disabled={sending || !input.trim()} />
        </form>

        {/* Bottom navigation — mobile only */}
        <nav className="bottom-nav" aria-label="Primary">
          <button
            type="button"
            className={`bottom-nav-tab${showEventDrawer ? ' active' : ''}`}
            onClick={() => setShowEventDrawer(true)}
            aria-label="Hot events"
          >
            <span className="bottom-nav-icon"><NavIconEvents /></span>
            <span className="bottom-nav-label">Hot</span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${showCityPicker ? ' active' : ''}`}
            onClick={openCityPicker}
            aria-label="Cities"
          >
            <span className="bottom-nav-icon"><NavIconCity /></span>
            <span className="bottom-nav-label">Cities</span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${showPeopleDrawer ? ' active' : ''}`}
            onClick={() => { setShowPeopleDrawer(true); setViewingProfile(null) }}
            aria-label="People here"
          >
            <span className="bottom-nav-icon"><NavIconPeople /></span>
            <span className="bottom-nav-label">Here</span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${showProfileDrawer ? ' active' : ''}`}
            onClick={() => { setProfileNickInput(activeNickname); setShowProfileDrawer(true) }}
            aria-label="Profile"
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
            <BackButton onClick={() => setShowCityPicker(false)} />
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
              const getScore = ch => cityScore(ch, channelEventCounts[ch.channelId] ?? 0)

              if (q) {
                // Search mode — filter all channels, sort active-first then alpha
                const results = [...channels]
                  .filter(ch => ch.city.toLowerCase().includes(q))
                  .sort((a, b) => getScore(b) - getScore(a) || a.city.localeCompare(b.city))
                if (results.length === 0) return <div className="city-no-results">No city found for "{q}"</div>
                return results.map(ch => renderCityRow(
                  ch,
                  channelEventCounts[ch.channelId] ?? 0,
                  (ch) => switchCity(ch.channelId, ch.city, ch.timezone, ch.country),
                  ch.channelId === channelId,
                  Object.hasOwn(channelEventCounts, ch.channelId)
                ))
              }

              // Default mode — active cities by score, then fill to 10 with well-known cities (ID order)
              const active = [...channels]
                .filter(ch => getScore(ch) > 0)
                .sort((a, b) => getScore(b) - getScore(a) || a.city.localeCompare(b.city))
              const fillerIds = new Set(active.map(ch => ch.channelId))
              const filler = [...channels]
                .filter(ch => !fillerIds.has(ch.channelId))
                .sort((a, b) => a.channelId - b.channelId)
              const top10 = [...active, ...filler].slice(0, 10)
              const label = active.length > 0 ? 'Top cities right now' : 'Cities'
              return (
                <>
                  <div className="city-list-label">{label}</div>
                  {top10.map(ch => renderCityRow(
                    ch,
                    channelEventCounts[ch.channelId] ?? 0,
                    (ch) => switchCity(ch.channelId, ch.city, ch.timezone, ch.country),
                    ch.channelId === channelId,
                    Object.hasOwn(channelEventCounts, ch.channelId)
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
            <BackButton onClick={() => setShowEventDrawer(false)} />
            <span className="page-title">Hot</span>
          </div>
          <div className="page-body page-body--has-fab">
            {(() => {
              const openCreate = () => { setShowEventDrawer(false); setShowCreateEvent(true); setCreateFromDrawer(true) }
              const tz = cityTimezone || 'UTC'
              const hiladsEvents = [...events].sort((a, b) => a.starts_at - b.starts_at)
              const publicEvents = [...cityEvents].sort((a, b) => a.starts_at - b.starts_at)
              const totalVisibleEvents = hiladsEvents.length + publicEvents.length
              const renderEventRow = (event, group = 'hilads') => {
                const going = eventParticipants[event.id] ?? 0
                return (
                  <button
                    key={event.id}
                    className={`city-row event-row-card${activeEventId === event.id ? ' active' : ''}${going >= 3 ? ' event-row--buzzing' : ''}`}
                    onClick={() => handleSelectEvent(event)}
                  >
                    <div className="er-header">
                      <span className="er-title">
                        {EVENT_ICONS[event.type] ?? '📌'} {event.title}
                      </span>
                      {group === 'public'
                        ? <span className="er-going er-going--public">Public</span>
                        : going > 0 && <span className="er-going">👥 {going}</span>}
                    </div>
                    <div className="er-badges">
                      <span className="city-row-current">
                        {getTimeLabel(event.starts_at, tz)}
                        {event.ends_at ? ` → ${formatTime(event.ends_at, tz)}` : ''}
                      </span>
                      {event.recurrence_label && (
                        <span className="recur-badge">↻ {event.recurrence_label}</span>
                      )}
                    </div>
                    {getEventLocation(event) && (
                      <span className="er-location">📍 {getEventLocation(event)}</span>
                    )}
                  </button>
                )
              }
              const renderSkeletonRow = (_, idx) => (
                <div key={`event-skel-${idx}`} className="city-row event-row-card event-row-skeleton" aria-hidden="true">
                  <div className="er-header">
                    <span className="skel skel-er-title" />
                    <span className="skel skel-er-going" />
                  </div>
                  <div className="er-badges">
                    <span className="skel skel-er-badge" />
                    <span className="skel skel-er-badge skel-er-badge--short" />
                  </div>
                  <span className="skel skel-er-location" />
                </div>
              )

              if (hotEventsStatus === 'loading') {
                return (
                  <>
                    <p className="events-group-label" style={{ padding: '10px 12px 2px' }}>Hilads Events</p>
                    {[...Array(3)].map(renderSkeletonRow)}
                    <p className="events-group-label events-group-label--city" style={{ padding: '18px 12px 2px' }}>Public Events</p>
                    {[...Array(2)].map((_, idx) => renderSkeletonRow(_, idx + 3))}
                  </>
                )
              }

              if (hotEventsStatus === 'error') {
                return (
                  <div className="events-empty-state">
                    <p className="events-empty-title">Couldn&apos;t load events</p>
                    <p className="events-empty-sub">Pull to retry later or create something new in {city}.</p>
                    <button className="events-empty-cta" onClick={openCreate}>Create event</button>
                  </div>
                )
              }

              if (totalVisibleEvents === 0) {
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
                  <p className="events-group-label" style={{ padding: '10px 12px 2px' }}>Hilads Events</p>
                  {hiladsEvents.length === 0
                    ? <p className="events-empty">No Hilads events yet</p>
                    : hiladsEvents.map(event => renderEventRow(event, 'hilads'))}
                  {publicEvents.length > 0 && (
                    <>
                      <p className="events-group-label events-group-label--city" style={{ padding: '18px 12px 2px' }}>Public Events</p>
                      {publicEvents.map(event => renderEventRow(event, 'public'))}
                    </>
                  )}
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

      {showPeopleDrawer && !viewingProfile && (() => {
        // ── helpers scoped to this render ──────────────────────────────────────
        const BADGE_FILTER_OPTIONS = [
          { key: 'fresh',   label: '✨ Fresh'   },
          { key: 'regular', label: 'Regular'    },
          { key: 'host',    label: '⭐ Host'    },
          { key: 'local',   label: '🌍 Local'   },
        ]
        const VIBE_FILTER_OPTIONS = Object.entries(VIBE_META).map(([k, v]) => ({ key: k, label: `${v.emoji} ${v.label}` }))

        // Apply badge + vibe filters to the live list (small → client-side)
        const filteredOnline = onlineUsers.filter(u => {
          if (filterBadge && !u.isMe) {
            const bk = u.primaryBadge?.key
            if (filterBadge === 'host')    return u.contextBadge?.key === 'host'
            if (filterBadge === 'local')   return u.contextBadge?.key === 'local'
            if (bk !== filterBadge) return false
          }
          if (filterVibe && !u.isMe && u.vibe !== filterVibe) return false
          return true
        })

        const renderOnlineUser = (user) => {
          const [c1, c2] = avatarColors(user.nickname)
          const tappable = !user.isMe && user.isRegistered
          const handleTap = () => {
            if (user.isMe) return
            if (!account) { setShowPeopleDrawer(false); setShowProfileDrawer(true); setShowAuthScreen(true); return }
            if (user.isRegistered) setViewingProfile({ userId: user.userId, nickname: user.nickname })
          }
          return (
            <div
              key={user.id}
              className={`people-drawer-row${tappable ? ' people-drawer-row--tappable' : ''}`}
              onClick={(!user.isMe && (tappable || !account)) ? handleTap : undefined}
            >
              <span className="online-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} data-me={user.isMe ? 'true' : undefined}>
                {(user.nickname ?? '?')[0].toUpperCase()}
              </span>
              <div className="people-drawer-content">
                <span className="people-drawer-name">
                  {user.nickname}{user.isMe && <span className="people-drawer-you"> (you)</span>}
                </span>
                <div className="people-drawer-meta">
                  {user.isMe
                    ? <span className="people-member-badge people-member-badge--you">live now</span>
                    : user.primaryBadge
                      ? <span className={`badge-pill badge-pill--${user.primaryBadge.key}`}>{user.primaryBadge.label}</span>
                      : user.isRegistered
                        ? <span className="badge-pill badge-pill--regular">Regular</span>
                        : <span className="badge-pill badge-pill--ghost">👻 Ghost</span>
                  }
                  {!user.isMe && user.vibe && VIBE_META[user.vibe] && (
                    <span className="vibe-badge">{VIBE_META[user.vibe].emoji} {VIBE_META[user.vibe].label}</span>
                  )}
                </div>
              </div>
              {!user.isMe && user.isRegistered && (
                <button className="people-dm-btn" aria-label={`Message ${user.nickname}`}
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!account) { setShowPeopleDrawer(false); setShowProfileDrawer(true); setShowAuthScreen(true); return }
                    try {
                      const { conversation, otherUser } = await createOrGetDirectConversation(user.userId)
                      setShowPeopleDrawer(false); setShowConversations(true); setActiveDm({ conversation, otherUser })
                    } catch { /* silent */ }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              )}
            </div>
          )
        }

        const renderCrewMember = (m) => {
          const [c1, c2] = avatarColors(m.display_name)
          return (
            <div key={m.id} className="people-drawer-row people-drawer-row--tappable"
              onClick={() => {
                if (!account) { setShowPeopleDrawer(false); setShowProfileDrawer(true); setShowAuthScreen(true); return }
                setViewingProfile({ userId: m.id, nickname: m.display_name })
              }}
            >
              {m.profile_photo_url
                ? <img className="online-avatar" src={m.profile_photo_url} alt={m.display_name} style={{ objectFit: 'cover' }} />
                : <span className="online-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(m.display_name ?? '?')[0].toUpperCase()}
                  </span>
              }
              <div className="people-drawer-content">
                <span className="people-drawer-name">{m.display_name}</span>
                <div className="people-drawer-meta">
                  {m.primaryBadge && <span className={`badge-pill badge-pill--${m.primaryBadge.key}`}>{m.primaryBadge.label}</span>}
                  {m.contextBadge && <span className={`badge-pill badge-pill--${m.contextBadge.key}`}>{m.contextBadge.label}</span>}
                  {m.vibe && VIBE_META[m.vibe] && <span className="vibe-badge">{VIBE_META[m.vibe].emoji} {VIBE_META[m.vibe].label}</span>}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div className="full-page">
            <div className="page-header">
              <BackButton onClick={() => { setShowPeopleDrawer(false); setViewingProfile(null) }} />
              <span className="page-title">People here</span>
            </div>

            {/* ── Filters ── */}
            <div className="here-filters">
              <div className="here-filter-row">
                <span className="here-filter-label">Badge</span>
                <div className="here-filter-chips">
                  {BADGE_FILTER_OPTIONS.map(opt => (
                    <button key={opt.key}
                      className={`here-chip${filterBadge === opt.key ? ' here-chip--on' : ''}`}
                      onClick={() => setFilterBadge(v => v === opt.key ? null : opt.key)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="here-filter-row">
                <span className="here-filter-label">Vibe</span>
                <div className="here-filter-chips">
                  {VIBE_FILTER_OPTIONS.map(opt => (
                    <button key={opt.key}
                      className={`here-chip${filterVibe === opt.key ? ' here-chip--on' : ''}`}
                      onClick={() => setFilterVibe(v => v === opt.key ? null : opt.key)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="page-body people-page-body">

              {/* ── Section 1: Here now ── */}
              <div className="here-section-header">
                <span className="here-section-dot here-section-dot--live" />
                Here now · {filteredOnline.length}
              </div>
              {filteredOnline.length === 0
                ? <p className="here-section-empty">Nobody matches these filters right now.</p>
                : filteredOnline.map(renderOnlineUser)
              }

              {/* ── Section 2: City crew ── */}
              <div className="here-section-header" style={{ marginTop: 20 }}>
                🏙️ City crew
              </div>
              {crewLoading && crewMembers.length === 0
                ? <p className="here-section-empty">Loading…</p>
                : crewMembers.length === 0
                  ? <p className="here-section-empty">No members match these filters.</p>
                  : crewMembers.map(renderCrewMember)
              }
              {crewHasMore && (
                <button className="here-load-more" onClick={loadMoreCrew} disabled={crewLoading}>
                  {crewLoading ? 'Loading…' : 'Load more'}
                </button>
              )}

            </div>
          </div>
        )
      })()}

      {showInstallBanner && !installBannerUsesBottomNav && (
        <InstallPromptBanner
          canInstall={installPrompt.canUseNativePrompt}
          instructionText={installPrompt.instructionText}
          manualHelpVisible={installPrompt.manualHelpVisible}
          onAdd={() => installPrompt.promptInstall().catch(() => {})}
          onDismiss={installPrompt.dismissBanner}
        />
      )}

      {viewingProfile && (
        <PublicProfileScreen
          userId={viewingProfile.userId}
          cityName={city}
          cityCountry={cityCountry}
          account={account}
          onBack={() => setViewingProfile(null)}
          onViewProfile={(uid, nickname) => setViewingProfile({ userId: uid, nickname })}
          onSendDm={account ? async (targetUserId) => {
            try {
              const { conversation, otherUser } = await createOrGetDirectConversation(targetUserId)
              setViewingProfile(null)
              setShowPeopleDrawer(false)
              setShowConversations(true)
              setActiveDm({ conversation, otherUser })
            } catch { /* silent */ }
          } : null}
        />
      )}

      {guestProfile && (
        <GuestProfileCard
          guestId={guestProfile.guestId}
          nickname={guestProfile.nickname}
          cityName={city}
          onBack={() => setGuestProfile(null)}
        />
      )}

      {showConversations && !activeDm && (
        <ConversationsScreen
          account={account}
          conversations={conversations}
          onConversationsLoaded={setConversations}
          onBack={() => setShowConversations(false)}
          onOpenDm={(dm) => {
            // Optimistically clear unread before navigating
            setConversations(prev => prev ? {
              ...prev,
              dms: prev.dms.map(d => d.id === dm.id ? { ...d, has_unread: false } : d),
            } : prev)
            setActiveDm({ conversation: dm, otherUser: { display_name: dm.other_display_name, profile_photo_url: dm.other_photo_url } })
          }}
          onOpenEvent={(ev) => {
            setShowConversations(false)
            // Optimistically clear unread before navigating
            setConversations(prev => prev ? {
              ...prev,
              events: prev.events.map(e => e.channel_id === ev.channel_id ? { ...e, has_unread: false } : e),
            } : prev)
            markEventRead(ev.channel_id) // fire-and-forget
            // ev.channel_id is the event channel id — same as event.id in handleSelectEvent
            handleSelectEvent({ id: ev.channel_id, title: ev.title, starts_at: ev.starts_at, location: ev.location })
          }}
        />
      )}

      {showConversations && activeDm && (
        <DirectMessageScreen
          conversation={activeDm.conversation}
          otherUser={activeDm.otherUser}
          account={account}
          socket={socketRef.current}
          onBack={() => setActiveDm(null)}
        />
      )}

      {showProfileDrawer && !showAuthScreen && account && (
        <ProfileScreen
          account={account}
          myEvents={myEventsLoaded ? myEvents : null}
          myFriends={myFriendsLoaded ? myFriends : null}
          cityTimezone={cityTimezone}
          onSave={setAccount}
          onBack={() => setShowProfileDrawer(false)}
          onViewFriend={(uid, nickname) => {
            setShowProfileDrawer(false)
            setViewingProfile({ userId: uid, nickname })
          }}
          onSelectEvent={(ev) => { setShowProfileDrawer(false); handleSelectEvent(ev) }}
          onDeleteEvent={async (ev) => {
            try {
              await deleteEvent(ev.id, guest?.guestId ?? '')
              setMyEvents(prev => prev.filter(e => e.id !== ev.id))
              setEvents(prev => prev.filter(e => e.id !== ev.id))
              if (activeEvent?.id === ev.id) handleBackToCity()
            } catch (_) {}
          }}
          onSignOut={async () => {
            await authLogout()
            unregisterPush().catch(() => {})
            setAccount(null)
            clearIdentity()       // prevent auto-rejoin on next boot
            setStatus('onboarding')
            setShowProfileDrawer(false)
          }}
        />
      )}

      {showProfileDrawer && !showAuthScreen && !account && (
        <div className="full-page">
          <div className="page-header">
            <BackButton onClick={() => setShowProfileDrawer(false)} />
            <span className="page-title">Me</span>
          </div>
          <div className="page-body me-page-body">
            <>
              {(() => {
                const [c1, c2] = avatarColors(profileNickInput || nickname)
                return (
                  <div className="me-card me-card--hero">
                    <div className="profile-avatar-row">
                      <span className="online-avatar profile-avatar-lg" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                        {(profileNickInput || nickname)[0]?.toUpperCase() ?? '?'}
                      </span>
                      <div className="me-hero-copy">
                        <h2 className="me-hero-name">{profileNickInput || nickname || 'Guest'}</h2>
                        <p className="me-hero-sub">Anonymous for now. You can still shape how you appear.</p>
                      </div>
                    </div>
                  </div>
                )
              })()}
              <div className="me-card">
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
                      saveIdentity(trimmed, channelId, city, cityTimezone ?? null)
                    }
                    setShowProfileDrawer(false)
                  }}
                  disabled={!profileNickInput.trim()}
                >Save nickname</button>
              </div>
              <div className="me-card">
                <div className="me-upgrade">
                  <p className="me-upgrade-hint">Save your profile and keep your identity</p>
                  <button className="me-upgrade-btn" onClick={() => setShowAuthScreen(true)}>
                    Create account
                  </button>
                </div>
              </div>
              {myEventsLoaded && myEvents.length > 0 && (
                <div className="me-card">
                  <p className="me-section-label">My events</p>
                  {myEvents.map(ev => (
                    <MyEventRow
                      key={ev.id}
                      event={ev}
                      cityTimezone={cityTimezone}
                      onSelect={() => { setShowProfileDrawer(false); handleSelectEvent(ev) }}
                      onDelete={async () => {
                        try {
                          await deleteEvent(ev.id, guest.guestId)
                          setMyEvents(prev => prev.filter(e => e.id !== ev.id))
                          setEvents(prev => prev.filter(e => e.id !== ev.id))
                          if (activeEvent?.id === ev.id) handleBackToCity()
                        } catch (_) {}
                      }}
                    />
                  ))}
                </div>
              )}
                <p className="profile-hint">// anonymous · no sign-up required</p>
            </>
          </div>
        </div>
      )}

      {showProfileDrawer && showAuthScreen && (
        <AuthScreen
          guestId={guest?.guestId}
          guestNickname={nickname}
          onSuccess={(user) => {
            setAccount(user)
            setShowAuthScreen(false)
            setShowProfileDrawer(false)
          }}
          onBack={() => setShowAuthScreen(false)}
        />
      )}

      {/* Notifications — full-screen page */}
      {showNotifications && (
        <NotificationsScreen
          onBack={() => setShowNotifications(false)}
          onUnreadChange={setNotifUnreadCount}
          onNavigate={(notif) => {
            setShowNotifications(false)
            const d = notif.data ?? {}
            if (notif.type === 'dm_message') {
              setShowConversations(true)
            } else if (notif.type === 'event_message' || notif.type === 'event_join') {
              const ev = events.find(e => e.id === d.eventId) ?? cityEvents.find(e => e.id === d.eventId)
              if (ev) handleSelectEvent(ev)
              else setShowEventDrawer(true)
            } else if (notif.type === 'new_event') {
              const ev = events.find(e => e.id === d.eventId) ?? cityEvents.find(e => e.id === d.eventId)
              if (ev) handleSelectEvent(ev)
              else setShowEventDrawer(true)
            } else if (notif.type === 'friend_added' && d.senderUserId) {
              setViewingProfile({ userId: d.senderUserId, nickname: d.senderName ?? '' })
            }
          }}
        />
      )}

      {/* Edit event — full-screen page (reuses CreateEventPage in edit mode) */}
      {showEditEvent && activeEvent && (
        <CreateEventPage
          editEvent={activeEvent}
          channelId={channelId}
          guest={guest}
          nickname={activeNickname}
          cityTimezone={cityTimezone}
          account={account}
          onCreated={handleEventUpdated}
          onDeleted={handleEventDeleted}
          onBack={() => setShowEditEvent(false)}
        />
      )}

      {/* Create event — full-screen page */}
      {showCreateEvent && (
        <CreateEventPage
          channelId={channelId}
          guest={guest}
          nickname={activeNickname}
          cityTimezone={cityTimezone}
          account={account}
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
                  {(user.nickname ?? '?')[0].toUpperCase()}
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
