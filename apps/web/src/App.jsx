import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED, DEFAULT_LOCALE } from './i18n'
import { localizeCityName } from './i18n/cityName'
import { track, trackDeferred, identifyUser, setAnalyticsContext, resetAnalytics } from './lib/analytics'
import { createGuestSession, resolveLocation, reverseGeocodeCountry, fetchMessages, fetchLeanMessages, sendMessage, fetchChannels, fetchMessageBadges, joinChannel, uploadImage, sendImageMessage, fetchEvents, fetchCityEvents, fetchCityTopics, fetchNowFeed, fetchUpcomingEvents, createTopic, fetchCityMembers, fetchCityAmbassadors, fetchEventMessages, sendEventMessage, sendEventImageMessage, fetchEventParticipants, fetchEventGoingList, toggleEventParticipation, authMe, authLogout, deleteAccount, createOrGetDirectConversation, fetchConversations, fetchConversationsUnread, markEventRead, fetchCityBySlug, fetchEventById, fetchTopicById, fetchChallengeById, createChallenge, fetchCityChallenges, fetchUnreadCount, fetchMyEvents, deleteEvent, fetchUserEvents, fetchUserFriends, authForgotPassword, authValidateResetToken, authResetPassword, toggleChannelReaction, fetchCanCreateEvent, EventLimitReachedError, fetchHangoutParticipants, updateTopic, deleteTopic, setCurrentCity, editChannelMessage, deleteChannelMessage, editDmMessage, deleteDmMessage } from './api'
import EventLimitReachedScreen from './components/EventLimitReachedScreen'
import Lightbox from './components/Lightbox'
import { createSocket } from './socket'
import { cityFlag, EVENT_ICONS } from './cityMeta'
import { badgeLabel } from './badgeMeta'
import { getTimeLabel, getEventLocation, getEventMapsUrl, formatTime, eventSlug } from './eventUtils'
import { haversineMeters, formatDistance } from './distance'
import { formatExpiresIn } from './expiry'
import { localizeWeather } from './weather'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion'
import Logo from './components/Logo'
import LandingPage from './components/LandingPage'
import EventsSidebar from './components/EventsSidebar'
import AttendeeAvatars from './components/AttendeeAvatars'
import useMentions from './hooks/useMentions'
import { splitContentByMentions } from './lib/mentions'
import { linkifyText, extractFirstUrl } from './linkify.jsx'
import LinkPreviewCard from './components/LinkPreviewCard'
import CreateEventPage from './components/CreateEventModal'
import CreateTopicPage from './components/CreateTopicPage'
import TopicChatPage from './components/TopicChatPage'
import ChallengeChatPage from './components/ChallengeChatPage'
import ChallengePostCreateModal from './components/ChallengePostCreateModal'
import ThreadChatPage     from './components/ThreadChatPage'
import ThreadsListPage    from './components/ThreadsListPage'
import CreateChallengePage from './components/CreateChallengePage'
import OnboardingCarousel from './components/OnboardingCarousel'
import ChallengeIntroCarousel from './components/ChallengeIntroCarousel'
import { Marquee } from './components/Marquee'
import AuthScreen from './components/AuthScreen'
import AccountWelcome from './components/AccountWelcome'
import ForgotPasswordScreen from './components/ForgotPasswordScreen'
import ResetPasswordScreen from './components/ResetPasswordScreen'
import ProfileScreen from './components/ProfileScreen'
import PublicProfileScreen from './components/PublicProfileScreen'
import VenueScreen from './components/VenueScreen'
import GuestProfileCard from './components/GuestProfileCard'
import ConversationsScreen from './components/ConversationsScreen'
import UpcomingEventsScreen from './components/UpcomingEventsScreen'
import PastArchiveScreen from './components/PastArchiveScreen'
import DirectMessageScreen from './components/DirectMessageScreen'
import NotificationsScreen from './components/NotificationsScreen'
import FriendRequestsScreen from './components/FriendRequestsScreen'
import { fetchIncomingFriendRequestCount } from './api'
import BackButton from './components/BackButton'
import DeleteAccountPage from './components/DeleteAccountPage'
import InstallPromptBanner from './components/InstallPromptBanner'
import useBeforeInstallPrompt from './hooks/useBeforeInstallPrompt'
import AppPromoBanner from './components/AppPromoBanner'
import AppPromoInterstitial from './components/AppPromoInterstitial'
import MessageComposer from './components/MessageComposer'
import ShareActionSheet from './components/ShareActionSheet'
import LocationPicker from './components/LocationPicker'
import ReactionBurstLayer from './components/ReactionBurstLayer'
import { registerPush, unregisterPush } from './push'

// ── Helpers ───────────────────────────────────────────────────────────────────

function cityToSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Leading locale segment to strip from deep-link paths (Option A): ANY supported
// locale prefix, e.g. /fr, /es, /it, /pt-br, /zh-hans. Built from the canonical
// SUPPORTED list so adding a locale never desyncs the router — the old hardcoded
// (fr|vi|es) silently dropped /it, /de, … to the landing page. Longest-first +
// a segment-boundary lookahead so /zh-hant can't be shadowed by a shorter prefix.
const LOCALE_PREFIX_RE = new RegExp(
  `^/(${[...SUPPORTED].sort((a, b) => b.length - a.length).join('|')})(?=/|$)`
)

function parseDeepLink() {
  // Strip an optional leading locale segment — Option A localized routes resolve
  // to the same views as their un-prefixed English canonical. The locale itself
  // is read separately by src/i18n (resolveInitialLocale).
  const path = window.location.pathname.replace(LOCALE_PREFIX_RE, '') || '/'
  const params = new URLSearchParams(window.location.search)
  const cityMatch         = path.match(/^\/city\/([^/]+)$/)
  const cityPastMatch     = path.match(/^\/city\/([^/]+)\/past$/)
  const cityCategoryMatch = path.match(/^\/city\/([^/]+)\/([a-z]+)$/)
  // /event/:slug accepts both legacy bare 16-hex IDs AND slug-with-trailing-hex
  // formats — e.g. /event/cong-ca-phe-2e617620a3f3b6f7. The trailing 16 hex
  // chars are always extracted as the canonical ID via extractEventHex().
  const eventMatch     = path.match(/^\/event\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i)
  // /challenge/:slug accepts both bare hex AND slug+hex (same shape as events).
  // The SSR prerender renders the full SEO content; the SPA just joins the
  // host city on hydration so the user lands in a usable place.
  const challengeMatch = path.match(/^\/challenge\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i)
  const venueMatch     = path.match(/^\/venue\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i)
  const shortLinkMatch = path.match(/^\/e\/([a-f0-9]{16})$/)
  const topicMatch     = path.match(/^\/t\/([a-f0-9]{16})$/)
  // /city/:slug/:category — SPA treats as a regular city deep-link; the
  // prerender handles the SEO-specific /category route. SPA hydration just
  // shows the city page. (Future: pre-apply category filter from link[2].)
  if (cityPastMatch)       return { type: 'past',          slug: cityPastMatch[1] }
  if (cityCategoryMatch)   return { type: 'city',          slug: cityCategoryMatch[1], category: cityCategoryMatch[2] }
  if (cityMatch)           return { type: 'city',          slug: cityMatch[1] }
  if (eventMatch)          return { type: 'event',         id: eventMatch[1] }
  if (challengeMatch)      return { type: 'challenge',     id: challengeMatch[1] }
  if (venueMatch)          return { type: 'venue',         id: venueMatch[1] }
  if (shortLinkMatch)      return { type: 'event',         id: shortLinkMatch[1] }
  if (topicMatch)          return { type: 'topic',         id: topicMatch[1] }
  if (path === '/conversations') return { type: 'conversations' }
  if (path === '/notifications') return { type: 'notifications' }
  if (path === '/friend-requests') return { type: 'friend-requests' }
  if (path === '/reset-password') return { type: 'reset-password', token: params.get('token') ?? '' }
  if (path === '/forgot-password')   return { type: 'forgot-password' }
  if (path === '/delete-account')    return { type: 'delete-account' }
  return null
}

// Did the visitor land directly on a content deep-link (/city, /event, /venue,
// /topic, …) instead of entering through the landing page? Captured ONCE at page
// load, before any client-side navigation, so it reflects the true ENTRY URL.
// Used to suppress the first-time onboarding carousel for deep-linked visitors —
// only landing-funnel visitors (entered on the root) should see it.
// NB: we key on the entry URL, NOT document.referrer — in this SPA the
// landing→city hop is a client-side transition (referrer never updates), and a
// same-origin referrer (clicking a shared link while another hilads tab is open)
// would wrongly re-show onboarding. Entry URL is the only reliable signal.
const ENTRY_WAS_DEEP_LINK = parseDeepLink() !== null

// Prefix an internal path with the active locale so navigation stays in the
// localized cluster (Option A): from /fr/, an event link → /fr/event/…. The
// default locale (en) stays bare (x-default). parseDeepLink() strips the prefix
// on read, so this only affects what we write to the URL bar.
// Localized recurrence label from the event's structured fields. The backend's
// recurrence_label is English-only; build the display string here (event ns).
// Falls back to the server string for older payloads. Weekday names come from
// i18n (event.weekdays).
function formatRecurrence(ev) {
  const type = ev?.recurrence_type
  if (!type) return ev?.recurrence_label ?? null
  const T = (k, opts) => i18n.t(k, { ns: 'event', ...opts })
  if (type === 'daily') return T('recur.everyday')
  if (type === 'every_n_days') return T('recur.everyNDays', { count: ev.recurrence_interval ?? 1 })
  if (type === 'weekly') {
    const days = [...(ev.recurrence_weekdays ?? [])].sort((a, b) => a - b)
    if (days.length === 0) return T('recur.weekly')
    if (days.length === 7) return T('recur.everyday')
    const names = i18n.t('weekdays', { ns: 'event', returnObjects: true })
    return days.map((d) => (Array.isArray(names) ? names[d] : null) ?? '?').join(' · ')
  }
  return ev?.recurrence_label ?? null
}

function localizePath(path) {
  const lang = i18n.language
  if (!lang || lang === DEFAULT_LOCALE || !SUPPORTED.includes(lang)) return path
  if (!path.startsWith('/')) return path                       // leave hashes / absolute URLs
  if (path === `/${lang}` || path.startsWith(`/${lang}/`)) return path  // already prefixed
  return `/${lang}${path}`
}

function pushUrl(path) {
  const target = localizePath(path)
  if (window.location.pathname !== target) {
    window.history.pushState(null, '', target)
  }
}

// ── Guest gate copy ────────────────────────────────────────────────────────────
// Centralised copy for every member-only action gate.
// All gates share the same UI; only the copy changes.

const GUEST_GATE_COPY = {
  create_event: {
    pageTitle: 'Create event',
    emoji:     '🎉',
    title:     "Ghosts can browse, but can't host.",
    sub:       'Create an account to throw your own event and put your city on the map.',
  },
  view_profile: {
    pageTitle: 'Profile',
    emoji:     '👻',
    title:     "Ghosts can browse, but profiles are for members.",
    sub:       'Create an account to unlock profiles, connect with people, and build your city crew.',
  },
  join_hangout: {
    pageTitle: 'Join a hangout',
    emoji:     '🗣️',
    title:     "Ghosts can browse, but can't join hangouts.",
    sub:       'Sign up to join hangouts, save your name, and get notified when people want to meet.',
  },
  create_hangout: {
    pageTitle: 'Start a hangout',
    emoji:     '🗣️',
    title:     "Ghosts can browse, but can't host.",
    sub:       'Sign up to start a hangout, save your name, and get people to join you.',
  },
  create_challenge: {
    pageTitle: 'Launch a challenge',
    emoji:     '🔥',
    title:     "Ghosts can browse, but can't challenge.",
    sub:       'Sign up to launch a challenge for locals or travelers, and own its validation.',
  },
  accept_challenge: {
    pageTitle: 'Accept a challenge',
    emoji:     '🤝',
    title:     "Ghosts can browse, but can't accept.",
    sub:       "Sign up to take on a challenge, chat with the challenger, and plan when you'll meet IRL.",
  },
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

/**
 * Build the share payload for a city. Centralised so every "Share city" button
 * (header chip, switch-city row, "Invite friends" feed prompt) renders the
 * same chat-thread-friendly copy.
 *
 * `text` is no longer threaded through to navigator.share — see share()
 * below for why. We keep it on the return shape only as a hint to any future
 * caller that wants to add an inline UI (e.g. a custom share modal). It does
 * NOT reach navigator.share.
 */
function composeCityShare(cityName) {
  const url   = `${window.location.origin}/city/${cityToSlug(cityName)}`
  const title = `What's happening in ${cityName} right now`
  return { title, url }
}

/**
 * Share helper.
 *
 * Why we drop `text` here even though the Web Share API spec accepts it:
 *   When `navigator.share({ title, text, url })` is invoked on Chrome
 *   desktop / some Chromium variants, the native share dialog's "Copy"
 *   option flattens the three fields into one string — typically
 *   `${url}\n${text}` or `${url} ${text}`. That landed in users' clipboards
 *   as a broken URL with the description text appended (the bug report).
 *   Per the Web Share API spec the fields are distinct, but in the wild
 *   different OS/browser share sheets concatenate on Copy. The only way to
 *   GUARANTEE a clean URL on clipboard is to give the share dialog only a
 *   URL — no `text` to concatenate. The OG preview (M1+M2+M3) supplies
 *   title/description/image to the recipient's chat client automatically.
 *
 * Defensive belt: we ALSO pre-write the URL to clipboard before invoking
 * navigator.share. If any browser's Copy is still broken, our pre-write
 * already populated the clipboard with the clean URL.
 */
async function share({ title, url }) {
  // Defensive pre-copy: clean URL in clipboard before any system dialog can
  // mangle it on Copy. Best-effort; ignored on non-secure or unsupported.
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(url) } catch (_) {}
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return
    } catch (_) {
      // user cancelled or share threw — pre-copy already covers the user
    }
  }

  // No native share or it failed — clipboard.writeText is our primary path.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch (_) {}
  }

  // Final fallback for very old / non-HTTPS contexts.
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

// ── Share vibe button ─────────────────────────────────────────────────────────

function ShareVibeBtn({ eventId, title, city }) {
  const { t } = useTranslation('event')
  const [copied, setCopied] = useState(false)
  async function handleShare() {
    // Slug URL — readable in chat threads, ranks better in SERPs, 301-resolves
    // for any legacy hex-only consumer. Locale-aware: from /fr|/vi the shared
    // link carries the prefix so the recipient lands on the localized page.
    const slug = eventSlug({ id: eventId, title })
    const url = `${window.location.origin}${localizePath(`/event/${slug}`)}`
    // Title gives the share dialog a label; URL stays clean. We deliberately
    // do not pass descriptive text — the OG preview supplies it.
    const result = await share({ title: city ? `${title} · ${city}` : title, url })
    if (result === 'copied') {
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    }
  }
  return (
    <button
      className={`share-vibe-btn${copied ? ' share-vibe-btn--copied' : ''}`}
      onClick={handleShare}
      title={t('share.vibeTitle')}
      aria-label={t('share.eventAria')}
    >
      {copied ? t('share.linkCopied') : t('share.bringPeople')}
    </button>
  )
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
      {/* Building body */}
      <path d="M6 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
      {/* Ground line */}
      <line x1="4" y1="21" x2="20" y2="21" />
      {/* Door */}
      <path d="M10.5 21v-3a1.5 1.5 0 0 1 3 0v3" />
      {/* Windows — two rows of two */}
      <line x1="9"    y1="8"  x2="10.5" y2="8" />
      <line x1="13.5" y1="8"  x2="15"   y2="8" />
      <line x1="9"    y1="12" x2="10.5" y2="12" />
      <line x1="13.5" y1="12" x2="15"   y2="12" />
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
  const { t } = useTranslation('city')
  const now = Date.now() / 1000
  const isLive = event.starts_at <= now && event.expires_at > now
  const recur = formatRecurrence(event)
  return (
    <div className="my-event-row">
      <button className="my-event-row-body" onClick={onSelect}>
        <span className="my-event-title">{EVENT_ICONS[event.type] ?? '📌'} {event.title}</span>
        <span className="my-event-meta">
          {recur
            ? recur
            : getTimeLabel(event.starts_at, cityTimezone || 'UTC') + (event.ends_at ? ` → ${formatTime(event.ends_at, cityTimezone || 'UTC')}` : '')}
        </span>
        <span className={`my-event-badge${isLive ? ' my-event-badge--live' : (recur ? ' my-event-badge--recurring' : '')}`}>
          {isLive ? t('myEvent.live') : (recur ? t('myEvent.recurring') : t('myEvent.upcoming'))}
        </span>
      </button>
      <button className="my-event-delete" onClick={onDelete} aria-label={t('myEvent.delete')}>✕</button>
    </div>
  )
}

const PLACEHOLDERS = [
  () => `Say hi 👋`,
  () => `Who's out tonight?`,
  () => `Any plans? 👀`,
  () => `What's happening here?`,
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
  () => `🎉 People are here right now`,
  () => `🌆 Locals checking in`,
]

function randomActivity() {
  const variant = Math.floor(Math.random() * AMBIENT_MESSAGES.length)
  return { subtype: 'crowd', variant, text: AMBIENT_MESSAGES[variant]() }
}

function typingText(users, mySessionId, t) {
  const others = users.filter(u => u.sessionId !== mySessionId)
  if (others.length === 0) return null
  if (others.length === 1) return t('typing.one', { name: others[0].nickname })
  if (others.length === 2) return t('typing.two', { a: others[0].nickname, b: others[1].nickname })
  return t('typing.many')
}

// ── Vibe display ──────────────────────────────────────────────────────────────

// Emoji + English fallback per vibe. The DISPLAY label is resolved at render
// time by vibeLabel() from common.vibe.* (translated per locale, mirrors the
// mobile app + profile.json). The English strings here are only the fallback.
const VIBE_META = {
  party:       { emoji: '🔥', label: 'Party' },
  board_games: { emoji: '🎲', label: 'Board Games' },
  coffee:      { emoji: '☕', label: 'Coffee' },
  music:       { emoji: '🎧', label: 'Music' },
  food:        { emoji: '🍜', label: 'Food' },
  chill:       { emoji: '🧘', label: 'Chill' },
}

// Localized vibe label. Uses the i18n singleton (not a hook) so it works from
// the .map() filter builders too; components rendering it already re-render on
// language change via their own useTranslation, so the label stays in sync.
function vibeLabel(vibe) {
  return i18n.t(`vibe.${vibe}`, { ns: 'common', defaultValue: VIBE_META[vibe]?.label || vibe })
}

const MODE_META = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
}

function messageKey(m) {
  if (!m) return null
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
  const d   = new Date(ms)
  const now = new Date()
  const time      = d.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return time
  if (msgDay.getTime() === yesterday.getTime()) return `${i18n.t('time.yesterday', { ns: 'common' })} · ${time}`
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return `${d.toLocaleDateString(i18n.language, opts)} · ${time}`
}

function formatMsgDateLabel(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date()
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return i18n.t('time.today', { ns: 'common' })
  if (msgDay.getTime() === yesterday.getTime()) return i18n.t('time.yesterday', { ns: 'common' })
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(i18n.language, opts)
}

const JOIN_TEMPLATES = [
  (n) => `👋 ${n} just landed`,
  (n) => `🔥 ${n} joined them`,
  (n) => `🍻 ${n} is here`,
  (n) => `👀 ${n} just showed up`,
  (n) => `✨ ${n} arrived`,
]

// Strip duplicate weather items from a feed array built from history, keeping only the most recent.
// Also drops nulls — toFeedItem returns null for suppressed items (own-arrival join, throttled joins),
// and a null in the feed would crash the render (item.type) and this dedupe pass.
function dedupeWeather(items) {
  items = items.filter(Boolean)
  const lastWeatherIdx = items.reduce((last, item, i) =>
    (item.type === 'activity' && item.subtype === 'weather') ? i : last, -1)
  return lastWeatherIdx === -1
    ? items
    : items.filter((item, i) => !(item.type === 'activity' && item.subtype === 'weather') || i === lastWeatherIdx)
}

// Current user's identity, kept current by the component (see SELF_IDENTITY writes).
// Module-level because toFeedItem is module-level and runs from many call sites;
// there is exactly one active user per page session.
const SELF_IDENTITY = { guestId: null, userId: null }

// lastJoinAtRef: pass the component ref so join messages are throttled to 1 per 8s.
// Returns null for suppressed joins — callers must filter nulls.
function toFeedItem(m, staggerDelay, lastJoinAtRef = null) {
  if (m.type === 'system' && m.event === 'join') {
    // Never show a user their OWN arrival line (the join is a channel message
    // everyone polls; others still see it).
    if ((m.guestId && m.guestId === SELF_IDENTITY.guestId) ||
        (m.userId  && m.userId  === SELF_IDENTITY.userId)) return null
    if (lastJoinAtRef) {
      const now = Date.now()
      if (now - lastJoinAtRef.current < 8000) return null // throttle rapid joins
      lastJoinAtRef.current = now
    }
    const joinVariant = Math.floor(Math.random() * JOIN_TEMPLATES.length)
    return { type: 'activity', subtype: 'join', id: messageKey(m), joinVariant, text: JOIN_TEMPLATES[joinVariant](m.nickname), createdAt: m.createdAt, nickname: m.nickname, userId: m.userId ?? null, guestId: m.guestId ?? null }
  }
  // Weather system messages have no nickname/id — render as a subtle activity line.
  if (m.type === 'system' && m.event === 'weather') {
    return { type: 'activity', subtype: 'weather', id: `weather_${m.createdAt}`, text: m.content, createdAt: m.createdAt }
  }
  // Guard: any other system message that slips through has no nickname — skip it rather than crash.
  if (m.type === 'system') {
    console.warn('[feed] unhandled system message — skipping:', m)
    return null
  }
  return { type: 'message', staggerDelay, ...m }
}

// Lowercase snake-case Hilads-flavored handles. ~30 × 30 × 10000 = 9M combos
// vs the old 144 — collisions become statistically negligible at any scale
// the app is likely to hit, and the words read as "drift / city / time-of-day"
// rather than generic animals. Produces e.g. `wandering_owl_4231`,
// `dusk_traveler_8273`, `electric_neighbor_0192`.
const NB_ADJECTIVES = [
  'wandering', 'curious', 'golden', 'rusty', 'midnight', 'dawn',
  'dusk', 'lively', 'drifting', 'restless', 'easy', 'sunny',
  'foggy', 'neon', 'electric', 'breezy', 'lazy', 'quiet',
  'bold', 'free', 'urban', 'late', 'slow', 'swift',
  'calm', 'wild', 'hidden', 'friendly', 'casual', 'warm',
]
const NB_NOUNS = [
  'traveler', 'explorer', 'wanderer', 'drifter', 'owl', 'fox',
  'cat', 'ghost', 'spirit', 'ember', 'spark', 'breeze',
  'echo', 'light', 'shadow', 'flame', 'voyager', 'scout',
  'dreamer', 'pioneer', 'neighbor', 'local', 'visitor', 'observer',
  'regular', 'stranger', 'guest', 'listener', 'friend', 'nomad',
]

function generateNickname() {
  const adj = NB_ADJECTIVES[Math.floor(Math.random() * NB_ADJECTIVES.length)]
  const noun = NB_NOUNS[Math.floor(Math.random() * NB_NOUNS.length)]
  const num  = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `${adj}_${noun}_${num}`
}


// Unique per page load — generated fresh so duplicated tabs never share a sessionId.
// Stored as a module-level constant so the same ID is used across re-renders and
// Vite HMR fast-refresh (where the module is preserved, not reloaded).
const PAGE_SESSION_ID = crypto.randomUUID()

const IDENTITY_KEY  = 'hilads_identity'
const GUEST_ID_KEY  = 'hilads_guest_id'
// Presence of this flag means the device has (or had) a registered session.
// Used to skip the authMe() round-trip entirely for pure guests.
const AUTH_FLAG_KEY = 'hilads_has_auth'

function saveGuestId(id) {
  localStorage.setItem(GUEST_ID_KEY, id)
}

function loadGuestId() {
  const id = localStorage.getItem(GUEST_ID_KEY)
  return (id && /^[a-f0-9]{32}$/.test(id)) ? id : null
}

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

// ── Geo city persistence ──────────────────────────────────────────────────────
// The geolocated city is stored separately from the selected city so that
// "Back to my location" survives page refreshes and city switches.
const GEO_CITY_KEY = 'hilads_geo_city'

function saveGeoCity({ channelId, city, country, timezone }) {
  if (!channelId) return
  localStorage.setItem(GEO_CITY_KEY, JSON.stringify({ channelId, city: city ?? null, country: country ?? null, timezone: timezone ?? null }))
}

function loadGeoCity() {
  try {
    const raw = localStorage.getItem(GEO_CITY_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d?.channelId ? d : null
  } catch {
    return null
  }
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

// First-time onboarding carousel — "seen once" flag (guests only).
// localStorage (not a cookie — not sent on every request). On a read error we
// deliberately default to SHOWING it (better one extra view than a crash); an
// in-memory fallback prevents a re-show in the same session if writes also fail.
const ONBOARDING_KEY = 'hilads_onboarding_seen'
let onboardingSeenMem = false
function hasSeenOnboarding() {
  if (onboardingSeenMem) return true
  try { return localStorage.getItem(ONBOARDING_KEY) === '1' }
  catch { return false } // unreadable storage → show once
}
function markOnboardingSeen() {
  onboardingSeenMem = true
  try { localStorage.setItem(ONBOARDING_KEY, '1') } catch {}
}

// Build the onlineUsers array for the sidebar/strip, marking the current user.
// Users come from presenceSnapshot (keyed by sessionId).
function buildOnlineUsers(users, mySessionId) {
  return users.map(u => ({
    id: u.sessionId,
    sessionId: u.sessionId,
    nickname: u.nickname,
    userId: u.userId ?? null,
    guestId: u.guestId ?? null,   // stable id for guest @mentions (live-only)
    isRegistered: !!u.userId,
    isMe: u.sessionId === mySessionId,
    mode: u.mode ?? null,
  }))
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const { t } = useTranslation('city')
  const installPrompt = useBeforeInstallPrompt()
  const [status, setStatus] = useState('onboarding') // onboarding | joining | ready | error
  const [rehydrating, setRehydrating] = useState(() => !!localStorage.getItem(AUTH_FLAG_KEY))
  const [error, setError] = useState(null)
  const [city, setCity] = useState(() => loadIdentity()?.city ?? null)
  const [channelId, setChannelId] = useState(null)
  const [guest, setGuest] = useState(null)
  const [nickname, setNickname] = useState(() => loadIdentity()?.nickname ?? generateNickname())
  const [feed, setFeed] = useState([])
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [input, setInput] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)   // { id, nickname, content, type }
  // Edit mode — { id, content, surface: 'channel'|'dm' } | null. Pre-fills the
  // input; handleSend dispatches to the right edit endpoint instead of sending
  // a new message. Reply and edit are mutually exclusive.
  const [editingMsg, setEditingMsg] = useState(null)
  const [actionBubble, setActionBubble] = useState(null) // { msg, x, y }
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)
  const [mentionNudge, setMentionNudge] = useState(false)  // guest got @mentioned while online
  const msgRefsMap = useRef(new Map())
  const [sendError, setSendError] = useState(null)
  const [reactionBursts, setReactionBursts] = useState([])
  const reactionBurstIdRef = useRef(0)
  const triggerReactionBurstRef = useRef(null)
  const [onlineCount, setOnlineCount] = useState(null)
  const weatherLabel = useMemo(() => {
    // Find the most recent weather item (last in chronological feed). The
    // backend string is English; localizeWeather rebuilds it from the emoji +
    // temperature in the active language (i18n.language in deps recomputes it
    // on a language switch).
    const w = [...feed].reverse().find(item => item.type === 'activity' && item.subtype === 'weather')
    return localizeWeather(w?.text, city)
  }, [feed, city, i18n.language])
  const [showCityPicker, setShowCityPicker] = useState(false)
  const [channels, setChannels] = useState([])          // ranked top-10 (used in default mode)
  const [allChannels, setAllChannels] = useState([])    // all channels unranked (used in search mode)
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [fadingIds, setFadingIds] = useState(new Set())
  // Reminder auto-dismiss: cards fade then leave the feed; the NOW tab pulses
  // (or, under reduce-motion, shows a transient static dot). reduceMotionRef
  // lets the deferred timer read the current setting without re-scheduling.
  const reduceMotion = usePrefersReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const [nowTabPulsing, setNowTabPulsing] = useState(false)
  const [nowTabDot,     setNowTabDot]     = useState(false)
  const reminderScheduledRef = useRef(new Set())
  const reminderTimersRef    = useRef([])
  const nowDotTimerRef       = useRef(null)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [uploading, setUploading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [showShareSheet, setShowShareSheet]       = useState(false)
  const [spotLoading, setSpotLoading]             = useState(false)
  const [locationPickerCoords, setLocationPickerCoords] = useState(null) // { lat, lng }

  // Events state
  const [events, setEvents] = useState([])
  const [cityEvents, setCityEvents] = useState([])

  const [previewTimezone, setPreviewTimezone] = useState(() => loadIdentity()?.timezone ?? 'UTC')
  const [previewLiveCount] = useState(() => 15 + Math.floor(Math.random() * 35))
  const [previewEventCount, setPreviewEventCount] = useState(0)
  const [previewEvents, setPreviewEvents]         = useState([])
  const [previewTopicCount, setPreviewTopicCount] = useState(0)
  const [previewTopics,     setPreviewTopics]     = useState([])
  // Landing preview defis — parallel fetch alongside /now (which is event +
  // topic only). Surfaces the new primary entity in the city card so the
  // first-impression activity advertises défis, not just events/hangouts.
  const [previewChallengeCount, setPreviewChallengeCount] = useState(0)
  const [previewChallenges,     setPreviewChallenges]     = useState([])
  const [previewChannelId, setPreviewChannelId]   = useState(() => loadIdentity()?.channelId ?? null)
  // Geo-resolved city — persisted to localStorage so "Back to my location" survives
  // page refreshes. These are set once when geo resolves and never overwritten on city switch.
  const [geoChannelId,    setGeoChannelId]        = useState(() => loadGeoCity()?.channelId ?? null)
  const [geoCity,         setGeoCity]             = useState(() => loadGeoCity()?.city      ?? null)
  const [geoCountry,      setGeoCountry]          = useState(() => loadGeoCity()?.country   ?? null)
  const [geoTimezone,     setGeoTimezone]         = useState(() => loadGeoCity()?.timezone  ?? null)
  // Viewer coords for NOW distance display — set only by the boot geolocation
  // (which runs on every load). NOT restored from storage: if the user has
  // disabled geolocation, this stays null so cards show the address (or nothing
  // when there's no address) and use the default ordering — never a stale fix.
  const [userLocation,    setUserLocation]         = useState(null)
  const [activeEventId, setActiveEventId] = useState(null)
  const [activeEvent, setActiveEvent] = useState(null)
  const [showEventDrawer, setShowEventDrawer] = useState(false)
  const [showUpcomingEvents, setShowUpcomingEvents] = useState(false)
  const [showPastArchive, setShowPastArchive] = useState(false)
  const [showPeopleDrawer, setShowPeopleDrawer] = useState(false)
  const [legends,      setLegends]      = useState([])  // city ambassadors (Local legends section)
  const [crewMembers,  setCrewMembers]  = useState([])
  const [crewPage,     setCrewPage]     = useState(1)
  const [crewHasMore,  setCrewHasMore]  = useState(false)
  const [crewLoading,  setCrewLoading]  = useState(false)
  const [filterBadge,  setFilterBadge]  = useState(null)
  const [filterVibe,   setFilterVibe]   = useState(null)
  const [filterMode,   setFilterMode]   = useState(null)
  const [viewingProfile, setViewingProfile] = useState(null) // { userId, nickname } for public profile
  const [viewingVenueId, setViewingVenueId] = useState(() => {
    // Eager init: if the cold-load URL is /venue/<...>, capture the id now so
    // the overlay renders on the very first paint. The deep-link effect below
    // also handles guest bootstrap so the app shell becomes ready underneath.
    const link = parseDeepLink()
    return (link && link.type === 'venue') ? link.id : null
  })
  const [guestProfile,   setGuestProfile]   = useState(null) // { guestId, nickname } for guest-only profiles

  // Central access rule: guest users cannot view registered profiles.
  // Use this everywhere instead of calling setViewingProfile directly.
  function openProfile(userId, nickname = '') {
    if (!account) { setGuestGate({ reason: 'view_profile' }); return }
    setViewingProfile({ userId, nickname })
    track('viewed_profile', { profile_id: userId })
  }

  // Render message text with @mentions as styled, clickable spans (→ profile).
  // Mentions carry the CURRENT username resolved by the backend.
  function renderMessageContent(item) {
    return splitContentByMentions(item.content ?? '', item.mentions).map((seg, i) => {
      if (seg.type === 'text') return <span key={i}>{linkifyText(seg.text, `m${i}-`)}</span>
      // Online-guest mention: 👻 pill, inert (no profile nav). Anchored on the
      // stable guestId; if the guest has left it just renders as styled text.
      if (seg.guestId) {
        const online = onlineUsers.some(u => u.guestId === seg.guestId)
        return (
          <span
            key={i}
            className={`msg-mention msg-mention--guest${online ? '' : ' msg-mention--offline'}`}
            title={online ? undefined : 'This guest has left'}
          >👻 @{seg.username}</span>
        )
      }
      return <span key={i} className="msg-mention" onClick={e => { e.stopPropagation(); openProfile(seg.userId, seg.username) }}>@{seg.username}</span>
    })
  }
  const [showConversations, setShowConversations] = useState(false)
  const [activeDm, setActiveDm] = useState(null) // { conversation, otherUser }
  const [conversations, setConversations] = useState(null) // { dms, events } — loaded by ConversationsScreen on open
  const [conversationsHasUnread, setConversationsHasUnread] = useState(false) // lightweight dot, set at boot
  const [showProfileDrawer, setShowProfileDrawer] = useState(false)
  const [showAuthScreen, setShowAuthScreen] = useState(false)
  const [showAuthScreenTab, setShowAuthScreenTab] = useState('signup') // 'signup' | 'login'
  const [showAccountWelcome, setShowAccountWelcome] = useState(false)  // one-time congrats, shown after signup only
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetPasswordToken, setResetPasswordToken] = useState(null) // non-null = show reset screen
  const [account, setAccount] = useState(null)        // null = guest, object = registered
  const [showOnboarding, setShowOnboarding] = useState(false) // first-time guest carousel
  const [showChallengeIntro, setShowChallengeIntro] = useState(false) // "how challenges work" carousel, opened from city-chat feed prompt
  const [showNotifications, setShowNotifications] = useState(false)
  const [showFriendRequests, setShowFriendRequests] = useState(false)
  const [notifUnreadCount, setNotifUnreadCount] = useState(0)
  const [friendReqCount, setFriendReqCount] = useState(0)

  // Event limit reached — shown when a non-Legend user has already created
  // their event today (preflight check), or when the POST returns the
  // `event_limit_reached` error code (race safety).
  const [showEventLimitReached, setShowEventLimitReached] = useState(false)

  // First-time onboarding carousel — guests only, once. Fires AFTER the city
  // channel is ready (so it overlays a loaded screen instead of blocking/
  // flashing first paint). Registered users never trigger it (account guard);
  // hasSeenOnboarding() keeps it from re-appearing on later visits.
  useEffect(() => {
    if (status !== 'ready' || account || hasSeenOnboarding()) return
    // Entered on a content deep-link (typed/shared /city, /event, … URL) → skip
    // onboarding entirely. It's only for visitors who arrived via the landing page.
    if (ENTRY_WAS_DEEP_LINK) return
    const t = setTimeout(() => setShowOnboarding(true), 350)
    return () => clearTimeout(t)
  }, [status, account])

  // ── Tab scroll preservation ─────────────────────────────────────────────────
  // Each of the 3 inline tab drawers (NOW / HERE / ME-guest) has its own scroll
  // container. Drawers unmount when their flag flips false, so we stash the
  // last scrollTop in a ref and restore it the next time the tab opens.
  // ProfileScreen (signed-in ME) has its own internal scroll — not preserved
  // here; see TODO in ProfileScreen.jsx if that becomes important.
  const tabScrollTops = useRef({ now: 0, here: 0, meGuest: 0 })
  const nowBodyRef     = useRef(null)
  const hereBodyRef    = useRef(null)
  const meGuestBodyRef = useRef(null)

  useEffect(() => {
    if (!showEventDrawer) return
    const el = nowBodyRef.current
    if (!el) return
    el.scrollTop = tabScrollTops.current.now
    return () => { tabScrollTops.current.now = el.scrollTop }
  }, [showEventDrawer])

  // Reset the challenges paginator + sub-filter whenever the parent filter
  // leaves/enters 'challenges'. Without this, switching between filters and
  // back would leak whatever state the user paginated to last time.
  useEffect(() => {
    setChallengesShownCount(NOW_CHALLENGES_CAP)
    if (nowFilter !== 'challenges') setChallengeTypeFilter('all')
  }, [nowFilter])

  // Reset the visible-count when the type sub-filter changes — switching
  // from "food" to "place" should land the user at the top of that bucket.
  useEffect(() => {
    setChallengesShownCount(NOW_CHALLENGES_CAP)
  }, [challengeTypeFilter])

  // Scroll-to-load-more on the Challenges filter. When the user is within
  // ~240px of the bottom of the page-body, bump the cap by 5. Cheap (a
  // single scroll listener while the filter is active) and respects the
  // existing scroll-restore effect because we don't reset scrollTop here.
  useEffect(() => {
    if (nowFilter !== 'challenges') return
    const el = nowBodyRef.current
    if (!el) return
    const onScroll = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < 240) {
        setChallengesShownCount(c => c + NOW_CHALLENGES_CAP)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [nowFilter])

  useEffect(() => {
    if (!showPeopleDrawer) return
    const el = hereBodyRef.current
    if (!el) return
    el.scrollTop = tabScrollTops.current.here
    return () => { tabScrollTops.current.here = el.scrollTop }
  }, [showPeopleDrawer])

  useEffect(() => {
    // Only applies to the guest ME path (inline drawer). Signed-in ME uses
    // <ProfileScreen /> which manages its own scroll.
    if (!showProfileDrawer || account) return
    const el = meGuestBodyRef.current
    if (!el) return
    el.scrollTop = tabScrollTops.current.meGuest
    return () => { tabScrollTops.current.meGuest = el.scrollTop }
  }, [showProfileDrawer, account])

  // Single source of truth for the current user's display name.
  // Registered users always use backend display_name; guests use localStorage nickname.
  const activeNickname = account?.display_name ?? nickname

  // Use full conversations state when available (after ConversationsScreen loads), else lightweight boot flag.
  const hasAnyUnread = conversations != null
    ? (conversations.dms.some(dm => dm.has_unread) || conversations.events.some(ev => ev.has_unread))
    : conversationsHasUnread

  const [profileNickInput, setProfileNickInput] = useState('')
  const [showCreateEvent,    setShowCreateEvent]    = useState(false)
  const [showCreateTopic,    setShowCreateTopic]    = useState(false)
  const [showCreateChooser,  setShowCreateChooser]  = useState(false)
  const [nowFilter,          setNowFilter]          = useState('all') // 'all' | 'challenges' | 'events' | 'topics'
  // Sub-filter chips inside the Challenges filter — food / place / culture /
  // help. Reset to 'all' whenever the parent filter leaves 'challenges'.
  const [challengeTypeFilter, setChallengeTypeFilter] = useState('all')
  // Visible-cap for the Challenges feed. Starts at 5; scroll-to-bottom on
  // the .page-body bumps it by 5 until we've shown every loaded challenge.
  const NOW_CHALLENGES_CAP = 5
  const [challengesShownCount, setChallengesShownCount] = useState(NOW_CHALLENGES_CAP)
  const [cityChallenges,     setCityChallenges]     = useState([])
  const [activeTopic,        setActiveTopic]        = useState(null)  // topic object
  const [activeChallenge,    setActiveChallenge]    = useState(null)  // challenge object — opens ChallengeChatPage
  const [showCreateChallenge, setShowCreateChallenge] = useState(false)
  const [editChallengeObj,    setEditChallengeObj]    = useState(null)  // challenge being edited (owner)
  // Floating "seed it" modal shown immediately after a challenge is created.
  // Carries the new challenge so the modal can fetch city members + invite.
  const [postCreateChallenge, setPostCreateChallenge] = useState(null)
  // PR2 — per-acceptance threads
  const [activeThreadChannelId, setActiveThreadChannelId] = useState(null)  // opens ThreadChatPage
  const [showThreadsList,       setShowThreadsList]       = useState(false) // opens ThreadsListPage
  const [guestGate, setGuestGate] = useState(null) // { reason: 'create_event' | 'view_profile' | ... }

  // Hangouts are members-only — gate guests to signup, otherwise open the channel.
  const openHangout = (topic) => {
    if (!account) { setGuestGate({ reason: 'join_hangout' }); return }
    setActiveTopic(topic)
  }
  // Hosting a hangout is members-only too — gate guests to signup.
  const openCreateHangout = () => {
    if (!account) { setGuestGate({ reason: 'create_hangout' }); return }
    setShowCreateTopic(true)
  }
  // Challenges allow guests (mirrors events, not hangouts). No auth gate.
  const openCreateChallenge = () => {
    // Registered-only — same gate as openCreateEvent / openCreateTopic.
    // Guests can still browse, accept and chat in challenge channels;
    // creation requires an account so we have a verified owner for
    // validate/edit/delete and a target for participant notifications.
    if (!account) { setGuestGate({ reason: 'create_challenge' }); return }
    setShowCreateChallenge(true)
  }
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
  const [showGoingModal,    setShowGoingModal]    = useState(false)
  const [goingList,         setGoingList]         = useState([])
  const [goingListLoading,  setGoingListLoading]  = useState(false)
  const [membersNoun,       setMembersNoun]       = useState('going') // 'going' (events) | 'in this hangout'
  const [editTopic,         setEditTopic]         = useState(null)    // hangout being edited (owner)
  const [eventParticipants, setEventParticipants] = useState({}) // { [eventId]: number }
  const [participatedEvents, setParticipatedEvents] = useState(new Set()) // eventIds user toggled
  const [topics,          setTopics]          = useState([])
  // Distance (meters) from the viewer per located item — computed once per
  // [events, cityEvents, topics, userLocation] change (not per render). Topics
  // (hangouts) use the creator's coords captured at creation.
  const distanceByEventId = useMemo(() => {
    const map = new Map()
    if (!userLocation) return map
    for (const e of [...events, ...cityEvents, ...topics]) {
      if (typeof e.venue_lat === 'number' && typeof e.venue_lng === 'number') {
        map.set(e.id, haversineMeters(userLocation.lat, userLocation.lng, e.venue_lat, e.venue_lng))
      }
    }
    return map
  }, [events, cityEvents, topics, userLocation])
  const [hotEventsStatus, setHotEventsStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [cityCountry, setCityCountry] = useState(null)
  // 'pending' | 'resolving' | 'denied' | 'error'
  const [geoState, setGeoState] = useState('pending')
  const [obPickingCity, setObPickingCity] = useState(false)
  const [obShowAuth, setObShowAuth] = useState(false)
  const [obAuthInitialTab, setObAuthInitialTab] = useState('signup')
  const [obChannels, setObChannels] = useState([])
  const [obChannelsLoading, setObChannelsLoading] = useState(false)
  const [citySearchQuery, setCitySearchQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('active') // 'active' | 'events' | 'online'

  // ── Lazy-load full channel list — only fetched when user actually searches ───
  // The ranked top-10 (loadChannels) is fetched on open; the full unsorted list
  // is only needed for search filtering, so we defer it until the first keystroke.
  useEffect(() => {
    if (!showCityPicker || !citySearchQuery.trim() || allChannels.length > 0) return
    let cancelled = false
    fetchChannels(null)
      .then(d => { if (!cancelled) setAllChannels(d.channels ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [showCityPicker, citySearchQuery, allChannels.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local legends fetch — ambassadors for this city (no filter dependency) ──
  useEffect(() => {
    if (!showPeopleDrawer || viewingProfile || !channelId) return
    fetchCityAmbassadors(channelId)
      .then(data => setLegends(data.ambassadors ?? []))
      .catch(() => {})
  }, [showPeopleDrawer, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── City crew fetch — triggered when people drawer opens or filters change ──
  // Guard: skip when a profile overlay is open — the crew list isn't visible.
  const crewChannelRef = useRef(null)
  useEffect(() => {
    if (!showPeopleDrawer || viewingProfile || !channelId) return
    const cid = channelId
    crewChannelRef.current = cid
    setCrewMembers([])
    setCrewPage(1)
    setCrewHasMore(false)
    setCrewLoading(true)
    fetchCityMembers(cid, { page: 1, badge: filterBadge, vibe: filterVibe, mode: filterMode })
      .then(data => {
        if (crewChannelRef.current !== cid) return
        setCrewMembers(data.members)
        setCrewHasMore(data.hasMore)
        setCrewPage(1)
      })
      .catch(() => {})
      .finally(() => { if (crewChannelRef.current === cid) setCrewLoading(false) })
  }, [showPeopleDrawer, channelId, filterBadge, filterVibe, filterMode])

  function loadMoreCrew() {
    if (!channelId || crewLoading || !crewHasMore) return
    const cid  = channelId
    const next = crewPage + 1
    setCrewLoading(true)
    fetchCityMembers(cid, { page: next, badge: filterBadge, vibe: filterVibe, mode: filterMode })
      .then(data => {
        if (crewChannelRef.current !== cid) return
        setCrewMembers(prev => [...prev, ...data.members])
        setCrewHasMore(data.hasMore)
        setCrewPage(next)
      })
      .catch(() => {})
      .finally(() => { if (crewChannelRef.current === cid) setCrewLoading(false) })
  }

  const isNearBottomRef = useRef(true) // true = auto-pin viewport to bottom on new content
  const FEED_MAX = 250 // trim oldest messages to keep React render time bounded
  const hasMoreMessagesRef = useRef(false) // mirrors hasMoreMessages state, readable inside scroll handlers
  const oldestMessageIdRef = useRef(null)  // ID of the oldest message in the feed — pagination cursor
  const loadingOlderRef    = useRef(false) // true while an older-page fetch is in flight
  const appendFeed = (items) => setFeed(prev => {
    const next = Array.isArray(items) ? [...prev, ...items] : [...prev, items]
    return next.length > FEED_MAX ? next.slice(next.length - FEED_MAX) : next
  })
  const pollRef = useRef(null)
  const activityRef = useRef(null)
  const activeRef = useRef(false)
  const knownIdsRef = useRef(new Set())
  const lastJoinAtRef = useRef(0)          // throttle: timestamp of last join shown in feed
  const promptsShownRef = useRef(new Set())// tracks which prompt subtypes have been injected
  const prevEventCountRef = useRef(0)      // detects new events added to the events list
  const prevChallengeCountRef = useRef(0)  // detects new challenges added to cityChallenges
  const locPromiseRef = useRef(null)
  const openScreenOnJoinRef = useRef(null) // set by deep link; opened after handleJoin completes
  // Guard for the auto-bootstrap effect — prevents the deep-link auto-join
  // from firing twice under React StrictMode in dev.
  const guestAutoJoinedRef = useRef(false)
  const activeChannelRef = useRef(null) // guards against rapid-switch race conditions
  const switchCityRef = useRef(null) // latest switchCity closure, for the popstate handler
  const chatInputRef = useRef(null)
  // @mention autocomplete for the shared city/event composer. Context follows the
  // active event (event chat) or falls back to the city channel.
  const mentions = useMentions({
    context:   activeEvent ? 'event' : 'city',
    channelId: activeEvent ? activeEvent.id : channelId,
    value:     input,
    setValue:  setInput,
    inputRef:  chatInputRef,
    onlineUsers,   // city context: currently-online guests become mentionable (live-only)
  })
  const sessionIdRef = useRef(PAGE_SESSION_ID)
  const guestIdRef   = useRef(null)   // always-current guestId for own-message WS echo detection
  const pollFnRef = useRef(null)      // current room's poll function — called immediately on tab focus
  const tabHiddenAtRef = useRef(null) // timestamp when tab was last hidden — guards doRefresh against rapid cycles
  const socketRef = useRef(null)      // WebSocket presence client
  const nicknameRef = useRef(nickname) // tracks current nickname for use in closures
  const accountRef  = useRef(account)  // tracks current account for use in closures
  const heartbeatRef = useRef(null)   // periodic heartbeat interval
  // Tracks status for use inside effects without adding status as a reactive dep
  const statusRef = useRef('onboarding')
  // AbortController for the landing-page preview /now fetch. Aborted when bootstrap starts
  // so the preview never competes with the critical join + messages requests.
  const previewNowAbortRef = useRef(null)
  const typingTimeoutRef = useRef(null) // debounce timer for typingStop
  const isTypingRef = useRef(false)     // true while typingStart has been sent
  const fileInputRef = useRef(null)

  // Events refs
  const activeEventIdRef = useRef(null)

  // City feed cache — saved when entering event chat, restored on return to city.
  // Avoids an extra GET /messages round-trip every time the user leaves an event.
  const cityFeedCacheRef    = useRef([])           // feed snapshot before event entry
  const cityKnownIdsCacheRef = useRef(new Set())   // knownIds snapshot before event entry
  const cityCursorCacheRef  = useRef({ oldestId: null, hasMore: false }) // reverse-scroll cursor snapshot before event entry
  // City messages received via WS while the user is in event mode (normally filtered out).
  // Buffered here so they can be replayed on return — eliminates the delta fetchMessages call.
  const cityMsgBufferRef    = useRef([])           // { message } objects buffered during event mode

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
    ? t('pwa.addToHome')
    : installPrompt.instructionText

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

  // Lightweight unread check at boot — only fetches a boolean, not the full conversations list.
  // Full conversations are loaded by ConversationsScreen when it mounts.
  // Deferred 2 s so it doesn't compete with join + messages on the critical path.
  useEffect(() => {
    if (!account) { setConversationsHasUnread(false); setConversations(null); return }
    const t = setTimeout(() => {
      fetchConversationsUnread()
        .then(d => {
          if (d === null) {
            // 401 — session expired mid-session; sign out cleanly
            localStorage.removeItem(AUTH_FLAG_KEY)
            accountRef.current = null
            setAccount(null)
            return
          }
          setConversationsHasUnread(d.has_unread ?? false)
        })
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load "My events" whenever the profile drawer opens — registered users only.
  // Ghost users cannot create events (event creation requires auth), so there is
  // nothing to show and no point calling the now-auth-gated endpoint.
  useEffect(() => {
    if (!showProfileDrawer || !account || !guest?.guestId) return
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

  // Pending incoming friend-request count for the badge on the Me drawer's
  // Friends tab. Bumped/decremented via per-user WS so the badge stays fresh
  // without re-fetching on every drawer open.
  useEffect(() => {
    if (!account?.id) { setFriendReqCount(0); return }
    fetchIncomingFriendRequestCount().then(setFriendReqCount).catch(() => {})
    const sock = socketRef.current
    if (!sock?.on) return
    const offRecv   = sock.on('friendRequestReceived',  () => setFriendReqCount(c => c + 1))
    const offCxled  = sock.on('friendRequestCancelled', () => setFriendReqCount(c => Math.max(0, c - 1)))
    const offAccept = sock.on('friendRequestAccepted',  () => { /* I'm the sender; my outgoing went down, not incoming */ })
    return () => { offRecv(); offCxled(); offAccept() }
  }, [account?.id])

  // Fetch notification unread count once on account load.
  // Badge is kept current via local state transitions:
  //   - NotificationsScreen sets it to the true server count on open
  //   - handleMarkAllRead / handleClickNotif decrement it locally
  // Deferred 2 s so it doesn't compete with join + messages on the critical path.
  useEffect(() => {
    if (!account) { setNotifUnreadCount(0); return }
    let cancelled = false
    const t = setTimeout(() => {
      fetchUnreadCount()
        .then(d => {
          if (cancelled) return
          if (d === null) {
            // 401 — session expired mid-session; sign out cleanly
            localStorage.removeItem(AUTH_FLAG_KEY)
            accountRef.current = null
            setAccount(null)
            return
          }
          setNotifUnreadCount(d.count)
        })
        .catch(() => {})
    }, 2000)
    return () => { cancelled = true; clearTimeout(t) }
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  // Register push when account becomes available (login/register or page reload with session).
  // Also handles silent re-registration when permission was already granted.
  // Deferred 3 s — completely non-critical, must not compete with join/messages.
  useEffect(() => {
    if (!account) return
    const t = setTimeout(() => { registerPush().catch(() => {}) }, 3000)
    return () => clearTimeout(t)
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
      if (path === '/friend-requests') { setShowFriendRequests(true); return }
      const eventMatch = path.match(/^\/event\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i)
      if (eventMatch) {
        const eid = eventMatch[1].toLowerCase()
        const ev  = events.find(e => e.id === eid) ?? cityEvents.find(e => e.id === eid)
        if (ev) handleSelectEvent(ev)
        else    setShowEventDrawer(true)
        return
      }
      const userMatch = path.match(/^\/user\/([a-f0-9-]+)$/)
      if (userMatch) {
        openProfile(userMatch[1], '')
      }
      if (path === '/me') {
        setShowProfileDrawer(true)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [events, cityEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep statusRef in sync so effects can read current status without reactive deps.
  useEffect(() => { statusRef.current = status }, [status])

  // Keep accountRef + nicknameRef in sync so closures always see the latest identity.
  // Also re-assert WS presence when login/logout happens mid-session.
  useEffect(() => {
    accountRef.current = account
    SELF_IDENTITY.userId = account?.id ?? null
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
        account?.mode ?? 'exploring',
        guestIdRef.current,
      )
    }
    // Subscribe to the per-user WS channel so friend-request events reach
    // this tab. Replayed automatically on reconnect via the socket client.
    if (account?.id && socketRef.current) {
      socketRef.current.joinUser(account.id)
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

    if (link.type === 'past') {
      // Same city resolution as a /city/:slug link, then auto-open the archive
      // once the join completes (handled below via openScreenOnJoinRef).
      openScreenOnJoinRef.current = 'past'
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

    if (link.type === 'topic') {
      locPromiseRef.current = fetchTopicById(link.id).then(data => {
        if (!data) return null
        const { topic, channelId, cityName, country, timezone } = data
        setCity(cityName)
        setCityCountry(country)
        setCityTimezone(timezone)
        setTimeout(() => setActiveTopic(topic), 800)
        return { channelId, city: cityName, timezone, country }
      })
    }

    if (link.type === 'challenge') {
      // Same flow as topic: fetch metadata for the host city, join it, then
      // open the challenge chat once the city's loaded so the user lands on
      // a fully-hydrated page. Skip the city-join setTimeout if the fetch
      // returned null (404) — we'll just stay on home.
      locPromiseRef.current = fetchChallengeById(link.id).then(data => {
        if (!data) return null
        const { challenge, channelId, cityName, country, timezone } = data
        setCity(cityName)
        setCityCountry(country)
        setCityTimezone(timezone)
        setTimeout(() => setActiveChallenge(challenge), 800)
        return { channelId, city: cityName, timezone, country }
      })
    }

    if (link.type === 'conversations')   openScreenOnJoinRef.current = 'conversations'
    if (link.type === 'notifications')   openScreenOnJoinRef.current = 'notifications'
    if (link.type === 'reset-password')  setResetPasswordToken(link.token)
    if (link.type === 'forgot-password') setShowForgotPassword(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a live reference to switchCity so the popstate handler (registered once)
  // always invokes the latest closure (current channelId), never a stale one.
  useEffect(() => { switchCityRef.current = switchCity })

  // Back/forward between cities changes the URL client-side with no reload; without
  // this the app keeps the previous city's feed/events/presence/WS room. Re-resolve
  // the city from the URL and run the full switch (reset + refetch + WS re-subscribe).
  useEffect(() => {
    const onPop = () => {
      if (statusRef.current !== 'ready') return
      const link = parseDeepLink()
      if (!link || link.type !== 'city') return
      fetchCityBySlug(link.slug).then(data => {
        if (!data || data.channelId === activeChannelRef.current) return
        switchCityRef.current?.(data.channelId, data.city, data.timezone, data.country, { fromPop: true })
      }).catch(() => {})
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // start geolocation immediately — runs concurrently with auth check
    locPromiseRef.current = locPromiseRef.current ?? startGeolocation()

    // Resolve auth state BEFORE auto-rejoining so handleJoin always has the
    // correct identity. Without this, accountRef.current is null when
    // handleJoin runs and falls back to the guest nickname from localStorage.
    // Only call if the device has ever had a registered session — skip for pure
    // guests to avoid a guaranteed 401 on every mount.
    if (localStorage.getItem(AUTH_FLAG_KEY)) {
      authMe()
        .then(data => {
          if (data) {
            accountRef.current = data.user // sync ref so handleJoin reads it immediately
            setAccount(data.user)
            // Auto-rejoin if the user has a saved city — skip the landing page entirely
            const saved = loadIdentity()
            if (saved?.channelId) {
              handleJoin(null)
              return
            }
          } else {
            // 401 — session expired; clear the flag so future mounts skip this call
            localStorage.removeItem(AUTH_FLAG_KEY)
          }
          setRehydrating(false)
        })
        .catch(() => {
          setRehydrating(false)
          /* network error — keep flag, session may still be valid */
        })
    } else {
      // ── Guest auto-bootstrap on deep-link entry ────────────────────────────
      // First-time visitors hitting a public deep link (/city/:slug, /event/*,
      // /e/*, /t/*) should land directly on the content, not on LandingPage.
      // Auto-create a guest session in the background. LandingPage stays the
      // entry point only for direct hilads.live/ visits (the marketing path).
      const link = parseDeepLink()
      const isPublicDeepLink =
        link && (link.type === 'city' || link.type === 'event' || link.type === 'topic' || link.type === 'challenge' || link.type === 'venue' || link.type === 'past')
      if (isPublicDeepLink && !guestAutoJoinedRef.current) {
        guestAutoJoinedRef.current = true
        // handleJoin awaits locPromiseRef.current (already set by the deep-link
        // resolver effect above), creates the guest session, joins the
        // channel, flips status to 'ready'. The user never sees LandingPage.
        handleJoin(null)
      }
    }

    // Tab close is treated as a SILENT disconnect, not an explicit leave —
    // intentionally NO leaveRoom / disconnectBeacon here. The WS server's 20s
    // grace + 5-min heartbeat TTL (HEARTBEAT_TTL_MS) lets the user linger on
    // the Here screen the same way mobile users do when the app is killed.
    // City switch still calls leaveRoom (see channel-change handler below) —
    // that's a different intent and stays instant. If you reopen the tab
    // inside the window, joinRoom on mount re-registers the same session
    // and the presence row just gets its last_seen_at bumped.

    // When returning to a hidden tab: re-assert presence and refresh messages.
    // Send joinRoom (not just heartbeat) so the session is re-registered if it somehow expired.
    // Guard: only call doRefresh when the tab was hidden for ≥10 s — prevents permission dialogs
    // and rapid tab-switches from firing fetchMessages multiple times per session.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        tabHiddenAtRef.current = Date.now()
        return
      }
      if (!activeRef.current) return
      if (activeChannelRef.current) {
        socketRef.current?.joinRoom(activeChannelRef.current, sessionIdRef.current, nicknameRef.current, accountRef.current?.id ?? null, accountRef.current?.mode ?? 'exploring', guestIdRef.current)
      }
      const hiddenMs = tabHiddenAtRef.current ? Date.now() - tabHiddenAtRef.current : Infinity
      tabHiddenAtRef.current = null
      if (hiddenMs >= 10_000) {
        pollFnRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const handleKeyDown = (e) => { if (e.key === 'Escape') setLightboxUrl(null) }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearInterval(pollRef.current)
      clearInterval(heartbeatRef.current)
      activeRef.current = false
      clearTimeout(activityRef.current)
      clearTimeout(typingTimeoutRef.current)
      socketRef.current?.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Sticky-bottom scroll: keep the viewport pinned to the bottom whenever the user
  // is already there. Fires synchronously after every DOM commit (useLayoutEffect) so
  // the browser never paints an intermediate scroll position.
  //
  // "Near bottom" is tracked by the scroll listener below (isNearBottomRef). It starts
  // true so the initial load always lands at the bottom. When the user scrolls up it
  // becomes false; when they scroll back within 150 px of the bottom it becomes true
  // again. Any new feed item — messages, event pills, topic pills, system items — will
  // keep them pinned as long as they haven't scrolled away.
  //
  // Channel/event switch: feed clears to [] → reset isNearBottomRef = true so the next
  // channel also starts pinned.
  const messagesContainerRef = useRef(null)
  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    if (feed.length === 0) {
      isNearBottomRef.current = true   // arm pinning for the next channel's content
      return
    }

    if (isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [feed])

  // ── Load older messages (pagination) ─────────────────────────────────────
  // Triggered by the scroll listener below when the user scrolls near the top.
  // Uses refs throughout to avoid stale closures — the scroll handler is attached once.

  async function loadOlderMessages() {
    // Same machinery for city and event chat — they share the feed + scroll
    // container. When an event is open we page its messages; otherwise the city.
    const eventId   = activeEventIdRef.current
    const channelId = activeChannelRef.current
    if ((!eventId && !channelId) || loadingOlderRef.current || !hasMoreMessagesRef.current || !oldestMessageIdRef.current) return

    const container        = messagesContainerRef.current
    const scrollHeightBefore = container?.scrollHeight ?? 0
    const scrollTopBefore    = container?.scrollTop    ?? 0

    loadingOlderRef.current = true
    setLoadingOlder(true)

    try {
      const data = eventId
        ? await fetchEventMessages(eventId, { beforeId: oldestMessageIdRef.current, limit: 50 })
        : await fetchMessages(channelId, { beforeId: oldestMessageIdRef.current, limit: 50 })
      // bail if the user switched context (city/event) while loading
      if (eventId ? activeEventIdRef.current !== eventId : activeChannelRef.current !== channelId) return

      const msgs  = data.messages ?? []
      const fresh = msgs.filter(m => !knownIdsRef.current.has(messageKey(m)))
      fresh.forEach(m => knownIdsRef.current.add(messageKey(m)))

      // Cursor = oldest message that HAS an id (system rows now carry one too).
      const nextOldest = msgs.find(m => m.id)?.id
      if (nextOldest) oldestMessageIdRef.current = nextOldest

      if (fresh.length > 0) {
        setFeed(prev => [...fresh.map(m => toFeedItem(m)).filter(Boolean), ...prev])
      }

      // Stop if the cursor couldn't advance: a page with no id-bearing message
      // would otherwise refetch the SAME before_id forever (the request flood).
      const more = (data.hasMore ?? false) && !!nextOldest
      hasMoreMessagesRef.current = more
      setHasMoreMessages(more)

      // Restore scroll position: pin to the same visual content, not the same pixel offset
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = scrollTopBefore + (container.scrollHeight - scrollHeightBefore)
        }
      })
    } catch {
      // silent — user can scroll up again to retry
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  function scrollToMessage(id) {
    const el = msgRefsMap.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMsgId(id)
    setTimeout(() => setHighlightedMsgId(null), 1500)
  }

  const EMOJI_TO_TYPE = { '❤️': 'heart', '👍': 'like', '😂': 'laugh', '😮': 'wow', '🔥': 'fire' }

  function triggerReactionBurst(emojiOrType, messageId) {
    const el = msgRefsMap.current.get(messageId)
    if (!el) return // message not visible — skip
    const rect = el.getBoundingClientRect()
    const x    = rect.left + rect.width  / 2
    const y    = rect.top  + rect.height * 0.3
    const type = EMOJI_TO_TYPE[emojiOrType] ?? emojiOrType
    const id   = ++reactionBurstIdRef.current
    setReactionBursts(prev => [...prev, { id, type, x, y }])
  }
  // Keep ref current so the socket listener (closed over on mount) always calls the latest version
  triggerReactionBurstRef.current = triggerReactionBurst

  // Attach scroll listener to the messages container.
  // - Tracks isNearBottomRef: true when within 150 px of the bottom, false otherwise.
  //   This drives the sticky-bottom behavior in useLayoutEffect([feed]) above.
  // - Fires loadOlderMessages when the user scrolls within 200 px of the top.
  // Re-attaches whenever status changes so the ref is always populated.
  // Collapse-on-scroll for the event header. The container is shared with the
  // city channel scroll, but the .event-header--collapsed class only takes
  // effect when the event-header is rendered (event mode), so it's safe to
  // toggle unconditionally.
  const [eventHeaderCollapsed, setEventHeaderCollapsed] = useState(false)
  const eventHeaderCollapsedRef = useRef(false)

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight
      isNearBottomRef.current = dist < 150

      // Toggle the event-header collapsed class once the user scrolls past a
      // small threshold. Using a ref-guarded setState avoids re-renders on
      // every scroll tick.
      const shouldCollapse = container.scrollTop > 30
      if (shouldCollapse !== eventHeaderCollapsedRef.current) {
        eventHeaderCollapsedRef.current = shouldCollapse
        setEventHeaderCollapsed(shouldCollapse)
      }

      if (container.scrollTop < 200 && !loadingOlderRef.current && hasMoreMessagesRef.current) {
        loadOlderMessages()
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [status]) // re-attach when status changes (e.g. container mounts on 'ready')

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
      const userLat = position.coords.latitude
      const userLng = position.coords.longitude
      // Capture the viewer's coords for NOW distance display (single read; no watcher).
      setUserLocation({ lat: userLat, lng: userLng })
      // Reverse-geocode to country (Nominatim) so backend can constrain
      // nearest-city to the same country. Non-fatal if it fails — backend
      // falls back to global nearest when no country is sent.
      const country = await reverseGeocodeCountry(userLat, userLng)
      const location = await resolveLocation(userLat, userLng, country)
      setCity(location.city)
      setCityCountry(location.country ?? null)
      setPreviewTimezone(location.timezone ?? 'UTC')
      setPreviewChannelId(location.channelId ?? null)
      setGeoChannelId(location.channelId ?? null)
      setGeoCity(location.city ?? null)
      setGeoCountry(location.country ?? null)
      setGeoTimezone(location.timezone ?? null)
      // Persist so "Back to my location" survives page refreshes
      saveGeoCity({ channelId: location.channelId, city: location.city, country: location.country, timezone: location.timezone })
      setGeoState('resolved')
      return location
    } catch (err) {
      // Geolocation unavailable/denied → clear any coords so NOW falls back to
      // showing addresses instead of a stale distance.
      setUserLocation(null)
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

  // Fetch landing page preview: events + topics for the pre-join activity block.
  // Fallback chain:
  //   1. /now → today's Hilads events + active topics + Ticketmaster publicEvents
  //   2. If no events at all → /events/upcoming (generates series occurrences for next 7 days)
  // Topics from /now are always used if available (24h TTL, user-created).
  // The upcoming fallback ensures recurring city events (daily/weekly series) always show.
  //
  // Critical path guard:
  //   - Skip entirely when status is already 'joining' or 'ready' — the post-join
  //     fetchNowFeed (inside handleJoin) will load events after bootstrap.
  //   - Store the AbortController in previewNowAbortRef so handleJoin can cancel this
  //     request the moment bootstrap starts, preventing /now from competing with
  //     POST /join + GET /messages?lean=1 for server resources.
  useEffect(() => {
    if (!previewChannelId) return
    // Don't fire if we're already joining or in the channel — post-join fetchNowFeed handles it.
    if (statusRef.current !== 'onboarding') return

    // Cancel any previous in-flight preview /now before starting a new one.
    previewNowAbortRef.current?.abort()
    const controller = new AbortController()
    previewNowAbortRef.current = controller

    fetchNowFeed(previewChannelId, null, { signal: controller.signal })
      .then(async data => {
        if (controller.signal.aborted) return
        const items        = data.items        ?? []
        const publicEvents = data.publicEvents ?? []

        const eventItems = items.filter(i => i.kind === 'event')
        const topicItems = items.filter(i => i.kind === 'topic')

        // Topics: use whatever /now returned
        setPreviewTopicCount(topicItems.length)
        setPreviewTopics(topicItems.slice(0, 3))

        // Events: Hilads today → Ticketmaster → upcoming series (next 7 days)
        let eventsToShow = eventItems.length > 0 ? eventItems : publicEvents

        if (eventsToShow.length === 0) {
          try {
            const up = await fetchUpcomingEvents(previewChannelId, 7)
            eventsToShow = (up.events ?? [])
              .slice(0, 3)
              .map(e => ({ ...e, kind: 'event', event_type: e.type ?? 'other' }))
          } catch {
            // ignore — leave eventsToShow empty
          }
        }

        setPreviewEventCount(eventsToShow.length)
        setPreviewEvents(eventsToShow.slice(0, 3))
      })
      .catch(() => {})

    // Parallel — challenges aren't part of /now (separate axis); fetch them
    // alongside so the landing card surfaces the new primary entity. Best-
    // effort; any failure just leaves previewChallenges empty.
    fetchCityChallenges(previewChannelId, 3).then(chs => {
      if (controller.signal.aborted) return
      const list = Array.isArray(chs) ? chs : []
      setPreviewChallengeCount(list.length)
      setPreviewChallenges(list.slice(0, 3))
    }).catch(() => {})

    return () => { controller.abort(); previewNowAbortRef.current = null }
  }, [previewChannelId])

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
        return [...prev, { type: 'activity', id: `act-${Date.now()}`, subtype: activity.subtype, variant: activity.variant, text: activity.text }]
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
        return [...prev, { type: 'prompt', subtype: 'explore', id: `prompt-explore-${Date.now()}`, text: '🔥 See what\'s happening now', cta: 'See what\'s happening' }]
      })
    }, 15000)

    // challenge-intro: 8s, fires once per session. Drops a "How challenges
    // work" pill in the feed; tapping it opens the dedicated carousel. Same
    // ephemeral lifecycle as the other prompts (auto-fades, NOW pulse).
    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('challenge-intro')) return
      setFeed(prev => {
        promptsShownRef.current.add('challenge-intro')
        return [...prev, { type: 'prompt', subtype: 'challenge-intro', id: `prompt-challenge-intro-${Date.now()}`, text: '🔥 New here? Learn how challenges work', cta: 'Show me' }]
      })
    }, 8000)

    // photo: 30s, only if low activity
    setTimeout(() => {
      if (!activeRef.current || activeEventIdRef.current) return
      if (promptsShownRef.current.has('photo')) return
      setFeed(prev => {
        if (prev.filter(m => m.type === 'message').length >= 3) return prev
        promptsShownRef.current.add('photo')
        return [...prev, { type: 'prompt', subtype: 'photo', id: `prompt-photo-${Date.now()}`, text: '📸 Share what\'s happening', cta: 'Shoot' }]
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
      openCreateEvent()
    } else if (item.subtype === 'install') {
      installPrompt.promptInstall().catch(() => {})
    } else if (item.subtype === 'new-event') {
      const event = events.find(e => e.id === item.eventId) ?? cityEvents.find(e => e.id === item.eventId)
      if (event) handleSelectEvent(event)
    } else if (item.subtype === 'challenge-intro') {
      setShowChallengeIntro(true)
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

  // Reminder cards (new event / new hangout / explore-photo-create prompts /
  // ambient crowd) — transient nudges, not conversation. Fade them out after a
  // delay and pulse the NOW tab to point at where that content lives. Real
  // messages, "X joined", weather, install prompt and the welcome card stay.
  function isReminderCard(item) {
    return item.type === 'event'
      || item.type === 'topic'
      || item.type === 'challenge'
      || item.type === 'challenge_validated'
      // 'install' and 'challenge-intro' are sticky prompts — install because
      // the user might miss it on first reflow, challenge-intro because it's
      // an explainer that should sit there until tapped.
      || (item.type === 'prompt' && item.subtype !== 'install' && item.subtype !== 'challenge-intro')
      || (item.type === 'activity' && item.subtype === 'crowd')
  }

  // Pulse the NOW tab once (coalesced while already pulsing). Under reduce-motion,
  // show a static dot for a few seconds instead of animating.
  function pulseNowTab() {
    if (reduceMotionRef.current) {
      setNowTabDot(true)
      if (nowDotTimerRef.current) clearTimeout(nowDotTimerRef.current)
      nowDotTimerRef.current = setTimeout(() => setNowTabDot(false), 3000)
      return
    }
    setNowTabPulsing(true)
  }

  // One timer per reminder id (tracked so we never double-schedule). Fade via the
  // exit CSS class, then drop from the feed + pulse NOW. Reduce-motion: remove
  // instantly, no fade class.
  function scheduleReminderDismiss(id) {
    const t1 = setTimeout(() => {
      if (reduceMotionRef.current) {
        setFeed((prev) => prev.filter((f) => f.id !== id))
        pulseNowTab()
        return
      }
      setFadingIds((prev) => new Set([...prev, id]))
      const t2 = setTimeout(() => {
        setFeed((prev) => prev.filter((f) => f.id !== id))
        setFadingIds((prev) => { const next = new Set(prev); next.delete(id); return next })
        pulseNowTab()
      }, 520)
      reminderTimersRef.current.push(t2)
    }, 6000)
    reminderTimersRef.current.push(t1)
  }

  // Schedule a dismiss for each newly-seen reminder card (once per id).
  useEffect(() => {
    for (const item of feed) {
      if (!item.id || reminderScheduledRef.current.has(item.id)) continue
      if (isReminderCard(item)) {
        reminderScheduledRef.current.add(item.id)
        scheduleReminderDismiss(item.id)
      }
    }
    // isReminderCard/scheduleReminderDismiss are stable within this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed])

  // Clear all pending reminder timers on unmount.
  useEffect(() => () => {
    reminderTimersRef.current.forEach(clearTimeout)
    if (nowDotTimerRef.current) clearTimeout(nowDotTimerRef.current)
  }, [])

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

    const _t0 = performance.now()

    try {
      const savedGuestId   = loadGuestId()
      const savedIdentity  = loadIdentity()

      // ── Guest session: start early, in parallel with location resolution ─────
      // For new users: createGuestSession and geo are both network calls with no
      // dependency on each other. Starting sessionPromise here saves ~200ms that
      // was previously sequential (geo resolved first, then createGuestSession).
      const sessionPromise = savedGuestId
        ? Promise.resolve({ guestId: savedGuestId, nickname: name })
        : createGuestSession(name)
      // The session POST runs eagerly (parallel with geo) but is only awaited
      // far below — after `await locPromiseRef.current`, which takes 700ms-3.4s.
      // If the POST rejects during that window (e.g. a network blip →
      // "TypeError: Failed to fetch"), no handler is attached yet, so the browser
      // fires `unhandledrejection` and Sentry reports phantom noise. Attaching a
      // passive catch marks it handled; the real `await sessionPromise` below
      // still observes the rejection and routes it to the catch at the bottom.
      sessionPromise.catch(() => {})

      // ── Location: fast path for returning users ───────────────────────────────
      // Problem: `await locPromiseRef.current` (GPS fix + resolve API) blocks for
      // 700ms–3400ms before bootstrap even starts — but returning users have
      // channelId already in localStorage and don't need geo at all.
      //
      // Fast path: if savedIdentity.channelId exists, use it immediately.
      //   → bootstrap fires in <5ms (just localStorage reads, no network).
      //
      // Slow path: first-time users with no saved channelId must wait for geo
      //   to discover which city they're in.
      //
      // Geo continues running in background regardless — it updates geoCity /
      // geoChannelId / cityCountry for UI display, but is no longer on the
      // bootstrap critical path.
      let location
      // A /city|/event|/topic|/past URL is authoritative: the cold-load resolver
      // pointed locPromiseRef at the linked city, so it must win over the saved
      // "last city". Without this, a returning user opening /city/abidjan gets
      // dropped back into their saved channel (header says Abidjan but feed/events
      // stay HCMC) — and SSR (URL-based) disagrees with the hydrated app.
      const urlLink = parseDeepLink()
      const deepLinkCity = !rejoinData && urlLink &&
        (urlLink.type === 'city' || urlLink.type === 'event' || urlLink.type === 'topic' || urlLink.type === 'challenge' || urlLink.type === 'past')
      if (rejoinData) {
        console.debug('[hilads:join] path=rejoin ms=0')
        location = await hydrateSavedLocation(rejoinData)
      } else if (deepLinkCity) {
        console.debug('[hilads:join] path=deep-link type=' + urlLink.type + ' ms=' + Math.round(performance.now() - _t0))
        location = await locPromiseRef.current
        // Resolution failed (bad slug / offline) → fall back to saved city rather
        // than dumping a returning user into onboarding.
        if (!location && savedIdentity?.channelId) {
          location = {
            channelId: savedIdentity.channelId,
            city:      savedIdentity.city     ?? null,
            timezone:  savedIdentity.timezone ?? 'UTC',
            country:   null,
          }
        }
      } else if (savedIdentity?.channelId) {
        // Instant — no network call, no GPS wait
        location = {
          channelId: savedIdentity.channelId,
          city:      savedIdentity.city     ?? null,
          timezone:  savedIdentity.timezone ?? 'UTC',
          country:   null,
        }
        console.debug('[hilads:join] path=saved-identity channelId=' + savedIdentity.channelId + ' ms=' + Math.round(performance.now() - _t0))
      } else {
        // First-time user: wait for GPS + city resolve
        console.debug('[hilads:join] path=geo-wait ms=' + Math.round(performance.now() - _t0))
        location = await locPromiseRef.current
        console.debug('[hilads:join] geo-resolved ms=' + Math.round(performance.now() - _t0))
      }

      if (!location && !rejoinData) {
        // Geo was denied before a city was selected — return to onboarding
        setStatus('onboarding')
        return
      }
      if (rejoinData?.city) setCity(rejoinData.city)

      const session = await sessionPromise
      console.debug('[hilads:join] session-ready → bootstrap ms=' + Math.round(performance.now() - _t0))
      setAnalyticsContext({
        city:     location.city ?? null,
        country:  location.country ?? null,
        is_guest: !accountRef.current,
        guest_id: session.guestId,
        user_id:  accountRef.current?.id ?? null,
      })
      if (!savedGuestId) {
        saveGuestId(session.guestId)
        // identifyUser / guest_created deferred to after bootstrap — see below
      }
      guestIdRef.current = session.guestId
      SELF_IDENTITY.guestId = session.guestId
      setGuest(session)
      setChannelId(location.channelId)
      setCityTimezone(location.timezone ?? 'UTC')
      activeChannelRef.current = location.channelId

      setHotEventsStatus('loading')

      // Reset pagination state for this channel
      hasMoreMessagesRef.current = false
      setHasMoreMessages(false)
      oldestMessageIdRef.current = null

      // Abort any in-flight landing-page preview /now so it doesn't compete with
      // the critical bootstrap requests on the server side.
      previewNowAbortRef.current?.abort()
      previewNowAbortRef.current = null

      // Parallel fetch: join (presence CTE + join event) and messages (read-only, lean)
      // run concurrently — critical path = max(join, messages) instead of their sum.
      const [joinData, messagesData] = await Promise.all([
        joinChannel(location.channelId, sessionIdRef.current, session.guestId, name),
        fetchLeanMessages(location.channelId, { limit: 50 }),
      ])
      const boot = {
        joinMessage: joinData.message ?? null,
        messages:    messagesData.messages ?? [],
        hasMore:     messagesData.hasMore  ?? false,
        onlineCount: null, // WS presenceSnapshot will set this immediately after socket join
      }

      // boot.joinMessage is null for re-joins within presence TTL — handle gracefully
      const joinKey = boot.joinMessage ? messageKey(boot.joinMessage) : null
      knownIdsRef.current = new Set(boot.messages.map(messageKey).filter(Boolean))

      const total = boot.messages.length
      const initialItems = dedupeWeather(boot.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      }))

      setFeed(initialItems)

      // Set pagination cursor: oldest message that HAS an id (system messages
      // — arrivals/weather — come back id-less, so boot.messages[0] is often id-less).
      const more = boot.hasMore ?? false
      hasMoreMessagesRef.current = more
      setHasMoreMessages(more)
      if (more) oldestMessageIdRef.current = boot.messages.find(m => m.id)?.id ?? null
      setOnlineUsers([{ id: 'me', sessionId: sessionIdRef.current, nickname: name, isMe: true }])
      setOnlineCount(boot.onlineCount ?? null)
      setStatus('ready')

      // If the user entered via the bare root (hilads.live, /fr, /vi) and then
      // joined a city — onboarding pick or returning-user auto-rejoin — reflect
      // the city in the URL (localized via pushUrl). Without this the URL stays
      // on the root shell, so a fresh load / view-source returns the static
      // English index.html instead of the city's localized SSR meta. Deep-link
      // entries (/city, /event, …) already carry the right URL; pushUrl no-ops
      // when the localized target matches the current path.
      if (/^\/(fr|vi|es)?$/.test(window.location.pathname) && location.city) {
        pushUrl(`/city/${cityToSlug(location.city)}`)
      }

      // ── Deferred badge enrichment ────────────────────────────────────────────
      // Bootstrap (lean=1) skips the badge DB query — messages arrive with ghost
      // badges by default. Enrich registered-user messages immediately after the
      // screen is usable so badges appear within ~200 ms of first render.
      const joinBadgeIds = [...new Set(
        boot.messages
          .filter(m => (m.type === 'text' || m.type === 'image') && m.userId)
          .map(m => m.userId)
      )]
      const joinBadgeChannel = location.channelId
      if (joinBadgeIds.length > 0) {
        fetchMessageBadges(joinBadgeChannel, joinBadgeIds).then(badges => {
          if (activeChannelRef.current !== joinBadgeChannel) return
          if (!badges || Object.keys(badges).length === 0) return
          setFeed(prev => prev.map(item => {
            if (item.type !== 'message' || !item.userId || !badges[item.userId]) return item
            const b = badges[item.userId]
            return { ...item, primaryBadge: b.primaryBadge, contextBadge: b.contextBadge, vibe: b.vibe ?? null, mode: b.mode ?? null }
          }))
        })
      }

      // ── Analytics after critical path ────────────────────────────────────────
      // Deferred so PostHog HTTP requests don't compete with /now fetch or the
      // first paint of the city channel. Context (_ctx) is captured at call-time
      // inside trackDeferred so city/country/user are still correct.
      if (!savedGuestId) {
        identifyUser(session.guestId, { account_type: 'guest' })
        trackDeferred('guest_created')
      }
      trackDeferred('joined_city', { city: location.city ?? rejoinData?.city ?? null, channel_id: location.channelId })

      saveIdentity(name, location.channelId, location.city ?? rejoinData?.city ?? null, location.timezone ?? null)
      if (joinKey) scheduleEphemeral(joinKey)
      injectWelcomeCard(location.channelId, location.city ?? rejoinData?.city ?? null)
      if (openScreenOnJoinRef.current === 'conversations') { setShowConversations(true); openScreenOnJoinRef.current = null }
      if (openScreenOnJoinRef.current === 'notifications') { setShowNotifications(true); openScreenOnJoinRef.current = null }
      if (openScreenOnJoinRef.current === 'past')          { setShowPastArchive(true);  openScreenOnJoinRef.current = null }

      activeRef.current = true
      scheduleActivity(true)
      promptsShownRef.current = new Set()
      schedulePrompts()

      // ── Socket: real-time presence ───────────────────────────────────────────
      const socket = socketRef.current ?? createSocket()
      socketRef.current = socket

      // If the user is already authed by the time the socket spins up, kick
      // off the per-user channel subscription. This covers the cold-start
      // ordering where account state lands before handleJoin runs (the
      // account-change effect would have skipped the call because socketRef
      // was still null then).
      if (accountRef.current?.id) {
        socket.joinUser(accountRef.current.id)
      }

      // The API returns channelId as a string but the WS server uses integer Map keys,
      // so the server always sends cityId as a number. Use String() coercion on both
      // sides so "1" === 1 compares equal instead of being silently filtered out.
      const matchesChannel = (cityId) => String(activeChannelRef.current) === String(cityId)

      socket.on('presenceSnapshot', ({ cityId, users, count }) => {
        if (!matchesChannel(cityId)) return
        setOnlineUsers(buildOnlineUsers(users, sessionIdRef.current))
        setOnlineCount(count)
      })

      socket.on('userJoined', ({ cityId, user }) => {
        if (!matchesChannel(cityId)) return
        setOnlineUsers((prev) => {
          if (prev.some((u) => u.sessionId === user.sessionId)) return prev
          return [...prev, { id: user.sessionId, sessionId: user.sessionId, nickname: user.nickname, userId: user.userId ?? null, isRegistered: !!user.userId, isMe: false }]
        })
      })

      socket.on('userLeft', ({ cityId, user }) => {
        if (!matchesChannel(cityId)) return
        setOnlineUsers((prev) => prev.filter((u) => u.sessionId !== user.sessionId))
      })

      socket.on('onlineCountUpdated', ({ cityId, count }) => {
        if (!matchesChannel(cityId)) return
        setOnlineCount(count)
      })

      socket.on('typingUsers', ({ cityId, users }) => {
        if (!matchesChannel(cityId)) return
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
      socket.on('newMessage', ({ channelId, message }) => {
        // City channelId is a number from WS but string from API — use String() coercion.
        // Event channelId is a UUID string on both sides — strict equality works fine.
        const isCityMsg  = String(channelId) === String(activeChannelRef.current)
        const isEventMsg = channelId === activeEventIdRef.current

        if (!isCityMsg && !isEventMsg) return
        // In event mode: buffer city messages rather than discarding them.
        // handleBackToCity will replay the buffer so no delta GET /messages is needed.
        if (activeEventIdRef.current && !isEventMsg) {
          cityMsgBufferRef.current.push(message)
          return
        }

        const key = isEventMsg ? message.id : messageKey(message)
        if (!key || knownIdsRef.current.has(key)) return
        knownIdsRef.current.add(key)

        // Own-message echo detection: if WS delivers our own message while an optimistic
        // placeholder (localId) is still in the feed, replace it atomically instead of
        // appending. This eliminates the brief duplicate that appears when WS beats the
        // POST /messages API response.
        const myGuestId = guestIdRef.current
        const myUserId  = accountRef.current?.id
        const isOwnMsg  = (myGuestId && message.guestId === myGuestId) ||
                          (myUserId  && message.userId  === myUserId)

        if (isEventMsg) {
          setFeed(prev => {
            if (isOwnMsg) {
              const pendingIdx = prev.findIndex(f => f.localId != null)
              if (pendingIdx !== -1) {
                const updated = [...prev]
                updated[pendingIdx] = { type: 'message', ...message }
                return updated.length > FEED_MAX ? updated.slice(updated.length - FEED_MAX) : updated
              }
            }
            const next = [...prev, { type: 'message', ...message }]
            return next.length > FEED_MAX ? next.slice(next.length - FEED_MAX) : next
          })
        } else {
          const item = toFeedItem(message, undefined, lastJoinAtRef)
          if (!item) return // throttled join or unhandled system message
          if (item.subtype === 'join') scheduleEphemeral(item.id)
          // Guest got @mentioned by someone else while online → real-time in-app
          // signal only (highlight + discreet signup nudge). Guests have no push
          // channel, so nothing is sent server-side — this is purely local.
          if (item.type === 'message' && !isOwnMsg && !accountRef.current && myGuestId
              && Array.isArray(message.mentions)
              && message.mentions.some(m => m && m.guestId === myGuestId)) {
            if (message.id) {
              setHighlightedMsgId(message.id)
              setTimeout(() => setHighlightedMsgId(null), 2500)
            }
            setMentionNudge(true)
            setTimeout(() => setMentionNudge(false), 7000)
          }
          setFeed(prev => {
            if (isOwnMsg && item.type === 'message') {
              const pendingIdx = prev.findIndex(f => f.localId != null)
              if (pendingIdx !== -1) {
                const updated = [...prev]
                updated[pendingIdx] = item
                return updated.length > FEED_MAX ? updated.slice(updated.length - FEED_MAX) : updated
              }
            }
            const next = [...prev, item]
            return next.length > FEED_MAX ? next.slice(next.length - FEED_MAX) : next
          })
        }
      })

      // Socket: handle new_event — append card directly from WS payload (no HTTP fetch).
      socket.on('new_event', ({ channelId, hiladsEvent }) => {
        if (String(channelId) !== String(activeChannelRef.current)) return
        if (!hiladsEvent?.id) return
        const ev = {
          kind:             'event',
          id:               hiladsEvent.id,
          title:            hiladsEvent.title ?? '',
          description:      hiladsEvent.location ?? hiladsEvent.venue ?? null,
          created_at:       hiladsEvent.created_at ?? Math.floor(Date.now() / 1000),
          last_activity_at: null,
          active_now:       true,
          event_type:       hiladsEvent.event_type ?? hiladsEvent.type ?? 'other',
          source_type:      hiladsEvent.source_type ?? hiladsEvent.source ?? 'hilads',
          starts_at:        hiladsEvent.starts_at,
          expires_at:       hiladsEvent.expires_at,
          location:         hiladsEvent.location ?? null,
          participant_count: hiladsEvent.participant_count ?? 1,
          is_participating: false,
          recurrence_label: hiladsEvent.recurrence_label ?? null,
          recurrence_type:  hiladsEvent.recurrence_type ?? null,
          recurrence_weekdays: hiladsEvent.recurrence_weekdays ?? [],
          recurrence_interval: hiladsEvent.recurrence_interval ?? null,
        }
        setEvents(prev => prev.some(e => e.id === ev.id) ? prev : [...prev, ev])
        setEventParticipants(prev => ({ ...prev, [ev.id]: ev.participant_count }))
      })

      // Socket: handle new_challenge — append to cityChallenges so (a) the
      // NOW screen strip updates live without a refetch, and (b) the
      // useEffect watching cityChallenges below injects a feed pill into
      // the city chat (mirrors how new_event populates the feed).
      socket.on('new_challenge', ({ channelId, challenge }) => {
        if (String(channelId) !== String(activeChannelRef.current)) return
        if (!challenge?.id) return
        setCityChallenges(prev => prev.some(c => c.id === challenge.id) ? prev : [...prev, challenge])
      })

      // Socket: handle challenge_validated — inject a separate celebration
      // pill ("🏆 Challenge done!") into the city feed. Independent from the
      // original creation pill — both are timeline-worthy events. Dedup by
      // id since the same validation arrives once per session.
      socket.on('challenge_validated', ({ channelId, challenge }) => {
        if (String(channelId) !== String(activeChannelRef.current)) return
        if (!challenge?.id) return
        const id = `challenge-validated-${challenge.id}`
        setFeed(prev => {
          if (prev.some(f => f.id === id)) return prev
          return [...prev, {
            type:        'challenge_validated',
            id,
            challengeId: challenge.id,
            title:       challenge.title,
            nickname:    challenge.nickname,
          }]
        })
        // Also flip the in-memory challenge status so other surfaces (NOW
        // strip, detail page) reflect the new state if the user navigates.
        setCityChallenges(prev => prev.map(c => c.id === challenge.id ? challenge : c))
      })

      // Socket: handle newTopic — append pill directly from WS payload.
      socket.on('newTopic', ({ channelId, topic }) => {
        if (String(channelId) !== String(activeChannelRef.current)) return
        if (!topic?.id) return
        const t = {
          kind:             'topic',
          id:               topic.id,
          title:            topic.title ?? '',
          description:      topic.description ?? null,
          created_at:       topic.created_at ?? Math.floor(Date.now() / 1000),
          last_activity_at: null,
          active_now:       true,
          category:         topic.category ?? 'general',
          message_count:    0,
        }
        setTopics(prev => prev.some(p => String(p.id) === String(t.id)) ? prev : [...prev, t])
      })

      // Reaction updates — PHP sends "city_N" for city channels, plain eventId for events.
      socket.on('reactionUpdate', ({ channelId: ch, messageId, reactions }) => {
        const isCityMatch  = String(ch) === `city_${activeChannelRef.current}`
        const isEventMatch = ch === activeEventIdRef.current
        if (!isCityMatch && !isEventMatch) return
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m))
      })

      // DM reaction updates — update by messageId match (IDs are globally unique).
      socket.on('dmReactionUpdate', ({ messageId, reactions }) => {
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m))
      })

      // Edit / delete broadcasts — channel feed (city + event).
      socket.on('messageEdited', ({ channelId: ch, messageId, content, editedAt }) => {
        const isCityMatch  = String(ch) === `city_${activeChannelRef.current}`
        const isEventMatch = ch === activeEventIdRef.current
        if (!isCityMatch && !isEventMatch) return
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, content, editedAt: editedAt ?? Math.floor(Date.now() / 1000) } : m))
      })
      socket.on('messageDeleted', ({ channelId: ch, messageId, deletedAt }) => {
        const isCityMatch  = String(ch) === `city_${activeChannelRef.current}`
        const isEventMatch = ch === activeEventIdRef.current
        if (!isCityMatch && !isEventMatch) return
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, content: '', imageUrl: undefined, deletedAt: deletedAt ?? Math.floor(Date.now() / 1000) } : m))
      })
      // DM edit / delete — feed holds both surfaces while a DM is open; match by id.
      socket.on('dmMessageEdited', ({ messageId, content, editedAt }) => {
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, content, edited_at: editedAt ?? new Date().toISOString() } : m))
      })
      socket.on('dmMessageDeleted', ({ messageId, deletedAt }) => {
        setFeed(prev => prev.map(m => m.id === messageId ? { ...m, content: '', image_url: undefined, deleted_at: deletedAt ?? new Date().toISOString() } : m))
      })

      // Real-time reaction animations — purely visual, no stored state changed.
      socket.on('reaction', ({ type, messageId }) => {
        triggerReactionBurstRef.current?.(type, messageId)
      })

      socket.joinRoom(location.channelId, sessionIdRef.current, name, accountRef.current?.id ?? null, accountRef.current?.mode ?? 'exploring', session.guestId)

      // ── Periodic heartbeat: keeps session alive regardless of tab visibility ──
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = setInterval(() => {
        if (activeRef.current && activeChannelRef.current) {
          socketRef.current?.heartbeat(activeChannelRef.current, sessionIdRef.current)
        }
      }, 30_000)

      // ── Tab-focus refresh: one-time catch-up when returning to a hidden tab ───
      // New messages arrive via WebSocket; this only runs when the tab was hidden.
      const doRefresh = async () => {
        if (!activeRef.current) return
        const latest = await fetchMessages(location.channelId, { limit: 50 })
        if (activeChannelRef.current !== location.channelId) return // discard if switched away
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          const newItems = newMsgs.map((m) => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doRefresh

      // ── Events + Topics: fetch in background after messages are shown ────────
      // Bootstrap no longer includes events — /now fires separately so it never
      // blocks the initial chat render. hotEventsStatus was set to 'loading' above.
      const joinChannelId = location.channelId
      fetchCityChallenges(joinChannelId).then(chs => { if (activeChannelRef.current === joinChannelId) setCityChallenges(chs) }).catch(() => {})
      fetchNowFeed(joinChannelId, sessionIdRef.current).then(data => {
        if (activeChannelRef.current !== joinChannelId) return
        const nowItems = data.items ?? []
        const evs  = nowItems.filter(i => i.kind === 'event')
        const tops = nowItems.filter(i => i.kind === 'topic')
        setEvents(evs)
        setTopics(tops)
        const counts = {}
        const participated = new Set()
        evs.forEach(ev => {
          counts[ev.id] = ev.participant_count ?? 0
          if (ev.is_participating) participated.add(ev.id)
        })
        setEventParticipants(counts)
        setParticipatedEvents(participated)
        setCityEvents(data.publicEvents ?? [])
        setHotEventsStatus('ready')
      }).catch(() => setHotEventsStatus('ready'))
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
    mentions.onValueChange(e.target.value)
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
      alert(t('imageType'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert(t('imageTooLarge'))
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

  function insertEmoji(emoji) {
    const el = chatInputRef.current
    if (!el) { setInput(prev => prev + emoji); setShowEmoji(false); return }
    const start = el.selectionStart ?? input.length
    const end   = el.selectionEnd   ?? input.length
    setInput(prev => prev.slice(0, start) + emoji + prev.slice(end))
    setShowEmoji(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  async function doSendText(content) {
    if (!content || sending) return
    stopTyping()

    const currentReply = replyingTo
    setReplyingTo(null)

    // Build @mention offsets from the final text, then reset the picker state.
    const builtMentions = mentions.buildAndReset(content.trim())

    // Optimistic insert — message appears instantly without waiting for HTTP.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const optimistic = {
      type:      'message',
      id:        localId,
      localId,
      guestId:   guest?.guestId,
      nickname:  activeNickname,
      content:   content.trim(),
      createdAt: Date.now() / 1000,
      replyTo:   currentReply ?? undefined,
      mentions:  builtMentions.length ? builtMentions : undefined,
    }
    setFeed(prev => [...prev, optimistic])

    setSending(true)
    try {
      let msg
      const mArg = builtMentions.length ? builtMentions : null
      if (activeEventIdRef.current) {
        msg = await sendEventMessage(activeEventIdRef.current, guest.guestId, activeNickname, content, currentReply?.id ?? null, mArg)
      } else {
        msg = await sendMessage(channelId, sessionIdRef.current, guest.guestId, activeNickname, content, currentReply?.id ?? null, mArg)
      }

      knownIdsRef.current.add(msg.id)

      setFeed(prev => {
        if (prev.some(f => f.id === msg.id)) return prev.filter(f => f.id !== localId)
        return prev.map(f => f.id === localId ? { type: 'message', ...msg } : f)
      })

      if (!activeEventIdRef.current && !installPrompt.feedPromptSeen) {
        setTimeout(() => injectFeedInstallMessage(), 300)
      }
    } catch (err) {
      console.error('[send] failed:', err)
      setFeed(prev => prev.filter(f => f.id !== localId))
      setSendError("Couldn't send message. Please try again.")
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setSending(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content) return
    // Edit mode: dispatch to the edit endpoint and exit edit mode.
    if (editingMsg) {
      const current = editingMsg
      setEditingMsg(null)
      setInput('')
      if (content === current.content) return  // no-op when unchanged
      // Optimistic patch — server WS broadcast will reconcile.
      const stamp = current.surface === 'dm' ? new Date().toISOString() : Math.floor(Date.now() / 1000)
      const key = current.surface === 'dm' ? 'edited_at' : 'editedAt'
      setFeed(prev => prev.map(m => m.id === current.id ? { ...m, content, [key]: stamp } : m))
      try {
        if (current.surface === 'dm') {
          await editDmMessage(current.id, content)
        } else {
          await editChannelMessage(current.id, content, guest?.guestId)
        }
      } catch (err) {
        console.error('[edit] failed:', err)
        setFeed(prev => prev.map(m => m.id === current.id ? { ...m, content: current.content, [key]: undefined } : m))
        setSendError(t('editFailed', { ns: 'chat', defaultValue: "Couldn't save edit. Please try again." }))
        setTimeout(() => setSendError(null), 4000)
      }
      return
    }
    setInput('')
    await doSendText(content)
  }

  // Tombstone a message (optimistic + rollback). `surface` selects channel vs DM endpoint.
  async function deleteMessageAction(msg, surface) {
    const confirmed = window.confirm(t('deleteConfirmBody', { ns: 'chat', defaultValue: 'Delete this message? It will be removed for everyone.' }))
    if (!confirmed) return
    const key = surface === 'dm' ? 'deleted_at' : 'deletedAt'
    const stamp = surface === 'dm' ? new Date().toISOString() : Math.floor(Date.now() / 1000)
    const prevContent = msg.content
    const prevImageUrl = surface === 'dm' ? msg.image_url : msg.imageUrl
    setFeed(prev => prev.map(m => m.id === msg.id
      ? (surface === 'dm'
          ? { ...m, content: '', image_url: undefined, [key]: stamp }
          : { ...m, content: '', imageUrl: undefined, [key]: stamp })
      : m))
    try {
      if (surface === 'dm') await deleteDmMessage(msg.id)
      else                  await deleteChannelMessage(msg.id, guest?.guestId)
    } catch (err) {
      console.error('[delete] failed:', err)
      setFeed(prev => prev.map(m => m.id === msg.id
        ? (surface === 'dm'
            ? { ...m, content: prevContent, image_url: prevImageUrl, [key]: undefined }
            : { ...m, content: prevContent, imageUrl: prevImageUrl, [key]: undefined })
        : m))
      setSendError(t('deleteFailed', { ns: 'chat', defaultValue: "Couldn't delete message. Please try again." }))
      setTimeout(() => setSendError(null), 4000)
    }
  }

  async function handleMySpot() {
    setShowShareSheet(false)
    setSpotLoading(true)
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      )
      setLocationPickerCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    } catch (err) {
      console.error('[spot]', err)
      setSendError("Couldn't get your location. Please enable location access and try again.")
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setSpotLoading(false)
    }
  }

  async function handleLocationConfirm({ place, address, lat, lng }) {
    setLocationPickerCoords(null)
    const label = place || 'somewhere'
    const coordLine = `${lat.toFixed(6)},${lng.toFixed(6)}`
    const text = address
      ? `📍 ${activeNickname} is at ${label}\n${coordLine}\n${address}`
      : `📍 ${activeNickname} is at ${label}\n${coordLine}`
    await doSendText(text)
  }

  async function loadChannels(sort) {
    setChannelsLoading(true)
    try {
      const data = await fetchChannels(sort)
      setChannels(data.channels ?? [])
    } finally {
      setChannelsLoading(false)
    }
  }

  async function openCityPicker() {
    setShowCityPicker(true)
    setCitySearchQuery('')
    loadChannels(cityFilter)
  }

  // "My city" bottom-tab handler — closes every drawer so the City Channel
  // (the implicit default render) becomes visible.
  // Dismiss anything rendered as a .full-page overlay (z-index: 200) so the
  // bottom-nav tabs actually swap screens instead of staying buried under
  // a stuck Topic/Challenge/Create page. Called from every goTo* handler.
  function dismissFullPageOverlays() {
    setActiveTopic(null)
    setActiveChallenge(null)
    setShowCreateChallenge(false)
    setEditChallengeObj(null)
    setShowCreateEvent(false)
    setShowCreateTopic(false)
    setShowCreateChooser(false)
  }

  function goToCityChannel() {
    setShowCityPicker(false)
    setShowEventDrawer(false)
    setShowPeopleDrawer(false)
    setShowProfileDrawer(false)
    setShowConversations(false)
    setShowNotifications(false)
    setViewingProfile(null)
    dismissFullPageOverlays()
  }

  // Bottom-tab handlers for NOW / HERE / ME — each clears every other
  // top-level flag before setting its own. Without this, tapping e.g. NOW
  // then HERE leaves both drawer flags true and closing the top one reveals
  // the one underneath instead of returning to the City Channel.
  function goToNowTab() {
    setShowCityPicker(false)
    setShowPeopleDrawer(false)
    setShowProfileDrawer(false)
    setShowConversations(false)
    setShowNotifications(false)
    setViewingProfile(null)
    dismissFullPageOverlays()
    setShowEventDrawer(true)
  }
  function goToHereTab() {
    setShowCityPicker(false)
    setShowEventDrawer(false)
    setShowProfileDrawer(false)
    setShowConversations(false)
    setShowNotifications(false)
    setViewingProfile(null)
    dismissFullPageOverlays()
    setShowPeopleDrawer(true)
  }
  function goToMeTab() {
    setShowCityPicker(false)
    setShowEventDrawer(false)
    setShowPeopleDrawer(false)
    setShowConversations(false)
    setShowNotifications(false)
    setViewingProfile(null)
    setProfileNickInput(activeNickname)
    dismissFullPageOverlays()
    setShowProfileDrawer(true)
  }

  function changeCityFilter(f) {
    setCityFilter(f)
    loadChannels(f)
  }

  // ── Shared app header ──────────────────────────────────────────────────────
  // Persistent across all 4 tabs (mobile viewport) so Notifications + Messages
  // stay one tap away from any screen. Share is MY-CITY-only and passed in via
  // withShare so it renders left of the DM icon on the home tab.
  function renderAppHeader({ withShare = false } = {}) {
    return (
      <div className="header-top-bar">
        <div className="header-top-left">
          {account ? (
            <button
              className={`header-icon-btn header-icon-btn--sm${notifUnreadCount > 0 ? ' header-icon-btn--unread' : ''}`}
              onClick={() => setShowNotifications(true)}
              aria-label="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notifUnreadCount > 0 && (
                <span className="header-icon-badge">
                  {notifUnreadCount > 9 ? '9+' : notifUnreadCount}
                </span>
              )}
            </button>
          ) : (
            // Guests get a subtle "?" to re-open the intro carousel on demand.
            <button
              className="header-icon-btn header-icon-btn--sm"
              onClick={() => setShowOnboarding(true)}
              aria-label="How Hilads works"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
          )}
        </div>
        <div className="header-top-center">
          <Logo variant="icon" size="md" />
          <span className="header-tagline">Challenge<br />the city.</span>
        </div>
        <div className="header-top-right">
          {withShare && city && (
            <button
              className="header-icon-btn header-icon-btn--sm"
              onClick={() => share(composeCityShare(city))}
              aria-label="Share city"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </button>
          )}
          {account && (
            <button
              className={`header-icon-btn header-icon-btn--sm${hasAnyUnread ? ' header-icon-btn--unread' : ''}`}
              onClick={() => setShowConversations(true)}
              aria-label="Messages"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {hasAnyUnread && <span className="header-icon-badge header-icon-badge--dot" />}
            </button>
          )}
        </div>
      </div>
    )
  }

  async function openObCityPicker() {
    setObPickingCity(true)
    setCitySearchQuery('')
    setObChannelsLoading(true)
    try {
      const data = await fetchChannels()
      setObChannels(data.channels)
    } catch {
      setObChannels([])
    } finally {
      setObChannelsLoading(false)
    }
  }

  function joinCityFromOb(newChannelId, cityName, timezone, country) {
    setObPickingCity(false)
    setCity(cityName)
    setCityCountry(country ?? null)
    setPreviewChannelId(newChannelId)
    setPreviewTimezone(timezone ?? 'UTC')
    locPromiseRef.current = Promise.resolve({ channelId: newChannelId, city: cityName, timezone: timezone ?? 'UTC', country: country ?? null })
    handleJoin(null)
  }

  function retryGeo() {
    setGeoState('pending')
    locPromiseRef.current = startGeolocation()
  }

  async function switchCity(newChannelId, newCityName, newCityTimezone, newCityCountry, opts = {}) {
    if (newChannelId === channelId) {
      setShowCityPicker(false)
      return
    }
    setShowCityPicker(false)
    setCityCountry(newCityCountry ?? null)

    // Commit the manual switch on the backend (registered users only —
    // guests have no users row). Fire-and-forget.
    if (account) setCurrentCity(newChannelId)

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
    knownIdsRef.current      = new Set()
    cityFeedCacheRef.current     = []
    cityKnownIdsCacheRef.current = new Set()
    cityMsgBufferRef.current     = []
    setCity(newCityName)
    setChannelId(newChannelId)
    saveIdentity(activeNickname, newChannelId, newCityName, newCityTimezone ?? null)
    setCityTimezone(newCityTimezone ?? 'UTC')
    setEvents([])
    setCityEvents([])
    setTopics([])
    setHotEventsStatus('loading')
    setActiveEventId(null)
    if (!opts.fromPop) pushUrl(`/city/${cityToSlug(newCityName)}`)
    setPageMeta(
      i18n.t('meta.cityTitle', { ns: 'common', city: localizeCityName(newCityName) }),
      i18n.t('meta.cityDesc',  { ns: 'common', city: localizeCityName(newCityName) }),
    )
    setActiveEvent(null)
    activeEventIdRef.current = null

    try {
      // Reset pagination state for the new channel
      hasMoreMessagesRef.current = false
      setHasMoreMessages(false)
      oldestMessageIdRef.current = null

      // Parallel fetch: join + lean messages fire concurrently
      const [switchJoinData, switchMsgsData] = await Promise.all([
        joinChannel(newChannelId, sessionIdRef.current, guest.guestId, activeNickname, channelId),
        fetchLeanMessages(newChannelId, { limit: 50 }),
      ])
      const boot = {
        joinMessage: switchJoinData.message ?? null,
        messages:    switchMsgsData.messages ?? [],
        hasMore:     switchMsgsData.hasMore  ?? false,
        onlineCount: null, // WS presenceSnapshot restores this after socket room join
      }

      // another switch happened while we were loading — discard
      if (activeChannelRef.current !== newChannelId) return

      // boot.joinMessage is null for re-joins within presence TTL — handle gracefully
      const joinKey = boot.joinMessage ? messageKey(boot.joinMessage) : null

      knownIdsRef.current = new Set(boot.messages.map(messageKey).filter(Boolean))
      const total = boot.messages.length
      const initialItems = dedupeWeather(boot.messages.map((m, idx) => {
        const staggerIndex = Math.max(0, idx - (total - 8))
        const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
        return toFeedItem(m, delay)
      }))
      setFeed(initialItems)

      // Set pagination cursor: oldest message that HAS an id (skip id-less system messages)
      const switchMore = boot.hasMore ?? false
      hasMoreMessagesRef.current = switchMore
      setHasMoreMessages(switchMore)
      if (switchMore) oldestMessageIdRef.current = boot.messages.find(m => m.id)?.id ?? null
      setOnlineUsers([{ id: 'me', sessionId: sessionIdRef.current, nickname: activeNickname, isMe: true }])
      setOnlineCount(boot.onlineCount ?? null)
      if (joinKey) scheduleEphemeral(joinKey)
      injectWelcomeCard(newChannelId, newCityName)

      // Deferred badge enrichment — same pattern as handleJoin
      const switchBadgeIds = [...new Set(
        boot.messages
          .filter(m => (m.type === 'text' || m.type === 'image') && m.userId)
          .map(m => m.userId)
      )]
      if (switchBadgeIds.length > 0) {
        fetchMessageBadges(newChannelId, switchBadgeIds).then(badges => {
          if (activeChannelRef.current !== newChannelId) return
          if (!badges || Object.keys(badges).length === 0) return
          setFeed(prev => prev.map(item => {
            if (item.type !== 'message' || !item.userId || !badges[item.userId]) return item
            const b = badges[item.userId]
            return { ...item, primaryBadge: b.primaryBadge, contextBadge: b.contextBadge, vibe: b.vibe ?? null, mode: b.mode ?? null }
          }))
        })
      }

      activeRef.current = true
      scheduleActivity(true)
      promptsShownRef.current = new Set()
      schedulePrompts()

      // Socket: join new room — existing handlers (set up in handleJoin) remain active
      socketRef.current?.joinRoom(newChannelId, sessionIdRef.current, activeNickname, accountRef.current?.id ?? null, accountRef.current?.mode ?? 'exploring', guestIdRef.current)

      // Restart heartbeat for the new room (same policy — no !document.hidden)
      heartbeatRef.current = setInterval(() => {
        if (activeRef.current && activeChannelRef.current) {
          socketRef.current?.heartbeat(activeChannelRef.current, sessionIdRef.current)
        }
      }, 30_000)

      // Tab-focus refresh only — new messages arrive via WebSocket
      const doRefresh = async () => {
        if (!activeRef.current) return
        const latest = await fetchMessages(newChannelId, { limit: 50 })
        if (activeChannelRef.current !== newChannelId) return // discard if switched away again
        const newMsgs = latest.messages.filter((m) => !knownIdsRef.current.has(messageKey(m)))
        if (newMsgs.length > 0) {
          newMsgs.forEach((m) => knownIdsRef.current.add(messageKey(m)))
          const newItems = newMsgs.map((m) => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
          setFeed((prev) => [...prev, ...newItems])
          newItems.forEach((item) => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
        }
      }
      pollFnRef.current = doRefresh

      // Events + Topics: fetch in background after messages are shown
      fetchCityChallenges(newChannelId).then(chs => { if (activeChannelRef.current === newChannelId) setCityChallenges(chs) }).catch(() => {})
      fetchNowFeed(newChannelId, sessionIdRef.current).then(data => {
        if (activeChannelRef.current !== newChannelId) return
        const nowItems = data.items ?? []
        const evs  = nowItems.filter(i => i.kind === 'event')
        const tops = nowItems.filter(i => i.kind === 'topic')
        setEvents(evs)
        setTopics(tops)
        const counts = {}
        const participated = new Set()
        evs.forEach(ev => {
          counts[ev.id] = ev.participant_count ?? 0
          if (ev.is_participating) participated.add(ev.id)
        })
        setEventParticipants(counts)
        setParticipatedEvents(participated)
        setCityEvents(data.publicEvents ?? [])
        setHotEventsStatus('ready')
      }).catch(() => setHotEventsStatus('ready'))
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

    // Save city feed + known IDs before entering event mode.
    // Restored by handleBackToCity so we don't need a GET /messages round-trip on return.
    if (!activeEventIdRef.current) {
      // Only cache when coming from city (not switching between events)
      cityFeedCacheRef.current     = feed
      cityKnownIdsCacheRef.current = new Set(knownIdsRef.current)
      // Snapshot the city reverse-scroll cursor too — the event reuses these
      // shared refs, so we restore them in handleBackToCity to keep city
      // pagination intact after returning.
      cityCursorCacheRef.current   = { oldestId: oldestMessageIdRef.current, hasMore: hasMoreMessagesRef.current }
      cityMsgBufferRef.current     = [] // clear buffer for this event session
    }

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
    // Reset reverse-scroll cursors for this event; set on the first load below.
    oldestMessageIdRef.current = null
    hasMoreMessagesRef.current = false
    setHasMoreMessages(false)
    pushUrl(`/event/${eventSlug(event)}`)
    setPageMeta(
      i18n.t('meta.eventTitle', { ns: 'common', title: event.title }),
      i18n.t('meta.eventDesc',  { ns: 'common', title: event.title }),
    )

    // Initial fetch for event messages; subsequent messages arrive via WebSocket.
    // doRefresh doubles as the poll fn — only the FIRST load (cursor still null)
    // seeds the pagination cursor + hasMore; later polls just append new ones.
    const doRefresh = async () => {
      if (!activeRef.current) return
      const isInitial = oldestMessageIdRef.current === null
      const latest = await fetchEventMessages(eid, { limit: 50 }).catch(() => null)
      if (!latest || activeEventIdRef.current !== eid) return
      const newMsgs = latest.messages.filter(m => !knownIdsRef.current.has(m.id))
      if (newMsgs.length > 0) {
        newMsgs.forEach(m => knownIdsRef.current.add(m.id))
        const items = newMsgs.map(m => toFeedItem(m)).filter(Boolean)
        setFeed(prev => [...prev, ...items])
      }
      if (isInitial && latest.messages.length > 0) {
        oldestMessageIdRef.current = latest.messages.find(m => m.id)?.id ?? null // skip id-less system messages
        hasMoreMessagesRef.current = latest.hasMore ?? false
        setHasMoreMessages(latest.hasMore ?? false)
      }
    }

    doRefresh()
    pollFnRef.current = doRefresh
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

  // Members list opened by tapping the avatar row on a NOW card (event or hangout).
  async function openMembersList(item, kind) {
    setShowGoingModal(true)
    setGoingListLoading(true)
    setGoingList([])
    setMembersNoun(kind === 'topic' ? 'in this hangout' : 'going')
    try {
      const data = kind === 'topic'
        ? await fetchHangoutParticipants(item.id)
        : await fetchEventGoingList(item.id)
      setGoingList(data.participants ?? [])
    } catch { /* silent */ }
    finally { setGoingListLoading(false) }
  }

  // Open a hangout by id (used when the create-limit panel links to the existing one).
  async function goToHangoutById(topicId) {
    setShowCreateTopic(false)
    try {
      const data = await fetchTopicById(topicId)
      const topic = data.topic ?? data
      if (topic) setActiveTopic(topic)
    } catch { /* silent */ }
  }

  async function handleOpenGoingModal() {
    if (!activeEvent) return
    setShowGoingModal(true)
    setMembersNoun('going')
    setGoingListLoading(true)
    setGoingList([])
    try {
      const data = await fetchEventGoingList(activeEvent.id)
      setGoingList(data.participants ?? [])
    } catch { /* silent */ }
    finally { setGoingListLoading(false) }
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
    if (city) {
      pushUrl(`/city/${cityToSlug(city)}`)
      setPageMeta(
        i18n.t('meta.cityTitle', { ns: 'common', city: localizeCityName(city) }),
        i18n.t('meta.cityDesc',  { ns: 'common', city: localizeCityName(city) }),
      )
    }

    // Restore the city feed snapshot cached when entering event mode.
    // Also replay any city WS messages that were buffered during event mode
    // (the newMessage handler buffers them instead of discarding while in event mode).
    // This gives instant UX continuity with no GET /messages call.
    const cachedFeed   = cityFeedCacheRef.current
    const cachedIds    = cityKnownIdsCacheRef.current
    const buffered     = cityMsgBufferRef.current
    if (cachedFeed.length > 0) {
      // Restore snapshot
      knownIdsRef.current = cachedIds
      // Replay buffered city messages that arrived during event mode
      const bufferedNew = buffered.filter(m => {
        const k = messageKey(m)
        if (!k || knownIdsRef.current.has(k)) return false
        knownIdsRef.current.add(k)
        return true
      })
      const restoredFeed = bufferedNew.length > 0
        ? [...cachedFeed, ...bufferedNew.map(m => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)]
        : cachedFeed
      setFeed(restoredFeed)
      // Restore the city reverse-scroll cursor snapshotted on event entry
      // (the event overwrote these shared refs).
      oldestMessageIdRef.current = cityCursorCacheRef.current.oldestId
      hasMoreMessagesRef.current = cityCursorCacheRef.current.hasMore
      setHasMoreMessages(cityCursorCacheRef.current.hasMore)
    } else {
      // No cache (e.g. user entered event before city feed loaded) — fetch fresh.
      knownIdsRef.current = new Set()
      setFeed([])
      oldestMessageIdRef.current = null
      hasMoreMessagesRef.current = false
      setHasMoreMessages(false)
      fetchMessages(cid, { limit: 50 }).then(data => {
        if (activeEventIdRef.current !== null || activeChannelRef.current !== cid) return
        knownIdsRef.current = new Set(data.messages.map(messageKey))
        const total = data.messages.length
        setFeed(dedupeWeather(data.messages.map((m, idx) => {
          const staggerIndex = Math.max(0, idx - (total - 8))
          const delay = staggerIndex > 0 ? `${staggerIndex * 45}ms` : undefined
          return toFeedItem(m, delay)
        })))
        oldestMessageIdRef.current = data.messages[0]?.id ?? null
        hasMoreMessagesRef.current = data.hasMore ?? false
        setHasMoreMessages(data.hasMore ?? false)
      }).catch(() => {})
    }

    // Clear cache + buffer so they don't persist across city switches
    cityFeedCacheRef.current     = []
    cityKnownIdsCacheRef.current = new Set()
    cityMsgBufferRef.current     = []

    // Tab-focus refresh only — new messages arrive via WebSocket
    const doRefresh = async () => {
      if (!activeRef.current) return
      const latest = await fetchMessages(cid, { limit: 50 })
      if (activeChannelRef.current !== cid || activeEventIdRef.current !== null) return
      const newMsgs = latest.messages.filter(m => !knownIdsRef.current.has(messageKey(m)))
      if (newMsgs.length > 0) {
        newMsgs.forEach(m => knownIdsRef.current.add(messageKey(m)))
        const items = newMsgs.map(m => toFeedItem(m, undefined, lastJoinAtRef)).filter(Boolean)
        setFeed(prev => [...prev, ...items])
        items.forEach(item => { if (item.subtype === 'join') scheduleEphemeral(item.id) })
      }
    }

    pollFnRef.current = doRefresh
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
    setSuccessToast({ msg: t('toast.eventDeleted') })
    setTimeout(() => setSuccessToast(null), 3000)
  }

  // Guard: only registered users can create events
  // Legacy name kept so existing callers don't need to change — now just
  // delegates to tryOpenCreateEvent so every entry point gets the preflight.
  function openCreateEvent() {
    tryOpenCreateEvent()
  }

  // Preflights the 1-event-per-day rule before opening the form. On limit
  // hit → show the friendly limit screen. On network error → optimistically
  // open the form (server enforces on POST and surfaces the same screen).
  //
  // `fromDrawer` = true closes the NOW drawer on open and records that the
  // user came from there (so creation can return them to it via
  // `createFromDrawer`).
  async function tryOpenCreateEvent({ fromDrawer = false } = {}) {
    if (!account) {
      setGuestGate({ reason: 'create_event' })
      return
    }
    try {
      const r = await fetchCanCreateEvent(channelId, guest?.guestId)
      if (!r.canCreate) {
        if (fromDrawer) setShowEventDrawer(false)
        setShowEventLimitReached(true)
        return
      }
    } catch {
      // Fall through — optimistic open.
    }
    if (fromDrawer) {
      setShowEventDrawer(false)
      setCreateFromDrawer(true)
    }
    setShowCreateEvent(true)
  }

  function handleTopicCreated(topic) {
    setShowCreateTopic(false)
    if (!topic?.id) return
    // Idempotent: the WS `newTopic` echo of our own creation can land before or
    // after this, so drop any existing copy by id before prepending the fresh one.
    setTopics(prev => [
      { ...topic, message_count: 0, last_activity_at: null, kind: 'topic' },
      ...prev.filter(p => String(p.id) !== String(topic.id)),
    ])
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
    fetchCityChallenges(cid).then(chs => { if (activeChannelRef.current === cid) setCityChallenges(chs) }).catch(() => {})
    fetchNowFeed(cid, sessionIdRef.current).then(data => {
      if (activeChannelRef.current === cid) {
        const nowItems = data.items ?? []
        const evs  = nowItems.filter(i => i.kind === 'event')
        const tops = nowItems.filter(i => i.kind === 'topic')
        setEvents(evs)
        setTopics(tops)
        setHotEventsStatus('ready')
        const counts = {}
        evs.forEach(ev => { counts[ev.id] = ev.participant_count ?? 0 })
        setEventParticipants(prev => ({ ...prev, ...counts }))
      }
    }).catch(() => {})
  }

  const typingLabel = typingText(typingUsers, sessionIdRef.current, t)

  // City composer placeholder — translated list, picked deterministically by channel.
  const cityPlaceholderList = t('placeholders', { returnObjects: true })
  const cityComposerPlaceholder = Array.isArray(cityPlaceholderList) && cityPlaceholderList.length > 0
    ? cityPlaceholderList[channelId % cityPlaceholderList.length]
    : ''

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
          return [...prev, { type: 'event', id, eventId: event.id, title: event.title, text: `🎉 New event: ${event.title}`, cta: 'Join' }]
        })
      })
    }
    prevEventCountRef.current = events.length
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  // Inject a new-challenge pill when cityChallenges grows (real-time defi
  // added). Mirrors the events injection above — only in city chat (not
  // when an event is open), dedup via prev.some, stays in feed permanently
  // like a normal message. Audience picks the locale-aware verb template.
  useEffect(() => {
    if (!activeRef.current || activeEventIdRef.current) {
      prevChallengeCountRef.current = cityChallenges.length
      return
    }
    if (cityChallenges.length > prevChallengeCountRef.current) {
      // Cap the chat-feed challenge prompts at the 5 newest — older
      // challenges still live in the NOW feed and the Challenges filter
      // (paginated). Without this cap a freshly-rebuilt feed would inject
      // every challenge ever created in the city.
      const newest = cityChallenges.slice(0, 5)
      newest.forEach(ch => {
        const id = `challenge-msg-${ch.id}`
        setFeed(prev => {
          if (prev.some(f => f.id === id)) return prev
          return [...prev, {
            type:        'challenge',
            id,
            challengeId: ch.id,
            title:       ch.title,
            nickname:    ch.nickname,
            audience:    ch.audience,
          }]
        })
      })
    }
    prevChallengeCountRef.current = cityChallenges.length
  }, [cityChallenges]) // eslint-disable-line react-hooks/exhaustive-deps

  // Inject active topics into city feed when topics load or a new topic appears.
  // Uses same dedup guard as events (prev.some). Topics sorted by activity DESC —
  // reverse so most-active topic ends up at the bottom (newest position).
  useEffect(() => {
    if (!activeRef.current || activeEventIdRef.current) return
    ;[...topics].reverse().forEach(topic => {
      const id = `topic-msg-${topic.id}`
      setFeed(prev => {
        if (prev.some(f => f.id === id)) return prev
        return [...prev, { type: 'topic', id, topicId: topic.id }]
      })
    })
  }, [topics]) // eslint-disable-line react-hooks/exhaustive-deps

  function cityScore(ch) {
    return ((ch.eventCount ?? 0) * 10) + ((ch.topicCount ?? 0) * 5) + (ch.activeUsers * 3) + (ch.messageCount * 1)
  }

  // ── Shared city row renderer ────────────────────────────────────────────────

  function renderCityRow(ch, onClick, isActive = false) {
    const hasActivity = ch.activeUsers > 0
    const eventCount = ch.eventCount ?? 0
    const topicCount = ch.topicCount ?? 0
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
            <span className="city-row-name">{localizeCityName(ch.city)}</span>
          </div>
          {isActive && <span className="city-row-current">{t('picker.youreHere')}</span>}
        </div>
        <div className="city-row-stats">
          {ch.activeUsers > 0 && <span className="city-row-users">{t('picker.online', { count: ch.activeUsers })}</span>}
          {eventCount > 0 && <span className="city-row-events">{t('picker.events', { count: eventCount })}</span>}
          {topicCount > 0 && <span className="city-row-topics">{t('picker.hangout', { count: topicCount })}</span>}
          {ch.messageCount > 0 && <span className="city-row-count">{t('picker.msgs', { count: ch.messageCount })}</span>}
        </div>
      </button>
    )
  }

  // ── Global overlays (shown regardless of app status) ──────────────────────

  if (window.location.pathname === '/delete-account') {
    return <DeleteAccountPage />
  }

  if (resetPasswordToken !== null) {
    return (
      <ResetPasswordScreen
        token={resetPasswordToken}
        onSuccess={(user) => {
          if (user) {
            localStorage.setItem(AUTH_FLAG_KEY, '1')
            accountRef.current = user
            setAccount(user)
            identifyUser(user.id, { account_type: 'registered', username: user.display_name })
            setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null })
            track('user_authenticated')
          }
          setResetPasswordToken(null)
          window.history.replaceState(null, '', '/')
        }}
        onRequestNew={() => {
          setResetPasswordToken(null)
          window.history.replaceState(null, '', '/')
          setShowForgotPassword(true)
        }}
      />
    )
  }

  // ── Rehydrating (auth session check in progress) ───────────────────────────

  if (rehydrating && status === 'onboarding') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#111' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #333', borderTopColor: '#f60', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  if (status === 'onboarding') {
    if (showForgotPassword) {
      return (
        <ForgotPasswordScreen
          onBack={() => { setShowForgotPassword(false); setObShowAuth(true); setObAuthInitialTab('login') }}
        />
      )
    }

    if (obShowAuth) {
      return (
        <AuthScreen
          guestId={guest?.guestId ?? loadGuestId() ?? undefined}
          guestNickname={nickname}
          initialTab={obAuthInitialTab}
          onSuccess={(user, isSignup) => {
            localStorage.setItem(AUTH_FLAG_KEY, '1') // skip useless authMe() 401 on next boot
            accountRef.current = user // sync ref before handleJoin reads it
            setAccount(user)
            setObShowAuth(false)
            if (isSignup) setShowAccountWelcome(true)
            identifyUser(user.id, { account_type: 'registered', username: user.display_name })
            setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null })
            track('user_authenticated')
            handleJoin(null)
          }}
          onBack={() => setObShowAuth(false)}
          onForgotPassword={() => { setObShowAuth(false); setShowForgotPassword(true) }}
        />
      )
    }

    return (
      <>
        <LandingPage
          city={city}
          cityCountry={cityCountry}
          geoState={geoState}
          nickname={nickname}
          setNickname={setNickname}
          handleJoin={handleJoin}
          previewLiveCount={previewLiveCount}
          previewEventCount={previewEventCount}
          previewTopicCount={previewTopicCount}
          previewChallengeCount={previewChallengeCount}
          previewChallenges={previewChallenges}
          previewTopics={previewTopics}
          previewEvents={previewEvents}
          previewTimezone={previewTimezone}
          onSignUp={() => { setObAuthInitialTab('signup'); setObShowAuth(true) }}
          onSignIn={() => { setObAuthInitialTab('login');  setObShowAuth(true) }}
          onOpenCityPicker={openObCityPicker}
          retryGeo={retryGeo}
        />

        {obPickingCity && (
          <div className="full-page">
            <div className="page-header">
              <BackButton onClick={() => setObPickingCity(false)} />
              <span className="page-title">{t('picker.title')}</span>
            </div>
            <div className="city-search-wrap">
              <input
                className="city-search-input"
                type="search"
                placeholder={t('picker.search')}
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
                  .sort((a, b) => cityScore(b) - cityScore(a) || a.city.localeCompare(b.city))
                if (sorted.length === 0) return <div className="city-no-results">{t('picker.noResults', { query: citySearchQuery })}</div>
                if (q) {
                  return sorted.map(ch => renderCityRow(
                    ch,
                    (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country),
                    false
                  ))
                }
                const active = [...obChannels]
                  .filter(ch => cityScore(ch) > 0)
                  .sort((a, b) => cityScore(b) - cityScore(a) || a.city.localeCompare(b.city))
                const fillerIds = new Set(active.map(ch => ch.channelId))
                const filler = [...obChannels]
                  .filter(ch => !fillerIds.has(ch.channelId))
                  .sort((a, b) => a.channelId - b.channelId)
                const top10 = [...active, ...filler].slice(0, 10)
                const label = active.length > 0 ? t('picker.topCities') : t('picker.cities')
                return (
                  <>
                    <div className="city-list-label">{label}</div>
                    {top10.map(ch => renderCityRow(
                      ch,
                      (ch) => joinCityFromOb(ch.channelId, ch.city, ch.timezone, ch.country),
                      false
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Joining (transition) ───────────────────────────────────────────────────

  if (status === 'joining') {
    return (
      <div className="screen center">
        <div className="loading-spinner" />
        <p className="loading-text">{city ? t('joining', { city }) : t('joiningDefault')}</p>
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
          {t('tryAgain')}
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
        <div className="header-hero-brand">
          <Logo variant="icon" size="lg" />
          <span className="header-tagline">Challenge<br />the city.</span>
        </div>
        <div className="header-hero-city">
          <div className="header-city-line">
            <span className="header-city-name">
              <span className="header-city-flag" aria-hidden="true">{cityFlag(cityCountry)}</span>
              <span>{localizeCityName(city)}</span>
            </span>
            <span className="header-city-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className="header-city-online"
              onClick={() => { setShowPeopleDrawer(true); setViewingProfile(null) }}
              aria-label={t('header.seeWhosHere')}
            >
              <span className="online-pulse" />
              {onlineCount != null ? t('header.online', { count: onlineCount }) : t('header.liveNow')}
            </button>
          </div>
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

      {/* Android Play Store promo — renders only on Android non-installed visitors */}
      <AppPromoBanner />
      <AppPromoInterstitial />

      {/* Events sidebar — desktop only */}
      <EventsSidebar
        events={events}
        cityEvents={cityEvents}
        topics={topics}
        activeEventId={activeEventId}
        cityTimezone={cityTimezone}
        eventPresence={eventPresence}
        eventParticipants={eventParticipants}
        onSelectEvent={handleSelectEvent}
        onSelectTopic={topic => openHangout(topic)}
        activeTopicId={activeTopic?.id}
        onCreateClick={() => setShowCreateChooser(true)}
      />

      <div className="screen chat">
        <header className="chat-header">
          {activeEvent ? (
            /* Event mode */
            <div className={`event-header${eventHeaderCollapsed ? ' event-header--collapsed' : ''}`}>
              <div className="event-header-top">
                <BackButton onClick={handleBackToCity} className="event-back-btn" ariaLabel={`Back to ${city}`} />
                <div className="event-header-actions">
                  <ShareVibeBtn
                    eventId={activeEvent.id}
                    title={activeEvent.title}
                    city={city}
                  />
                  {/* Edit entry point moved to title row for better visibility */}
                  {account && (
                    <button
                      className={`header-icon-btn${notifUnreadCount > 0 ? ' header-icon-btn--unread' : ''}`}
                      onClick={() => setShowNotifications(true)}
                      title={t('header.notifications')}
                      aria-label={t('header.notifications')}
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
                      title={t('header.messages')}
                      aria-label={t('header.messages')}
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
                  <span className="event-creator-badge">👑 {t('eventHeader.yourEvent')}</span>
                )}
                <div className="event-header-title-row">
                  <h1 className="event-header-title" title={activeEvent.title}>{activeEvent.title}</h1>
                  {isMyEvent ? (
                    <button
                      className={`event-join-btn event-join-btn--edit${showEditPulse ? ' event-join-btn--pulse' : ''}`}
                      onClick={() => setShowEditEvent(true)}
                      onAnimationEnd={() => setShowEditPulse(false)}
                    >
                      ✏️ {t('eventHeader.edit')}
                    </button>
                  ) : (
                    <button
                      className={`event-join-btn${participatedEvents.has(activeEvent.id) ? ' event-join-btn--active' : ''}`}
                      onClick={() => handleToggleParticipation(activeEvent.id)}
                    >
                      {participatedEvents.has(activeEvent.id) ? t('eventHeader.joined') : t('eventHeader.join')}
                    </button>
                  )}
                </div>
                <span className="event-meta-label">
                  {getTimeLabel(activeEvent.starts_at, cityTimezone || 'UTC', { withDate: !(activeEvent.recurrence_label || activeEvent.series_id) })}
                  {activeEvent.ends_at ? ` → ${formatTime(activeEvent.ends_at, cityTimezone || 'UTC')}` : ''}
                  {` · ${t('eventHeader.here', { count: eventPresence[activeEvent.id] ?? 0 })} · `}
                  <button className="going-count-btn" onClick={handleOpenGoingModal}>
                    {t('eventHeader.going', { count: eventParticipants[activeEvent.id] ?? 0 })}
                  </button>
                </span>
                {(() => {
                  const loc = getEventLocation(activeEvent)
                  const url = getEventMapsUrl(activeEvent)
                  if (url) return (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="event-location">
                      📍 {loc}
                    </a>
                  )
                  return <span className="event-location event-location--muted">📍 {loc ?? t('eventHeader.locationPending')}</span>
                })()}
                {activeEvent.host_nickname && !isMyEvent && (
                  <span className="event-host">{t('eventHeader.hostedBy', { name: activeEvent.host_nickname })}</span>
                )}
              </div>
            </div>
          ) : (
            /* City mode */
            <>
              {/* ── Desktop layout — unchanged, hidden on mobile ── */}
              <div className="header-desktop-layout">
                <div className="header-desktop-zone header-desktop-zone--left">
                  <div className="header-desktop-left">
                    <button className="change-city-btn" onClick={openCityPicker} title={t('header.switchCity')}>
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
                          title={t('header.notifications')}
                          aria-label={t('header.notifications')}
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
                          onClick={() => share(composeCityShare(city))}
                          title={t('header.shareCity')}
                          aria-label={t('header.shareCity')}
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
                          title={t('header.messages')}
                          aria-label={t('header.messages')}
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

              {/* ── Mobile layout — new 3-section design, hidden on desktop ── */}
              <div className="header-new">

                {/* Section 1: shared app header (Share is MY-CITY-only) */}
                {renderAppHeader({ withShare: true })}

                {/* Section 2: city hero name — tappable → switch city */}
                {city && (
                  <button
                    type="button"
                    className="header-city-row header-city-row-button"
                    onClick={openCityPicker}
                    aria-label={t('header.changeCity')}
                  >
                    <span aria-hidden="true">{cityFlag(cityCountry)}</span>{' '}{localizeCityName(city)}
                    <svg
                      className="header-city-row-chevron"
                      width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}

                {/* Section 3: context chips */}
                <div className="header-chips">
                  {weatherLabel && (
                    <button
                      className="header-chip header-chip--weather"
                      onClick={() => { /* TODO: open weather detail view */ }}
                      aria-label={t('header.currentWeather', { label: weatherLabel })}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                      </svg>
                      <Marquee text={weatherLabel} className="header-weather-marquee" fadeColor="#1a1a1a" />
                    </button>
                  )}
                  <button
                    className="header-chip header-chip--online"
                    onClick={() => { setShowPeopleDrawer(true); setViewingProfile(null); }}
                    aria-label={t('header.onlineAria', { count: onlineCount ?? 0 })}
                  >
                    <span className="chip-live-dot" aria-hidden="true" />
                    {onlineCount != null ? t('header.online', { count: onlineCount }) : t('header.liveNow')}
                  </button>
                </div>

              </div>
            </>
          )}
        </header>

        <div className="messages" ref={messagesContainerRef}>
          {loadingOlder && (
            <div className="messages-load-older">
              <span className="messages-load-older-spinner" />
            </div>
          )}
          {!hasMoreMessages && !loadingOlder && feed.length > 0 && (
            <div className="messages-beginning">{t('chatEmpty.beginning')}</div>
          )}
          {feed.length === 0 && (
            <div className="empty">
              <p className="empty-icon">{activeEvent ? '💬' : '🔥'}</p>
              <p className="empty-title">
                {activeEvent ? `${activeEvent.title}` : t('chatEmpty.arriving')}
              </p>
              <p className="empty-sub">
                {activeEvent
                  ? t('chatEmpty.firstChat')
                  : t('chatEmpty.firstHi')
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
                    : `feed-activity${fadingIds.has(item.id) ? ' feed-activity--exit' : ''}`}
                  onClick={isClickable ? () => {
                    if (item.userId) {
                      openProfile(item.userId, item.nickname ?? '')
                    } else {
                      setGuestProfile({ guestId: item.guestId, nickname: item.nickname ?? '' })
                    }
                  } : undefined}
                >
                  {item.subtype === 'join' && item.joinVariant != null
                    ? t(`feedJoin.${item.joinVariant}`, { name: item.nickname })
                    : item.subtype === 'crowd' && item.variant != null
                      ? t(`ambient.${item.variant}`)
                      : item.text}
                  {item.createdAt && <span className="feed-join-time">{formatMsgTime(item.createdAt)}</span>}
                </div>
              )
            }

            if (item.type === 'welcome') {
              return (
                <div key={item.id} className="feed-welcome">
                  <div className="feed-welcome-header">
                    <span className="feed-welcome-city">{t('welcome.live', { city: localizeCityName(item.city) })}</span>
                    <button
                      className="feed-welcome-dismiss"
                      onClick={() => setFeed(prev => prev.filter(f => f.id !== item.id))}
                      aria-label={t('welcome.dismiss')}
                    >×</button>
                  </div>
                  <p className="feed-welcome-body">{t('welcome.body')}</p>
                  <div className="feed-welcome-actions">
                    <button
                      className="feed-welcome-btn feed-welcome-btn--primary"
                      onClick={() => {
                        setFeed(prev => prev.filter(f => f.id !== item.id))
                        chatInputRef.current?.focus()
                      }}
                    >{t('welcome.sayHi')}</button>
                    <button
                      className="feed-welcome-btn feed-welcome-btn--secondary"
                      onClick={() => {
                        setFeed(prev => prev.filter(f => f.id !== item.id))
                        share(composeCityShare(item.city))
                      }}
                    >{t('welcome.invite')}</button>
                  </div>
                </div>
              )
            }

            if (item.type === 'owner-prompt') {
              return (
                <div key={item.id} className="feed-owner-prompt">
                  <div className="feed-owner-prompt-body">
                    <span className="feed-owner-prompt-text">{t('ownerPrompt.text')}</span>
                    <span className="feed-owner-prompt-sub">{t('ownerPrompt.sub')}</span>
                  </div>
                  <button
                    className="feed-owner-prompt-btn"
                    onClick={() => setShowEditEvent(true)}
                  >
                    {t('ownerPrompt.edit')}
                  </button>
                </div>
              )
            }

            if (item.type === 'event') {
              const ev = events.find(e => e.id === item.eventId) ?? cityEvents.find(e => e.id === item.eventId)
              return (
                <div key={item.id} className={`feed-prompt${fadingIds.has(item.id) ? ' feed-prompt--exit' : ''}`}>
                  <span className="feed-prompt-text">{item.title ? t('feedNew.event', { title: item.title }) : item.text}</span>
                  <button className="feed-prompt-btn" onClick={() => ev && handleSelectEvent(ev)}>{t('feedNew.join')}</button>
                </div>
              )
            }

            // Challenge feed item — parallel shape to events. The text key
            // varies by target audience (locals vs travelers); tapping
            // "Voir →" opens the ChallengeChatPage via setActiveChallenge.
            if (item.type === 'challenge') {
              const challenge = cityChallenges.find(c => c.id === item.challengeId)
              const textKey   = item.audience === 'explorers' ? 'feedNew.challengeExplorers' : 'feedNew.challengeLocals'
              // (Commit 1) Status sub-pill removed with max_participants.
              // Commit 2 brings it back with 1:1 semantics.
              return (
                <div key={item.id} className={`feed-prompt feed-prompt--challenge${fadingIds.has(item.id) ? ' feed-prompt--exit' : ''}`}>
                  <span className="feed-prompt-text">
                    {t(textKey, { name: item.nickname, title: item.title })}
                  </span>
                  <button
                    className="feed-prompt-btn"
                    onClick={() => challenge && setActiveChallenge(challenge)}
                  >
                    {t('feedNew.challengeCta')}
                  </button>
                </div>
              )
            }

            // Validated-challenge celebration — fires when the owner flips
            // the challenge to validated. Independent pill from the original
            // creation one (both stay visible in the timeline). Same Voir →
            // CTA so users can land on the archived chat.
            if (item.type === 'challenge_validated') {
              const challenge = cityChallenges.find(c => c.id === item.challengeId)
              return (
                <div key={item.id} className={`feed-prompt feed-prompt--challenge-validated${fadingIds.has(item.id) ? ' feed-prompt--exit' : ''}`}>
                  <span className="feed-prompt-text">{t('feedNew.challengeValidated', { name: item.nickname, title: item.title })}</span>
                  <button
                    className="feed-prompt-btn"
                    onClick={() => challenge && setActiveChallenge(challenge)}
                  >
                    {t('feedNew.challengeCta')}
                  </button>
                </div>
              )
            }

            if (item.type === 'topic') {
              const topic = topics.find(tp => tp.id === item.topicId)
              if (!topic) return null
              const mc = topic.message_count ?? 0
              const repliesText = mc > 0 ? ` · ${t('feedNew.replies', { count: mc })}` : ''
              return (
                <div key={item.id} className={`feed-prompt feed-prompt--topic${fadingIds.has(item.id) ? ' feed-prompt--exit' : ''}`}>
                  <span className="feed-prompt-text">🗣️ {topic.title}{repliesText}</span>
                  <button
                    className="feed-prompt-btn feed-prompt-btn--topic"
                    onClick={() => openHangout(topic)}
                  >{t('feedNew.join')}</button>
                </div>
              )
            }

            if (item.type === 'prompt') {
              const promptTk = {
                explore:           { text: t('prompt.exploreText'),       cta: t('prompt.exploreCta') },
                photo:             { text: t('prompt.photoText'),         cta: t('prompt.shoot') },
                'create-event':    { text: t('prompt.createEventText'),    cta: t('prompt.createEventCta') },
                'challenge-intro': { text: t('prompt.challengeIntroText'), cta: t('prompt.challengeIntroCta') },
                install:           { text: t('prompt.installText'),       cta: installPrompt.canUseNativePrompt ? t('prompt.installAdd') : t('prompt.installHow') },
              }[item.subtype]
              return (
                <div key={item.id} className={`feed-prompt${fadingIds.has(item.id) ? ' feed-prompt--exit' : ''}`}>
                  <span className="feed-prompt-text">{promptTk ? promptTk.text : item.text}</span>
                  <button className="feed-prompt-btn" onClick={() => handlePromptCta(item)}>{promptTk ? promptTk.cta : item.cta}</button>
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
              <div key={item.id} ref={el => { if (el) msgRefsMap.current.set(item.id, el); else msgRefsMap.current.delete(item.id) }}>
                {dateLabel && (
                  <div className="date-sep">
                    <span className="date-sep-label">{dateLabel}</span>
                  </div>
                )}
                <div
                  className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : '', 'animate', highlightedMsgId === item.id ? 'msg-highlight' : ''].filter(Boolean).join(' ')}
                  style={item.staggerDelay ? { animationDelay: item.staggerDelay } : undefined}
                >
                  {!isMine && !isGrouped && (
                    <div
                      className={`msg-meta${item.userId ? ' msg-meta--tappable' : ''}`}
                      onClick={item.userId ? () => openProfile(item.userId, item.nickname) : undefined}
                      title={item.userId ? `View ${item.nickname}'s profile` : undefined}
                    >
                      <span
                        className="msg-avatar"
                        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                      >
                        {(item.nickname ?? '?')[0].toUpperCase()}
                      </span>
                      <span className="msg-author" style={{ color: c1 }}>{item.nickname}</span>
                      {(() => { const m = item.mode || 'exploring'; return MODE_META[m] ? <span className={`msg-mode msg-mode--${m}`}>{MODE_META[m].emoji} {t(`mode.${m}.label`, { ns: 'common' })}</span> : null; })()}
                      {item.vibe && VIBE_META[item.vibe] && (
                        <span className="msg-vibe">{VIBE_META[item.vibe].emoji}</span>
                      )}
                      {item.contextBadge?.key === 'host' && (
                        <span className="badge-pill badge-pill--host">{badgeLabel(item.contextBadge.key)}</span>
                      )}
                    </div>
                  )}
                  <div
                    className={`msg-bubble-wrap ${isMine ? 'mine' : ''} ${isGrouped && !isMine ? 'grouped' : ''}`}
                    onClick={e => {
                      if (item.type === 'system' || item.type === 'event' || item.type === 'topic') return
                      if (item.deletedAt) return  // tombstone has no actions
                      const rect = e.currentTarget.getBoundingClientRect()
                      setActionBubble({ msg: item, x: rect.left, y: rect.top, isMine })
                    }}
                  >
                    {item.deletedAt ? (
                      <div className="msg-content msg-content--deleted">
                        <span className="msg-text">{t('messageDeleted', { ns: 'chat', defaultValue: 'Message deleted' })}</span>
                      </div>
                    ) : item.type === 'image' ? (
                      <img
                        src={item.imageUrl}
                        className="msg-image"
                        alt="shared image"
                        onClick={() => setLightboxUrl(item.imageUrl)}
                      />
                    ) : item.content?.startsWith('📍') ? (
                      (() => {
                        const parts = item.content.split('\n')
                        const line1 = parts[0] ?? ''
                        let lat, lng, addr
                        if (parts.length >= 3) {
                          const coordParts = (parts[1] ?? '').split(',')
                          lat = parseFloat(coordParts[0] ?? '')
                          lng = parseFloat(coordParts[1] ?? '')
                          if (isNaN(lat) || isNaN(lng) || coordParts.length !== 2) { lat = undefined; lng = undefined }
                          addr = lat !== undefined ? parts.slice(2).join('\n') : parts.slice(1).join('\n')
                        } else {
                          addr = parts.slice(1).join('\n')
                        }
                        const hasCoords = lat !== undefined && lng !== undefined
                        const mapsUrl = hasCoords ? `https://maps.google.com/?q=${lat},${lng}` : null
                        return (
                          <div
                            className={`loc-bubble${isMine ? ' loc-bubble--me' : ''}${hasCoords ? ' loc-bubble--tappable' : ''}`}
                            onClick={mapsUrl ? () => window.open(mapsUrl, '_blank', 'noopener') : undefined}
                          >
                            <span className="loc-bubble-icon">📍</span>
                            <div className="loc-bubble-body">
                              <span className="loc-bubble-place">{line1.replace('📍 ', '')}</span>
                              {addr && <span className="loc-bubble-addr">{addr}</span>}
                              {hasCoords && <span className="loc-bubble-tap">Tap to open in maps</span>}
                            </div>
                          </div>
                        )
                      })()
                    ) : (
                      <div className="msg-content">
                        {item.replyTo && (
                          <div
                            className={`msg-reply-quote${item.replyTo.id ? ' msg-reply-quote--tappable' : ''}`}
                            onClick={item.replyTo.id ? (e) => { e.stopPropagation(); scrollToMessage(item.replyTo.id) } : undefined}
                          >
                            <span className="msg-reply-quote-name">{item.replyTo.nickname}</span>
                            <span className="msg-reply-quote-text">
                              {item.replyTo.type === 'image' ? '📷 Photo' : (item.replyTo.content || 'Original message unavailable')}
                            </span>
                          </div>
                        )}
                        <span className="msg-text">
                          {renderMessageContent(item)}
                          {item.editedAt && (
                            <span className="msg-edited-tag">{` ${t('edited', { ns: 'chat', defaultValue: 'edited' })}`}</span>
                          )}
                        </span>
                        {(() => {
                          const u = extractFirstUrl(item.content)
                          return u ? <LinkPreviewCard url={u} /> : null
                        })()}
                      </div>
                    )}
                  </div>
                  {item.reactions && item.reactions.length > 0 && (
                    <div className={`reaction-pills${isMine ? ' mine' : ''}`}>
                      {item.reactions.map(r => (
                        <button
                          key={r.emoji}
                          className={`reaction-pill${r.self ? ' self' : ''}`}
                          onClick={async (e) => {
                            e.stopPropagation()
                            triggerReactionBurst(r.emoji, item.id)
                            socketRef.current?.sendReaction(EMOJI_TO_TYPE[r.emoji] ?? r.emoji, item.id, channelId, accountRef.current?.id ?? null)
                            try {
                              const data = await toggleChannelReaction(channelId, item.id, r.emoji, guest?.guestId)
                              setFeed(prev => prev.map(m => m.id === item.id ? { ...m, reactions: data.reactions } : m))
                            } catch {}
                          }}
                        >
                          {r.emoji}{r.count > 1 && <span className="reaction-count">{r.count}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {showTime && item.createdAt && (
                    <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatMsgTime(item.createdAt)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {typingLabel && (
          <div className="typing-indicator">
            <span className="typing-dots">
              <span /><span /><span />
            </span>
            {typingLabel}
          </div>
        )}

        {actionBubble && (
          <div className="action-bubble-overlay" onClick={() => setActionBubble(null)}>
            <div
              className="action-bubble"
              style={{
                top:   Math.max(8, actionBubble.y - 64),
                left:  actionBubble.isMine ? 'auto' : actionBubble.x,
                right: actionBubble.isMine ? 16 : 'auto',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Emoji reaction strip */}
              <div className="action-bubble-emojis">
                {['❤️', '👍', '😂', '😮', '🔥'].map(emoji => {
                  const selfReacted = (actionBubble.msg.reactions ?? []).some(r => r.emoji === emoji && r.self)
                  return (
                    <button
                      key={emoji}
                      className={`action-bubble-emoji${selfReacted ? ' active' : ''}`}
                      onClick={async () => {
                        const msgId = actionBubble.msg.id
                        triggerReactionBurst(emoji, msgId)
                        socketRef.current?.sendReaction(EMOJI_TO_TYPE[emoji] ?? emoji, msgId, channelId, accountRef.current?.id ?? null)
                        try {
                          const data = await toggleChannelReaction(channelId, msgId, emoji, guest?.guestId)
                          setFeed(prev => prev.map(m => m.id === msgId ? { ...m, reactions: data.reactions } : m))
                        } catch {}
                        setActionBubble(null)
                      }}
                    >
                      {emoji}
                    </button>
                  )
                })}
              </div>
              <button
                className="action-bubble-btn"
                onClick={() => {
                  setReplyingTo({
                    id:       actionBubble.msg.id,
                    nickname: actionBubble.msg.nickname,
                    content:  actionBubble.msg.content ?? '',
                    type:     actionBubble.msg.type ?? 'text',
                  })
                  setActionBubble(null)
                  chatInputRef.current?.focus()
                }}
              >
                {t('actionReply', { ns: 'chat', defaultValue: '↩ Reply' })}
              </button>
              {actionBubble.msg.content && (
                <button
                  className="action-bubble-btn"
                  onClick={() => {
                    const text = actionBubble.msg.content ?? ''
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(text).catch(() => {})
                    }
                    setActionBubble(null)
                  }}
                >
                  {t('actionCopy', { ns: 'chat', defaultValue: '📋 Copy' })}
                </button>
              )}
              {/* Edit + Delete are visible only when the viewer owns the bubble.
                  Edit is text-only — image and location messages don't expose it. */}
              {actionBubble.isMine && actionBubble.msg.content && !actionBubble.msg.content.startsWith('📍') && (actionBubble.msg.type ?? 'text') === 'text' && (
                <button
                  className="action-bubble-btn"
                  onClick={() => {
                    setReplyingTo(null)
                    setEditingMsg({ id: actionBubble.msg.id, content: actionBubble.msg.content ?? '', surface: 'channel' })
                    setInput(actionBubble.msg.content ?? '')
                    setActionBubble(null)
                    chatInputRef.current?.focus()
                  }}
                >
                  {t('actionEdit', { ns: 'chat', defaultValue: '✏️ Edit' })}
                </button>
              )}
              {actionBubble.isMine && (
                <button
                  className="action-bubble-btn action-bubble-btn--danger"
                  onClick={() => {
                    const msg = actionBubble.msg
                    setActionBubble(null)
                    deleteMessageAction(msg, 'channel')
                  }}
                >
                  {t('actionDelete', { ns: 'chat', defaultValue: '🗑️ Delete' })}
                </button>
              )}
            </div>
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

        {locationPickerCoords && (
          <LocationPicker
            initialLat={locationPickerCoords.lat}
            initialLng={locationPickerCoords.lng}
            nickname={activeNickname}
            onConfirm={handleLocationConfirm}
            onClose={() => setLocationPickerCoords(null)}
          />
        )}

        {showShareSheet && (
          <ShareActionSheet
            onSnap={() => { setShowShareSheet(false); fileInputRef.current?.click() }}
            onSpot={handleMySpot}
            onClose={() => setShowShareSheet(false)}
            spotLoading={spotLoading}
          />
        )}

        {replyingTo && !editingMsg && (
          <div className="reply-preview">
            <div className="reply-preview-body">
              <span className="reply-preview-name">{replyingTo.nickname}</span>
              <span className="reply-preview-text">
                {replyingTo.type === 'image' ? t('replyPreview.photo') : replyingTo.content}
              </span>
            </div>
            <button className="reply-preview-close" type="button" onClick={() => setReplyingTo(null)}>✕</button>
          </div>
        )}

        {editingMsg && (
          <div className="edit-preview">
            <div className="edit-preview-body">
              <span className="edit-preview-name">{t('editingBanner', { ns: 'chat', defaultValue: 'Editing message' })}</span>
              <span className="edit-preview-text">{editingMsg.content}</span>
            </div>
            <button
              className="edit-preview-close"
              type="button"
              onClick={() => { setEditingMsg(null); setInput('') }}
            >
              ✕
            </button>
          </div>
        )}

        <MessageComposer
          inputRef={chatInputRef}
          fileInputRef={fileInputRef}
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSend}
          onFileSelect={handleImageSelect}
          onShareClick={() => setShowShareSheet(true)}
          showEmoji={showEmoji}
          onEmojiToggle={() => setShowEmoji(p => !p)}
          onEmojiSelect={insertEmoji}
          onEmojiClose={() => setShowEmoji(false)}
          placeholder={activeEvent
            ? feed.some(f => f.type === 'message')
              ? t('placeholder.event', { title: activeEvent.title })
              : t('placeholder.eventFirst', { title: activeEvent.title })
            : city ? cityComposerPlaceholder : ''
          }
          uploading={uploading}
          sending={sending}
          spotLoading={spotLoading}
          mentionSuggestions={mentions.suggestions}
          onMentionSelect={mentions.selectMention}
        />

        {/* Bottom navigation — mobile only */}
        <nav className="bottom-nav" aria-label="Primary">
          <button
            type="button"
            className={`bottom-nav-tab${showEventDrawer ? ' active' : ''}`}
            onClick={goToNowTab}
            aria-label="Now"
          >
            <span
              className={`bottom-nav-icon${nowTabPulsing ? ' bottom-nav-icon--now-pulse' : ''}`}
              onAnimationEnd={() => setNowTabPulsing(false)}
            >
              <NavIconEvents />
              {nowTabDot && <span className="bottom-nav-now-dot" aria-hidden="true" />}
            </span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${
              !showEventDrawer && !showCityPicker && !showPeopleDrawer &&
              !showProfileDrawer && !showConversations && !showNotifications
                ? ' active' : ''
            }`}
            onClick={goToCityChannel}
            aria-label="My city"
          >
            <span className="bottom-nav-icon"><NavIconCity /></span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${showPeopleDrawer ? ' active' : ''}`}
            onClick={goToHereTab}
            aria-label="People here"
          >
            <span className="bottom-nav-icon"><NavIconPeople /></span>
          </button>
          <button
            type="button"
            className={`bottom-nav-tab${showProfileDrawer ? ' active' : ''}`}
            onClick={goToMeTab}
            aria-label="Profile"
          >
            <span className="bottom-nav-icon"><NavIconProfile /></span>
          </button>
        </nav>
      </div>

      {/* ── Full-screen pages ─────────────────────────── */}

      {showCityPicker && (
        <div className="full-page">
          <div className="page-header">
            <BackButton onClick={() => setShowCityPicker(false)} />
            <span className="page-title">{t('picker.switchTitle')}</span>
          </div>
          <div className="city-search-wrap">
            <input
              className="city-search-input"
              type="search"
              placeholder={t('picker.search')}
              value={citySearchQuery}
              onChange={e => setCitySearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          {!citySearchQuery.trim() && (
            <div className="city-filter-tabs">
              {[
                { id: 'active', label: t('picker.filterActive') },
                { id: 'events', label: t('picker.filterEvents') },
                { id: 'online', label: t('picker.filterOnline') },
              ].map(f => (
                <button
                  key={f.id}
                  className={`city-filter-tab${cityFilter === f.id ? ' active' : ''}`}
                  onClick={() => { if (cityFilter !== f.id) changeCityFilter(f.id) }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {geoChannelId && geoChannelId !== channelId && geoCity && (
            <button
              className="back-to-location-btn"
              onClick={() => switchCity(geoChannelId, geoCity, geoTimezone ?? 'UTC', geoCountry)}
            >
              <span className="back-to-location-icon">📍</span>
              <span className="back-to-location-text">
                <span className="back-to-location-label">{t('picker.backToLocation')}</span>
                <span className="back-to-location-sub">{geoCity}</span>
              </span>
              <span className="back-to-location-arrow">→</span>
            </button>
          )}
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

              if (q) {
                // Search mode — query against all channels (full unranked list)
                const results = [...allChannels]
                  .filter(ch => ch.city.toLowerCase().includes(q))
                  .sort((a, b) => cityScore(b) - cityScore(a) || a.city.localeCompare(b.city))
                if (results.length === 0) return <div className="city-no-results">{t('picker.noResults', { query: q })}</div>
                return results.map(ch => renderCityRow(
                  ch,
                  (ch) => switchCity(ch.channelId, ch.city, ch.timezone, ch.country),
                  ch.channelId === channelId
                ))
              }

              // Default mode — backend already sorted & sliced to top 10, pin current city first
              const activeCh = channels.find(ch => ch.channelId === channelId)
              const others   = channels.filter(ch => ch.channelId !== channelId)
              const top10    = activeCh ? [activeCh, ...others] : others
              const label    = channels.some(ch => (ch.activeUsers ?? 0) > 0) ? t('picker.topCities') : t('picker.cities')
              return (
                <>
                  <div className="city-list-label">{label}</div>
                  {top10.map(ch => renderCityRow(
                    ch,
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
        <div className="full-page full-page--tab">
          <div className="tab-app-header">
            {renderAppHeader()}
          </div>
          <div className="page-header">
            <span className="page-title">{t('nowTitle', { ns: 'common' })}</span>
          </div>
          <div className="now-filter-bar">
            {['all', 'challenges', 'topics', 'events'].map(f => (
              <button
                key={f}
                className={`now-filter-pill${nowFilter === f ? ' now-filter-pill--active' : ''}`}
                onClick={() => setNowFilter(f)}
              >
                {f === 'all'           ? t('feed.filterAll')
                  : f === 'challenges' ? t('filterChallenges', { ns: 'common' })
                  : f === 'events'     ? t('filterEvents',     { ns: 'common' })
                  :                      t('filterHangouts',   { ns: 'common' })}
              </button>
            ))}
          </div>
          <div className="page-body" ref={nowBodyRef}>
            {/* Challenges strip — shown on All + Challenges filters per spec.
                On 'all'      → top 5 newest + "See all" CTA when there are more.
                On 'challenges' → type sub-filter chips, paginated cap with
                                  scroll-to-load (5 at a time). */}
            {(nowFilter === 'all' || nowFilter === 'challenges') && cityChallenges.length > 0 && (() => {
              // Type-filter only meaningful inside the Challenges filter.
              const filteredChallenges = nowFilter === 'challenges' && challengeTypeFilter !== 'all'
                ? cityChallenges.filter(c => c.challenge_type === challengeTypeFilter)
                : cityChallenges
              const visibleCap = nowFilter === 'challenges' ? challengesShownCount : NOW_CHALLENGES_CAP
              const visibleChallenges = filteredChallenges.slice(0, visibleCap)
              const hasMoreInFilter   = filteredChallenges.length > visibleChallenges.length
              const hasMoreTotal      = cityChallenges.length > NOW_CHALLENGES_CAP
              return (
              <div className="now-challenges-section">
                {nowFilter === 'all' && (
                  <p className="events-group-label" style={{ padding: '10px 12px 2px', color: '#FF7A3C' }}>
                    🔥 {t('noun', { ns: 'challenge' })}
                  </p>
                )}
                {nowFilter === 'challenges' && (
                  <div className="challenge-type-chips" role="tablist" aria-label={t('typeFilter.label', { ns: 'challenge' })}>
                    {[
                      { key: 'all',     emoji: '✨' },
                      { key: 'food',    emoji: '🍜' },
                      { key: 'place',   emoji: '📍' },
                      { key: 'culture', emoji: '🎭' },
                      { key: 'help',    emoji: '🤝' },
                    ].map(({ key, emoji }) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={challengeTypeFilter === key}
                        className={`challenge-type-chip${challengeTypeFilter === key ? ' challenge-type-chip--active' : ''}`}
                        onClick={() => setChallengeTypeFilter(key)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span>{key === 'all'
                          ? t('typeFilter.all', { ns: 'challenge' })
                          : t(`tp.${key}`, { ns: 'challenge' })}</span>
                      </button>
                    ))}
                  </div>
                )}
                {visibleChallenges.map(c => {
                  const typeIcon = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }[c.challenge_type] ?? '🔥'
                  const audienceLabel = c.audience === 'locals'
                    ? t('forLocals',    { ns: 'challenge' })
                    : t('forExplorers', { ns: 'challenge' })
                  const isValidated = c.status === 'validated'
                  return (
                    <button
                      key={c.id}
                      className="city-row event-row-card challenge-row-card"
                      style={{ cursor: 'pointer', textAlign: 'left' }}
                      onClick={() => { setShowEventDrawer(false); setActiveChallenge(c) }}
                    >
                      <div className="er-header">
                        <span className="er-title">{typeIcon} {c.title}</span>
                        <span className="er-going er-going--challenge">{t(`typeBadge.${c.challenge_type}`, { ns: 'challenge' })}</span>
                      </div>
                      <div className="er-badges">
                        <span className="challenge-badge challenge-badge--audience">{audienceLabel}</span>
                        {isValidated ? (
                          <span className="challenge-badge challenge-badge--validated">
                            ✓ {t('validatedBadge', { ns: 'challenge' })}
                          </span>
                        ) : c.is_in_progress ? (
                          <span className="challenge-badge challenge-badge--status">
                            ⏳ {t('card.inProgress', { ns: 'challenge' })}
                          </span>
                        ) : (
                          <span className="challenge-badge challenge-badge--available">
                            🟢 {t('card.available', { ns: 'challenge' })}
                          </span>
                        )}
                      </div>
                      {c.creator_display_name && (
                        <span className="er-host">{t('byCreator', { ns: 'challenge', name: c.creator_display_name })}</span>
                      )}
                      <AttendeeAvatars
                        preview={c.participants_preview ?? []}
                        total={c.participant_count ?? 0}
                      />
                    </button>
                  )
                })}
                {/* "See all challenges" CTA on the All filter — switches the
                    parent filter to 'challenges' so the user lands inside
                    the full list (with type chips + pagination). */}
                {nowFilter === 'all' && hasMoreTotal && (
                  <button
                    type="button"
                    className="challenge-see-all"
                    onClick={() => setNowFilter('challenges')}
                  >
                    {t('seeAllChallenges', { ns: 'challenge', defaultValue: 'See all challenges →' })}
                  </button>
                )}
                {/* Type-bucket empty state — the user picked a type that has
                    no challenges right now. Sit silent on the parent feed; a
                    tiny inline hint is enough. */}
                {nowFilter === 'challenges' && filteredChallenges.length === 0 && (
                  <div className="challenge-type-empty">
                    {t('typeFilter.empty', { ns: 'challenge', defaultValue: 'Nothing in this category right now.' })}
                  </div>
                )}
                {/* Inline loader hint when there are more challenges to show.
                    The scroll listener bumps challengesShownCount; the array
                    re-slices and the hint disappears on its own. */}
                {nowFilter === 'challenges' && hasMoreInFilter && (
                  <div className="challenge-load-more-hint">…</div>
                )}
              </div>
              )
            })()}

            {/* Empty state for the 'challenges' filter — only fires when the
                whole challenges array is empty (no validated either). */}
            {nowFilter === 'challenges' && cityChallenges.length === 0 && (
              <div className="events-empty-state">
                <p className="events-empty-title">{t('noun', { ns: 'challenge' })}</p>
                <button className="events-empty-cta" onClick={() => { setShowEventDrawer(false); openCreateChallenge() }} style={{ background: 'rgba(255,122,60,0.14)', color: '#FF7A3C', borderColor: 'rgba(255,122,60,0.30)' }}>
                  🔥 {t('createCta', { ns: 'challenge' })}
                </button>
              </div>
            )}

            {/* Filter='challenges' → don't render events/topics below */}
            {nowFilter !== 'challenges' && (() => {
              const openCreate = () => { tryOpenCreateEvent({ fromDrawer: true }) }
              const tz = cityTimezone || 'UTC'
              const hiladsEvents = [...events].sort((a, b) => a.starts_at - b.starts_at)
              // Distance-sort public events (nearest → farthest; no-coord last)
              // when the viewer's location is known; otherwise by start time.
              const publicEvents = [...cityEvents].sort((a, b) => {
                const aDist = distanceByEventId.get(a.id)
                const bDist = distanceByEventId.get(b.id)
                const aHas = aDist !== undefined
                const bHas = bDist !== undefined
                if (aHas !== bHas) return aHas ? -1 : 1
                if (aHas && bHas && aDist !== bDist) return aDist - bDist
                return a.starts_at - b.starts_at
              })
              const totalVisibleEvents = hiladsEvents.length + publicEvents.length
              const CATEGORY_ICONS = { general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }
              const renderTopicRow = (topic) => {
                const icon = CATEGORY_ICONS[topic.category] ?? '🗣️'
                const replies = topic.message_count ?? 0
                const activeNow = topic.active_now === true
                const timeAgo = topic.last_activity_at
                  ? (() => {
                      const diff = Math.floor((Date.now() / 1000) - topic.last_activity_at)
                      if (diff < 60) return t('time.justNow', { ns: 'common' })
                      if (diff < 3600) return t('time.mAgo', { ns: 'common', count: Math.floor(diff / 60) })
                      return t('time.hAgo', { ns: 'common', count: Math.floor(diff / 3600) })
                    })()
                  : null
                const meters = distanceByEventId.get(topic.id)
                return (
                  <button key={topic.id} className="city-row event-row-card topic-row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { setShowEventDrawer(false); openHangout(topic) }}>
                    <div className="er-header">
                      <span className="er-title">{icon} {topic.title}</span>
                      <span className="er-going er-going--topic">{t('feed.hangoutTag')}</span>
                    </div>
                    <div className="er-badges">
                      {activeNow && <span className="now-active-badge">{t('feed.activeNow')}</span>}
                      {formatExpiresIn(topic.expires_at) && (
                        <span className="city-row-current">⏱ {formatExpiresIn(topic.expires_at)}</span>
                      )}
                      <span className="city-row-current city-row-current--reply">
                        <Marquee
                          text={replies > 0
                            ? `${t('feed.replies', { count: replies })}${timeAgo ? ` · ${timeAgo}` : ''}`
                            : t('feed.repliesNew')}
                          className="now-reply-marquee"
                          fadeColor="#2b1814"
                        />
                      </span>
                    </div>
                    {topic.description && (
                      <span className="er-location">{topic.description}</span>
                    )}
                    {meters !== undefined && (
                      <span className="er-location">📍 {formatDistance(meters)}</span>
                    )}
                    <AttendeeAvatars
                      preview={topic.participants_preview ?? []}
                      total={topic.participant_count ?? 0}
                      onClick={() => openMembersList(topic, 'topic')}
                    />
                  </button>
                )
              }
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
                        {EVENT_ICONS[event.event_type ?? event.type] ?? '📌'} {event.title}
                      </span>
                      {group === 'public'
                        ? <span className="er-going er-going--public">{t('feed.public')}</span>
                        : <span className="er-going er-going--event">{t('feed.eventTag')}</span>}
                    </div>
                    <div className="er-badges">
                      <span className="city-row-current">
                        {getTimeLabel(event.starts_at, tz, { withDay: true })}
                        {event.ends_at ? ` → ${formatTime(event.ends_at, tz)}` : ''}
                      </span>
                      {formatRecurrence(event) && (
                        <span className="recur-badge">↻ {formatRecurrence(event)}</span>
                      )}
                      {going > 0 && <span className="city-row-current">{t('feed.going', { count: going })}</span>}
                    </div>
                    {(() => {
                      // NOW feed: show distance when we have it; otherwise the address.
                      const meters = distanceByEventId.get(event.id)
                      if (meters !== undefined) return <span className="er-location">📍 {formatDistance(meters)}</span>
                      const loc = getEventLocation(event)
                      return loc ? <span className="er-location">📍 {loc}</span> : null
                    })()}
                    {event.host_nickname && (
                      <span className="er-host">{t('feed.hostedBy', { name: event.host_nickname })}</span>
                    )}
                    {group !== 'public' && (
                      <AttendeeAvatars
                        preview={event.participants_preview ?? []}
                        total={going || (event.participant_count ?? 0)}
                        onClick={() => openMembersList(event, 'event')}
                      />
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
                    <p className="events-group-label" style={{ padding: '10px 12px 2px' }}>{t('feed.groupHilads')}</p>
                    {[...Array(3)].map(renderSkeletonRow)}
                    <p className="events-group-label events-group-label--city" style={{ padding: '18px 12px 2px' }}>{t('feed.groupPublic')}</p>
                    {[...Array(2)].map((_, idx) => renderSkeletonRow(_, idx + 3))}
                  </>
                )
              }

              if (hotEventsStatus === 'error') {
                return (
                  <div className="events-empty-state">
                    <p className="events-empty-title">{t('feed.loadError')}</p>
                    <p className="events-empty-sub">{t('feed.loadErrorSub', { city })}</p>
                    <button className="events-empty-cta" onClick={openCreate}>{t('feed.createEvent')}</button>
                  </div>
                )
              }

              if (totalVisibleEvents === 0 && topics.length === 0) {
                const isLocalUser = account?.mode === 'local'
                return (
                  <div className="events-empty-state">
                    <p className="events-empty-title">{isLocalUser ? t('feed.emptyLocalTitle') : t('feed.emptyTitle')}</p>
                    <p className="events-empty-sub">
                      {isLocalUser ? t('feed.emptyLocalSub', { city }) : t('feed.emptySub', { city })}
                    </p>
                    <button className="events-empty-cta" onClick={openCreate}>
                      {isLocalUser ? t('feed.openPlace') : t('feed.createEvent')}
                    </button>
                    <button className="events-empty-cta" onClick={() => { setShowEventDrawer(false); openCreateHangout() }} style={{ marginTop: 8, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.25)' }}>{t('feed.startHangout')}</button>
                  </div>
                )
              }

              // Unified list: merge hilads events + topics, sort by activity
              const nowTs = Date.now() / 1000
              const taggedEvents = hiladsEvents.map(e => ({ ...e, _kind: 'event' }))
              const taggedTopics = topics.map(t => ({ ...t, _kind: 'topic' }))
              const unified = [...taggedEvents, ...taggedTopics].sort((a, b) => {
                // Hangouts take priority over events
                const aTopic = a._kind === 'topic' ? 1 : 0
                const bTopic = b._kind === 'topic' ? 1 : 0
                if (aTopic !== bTopic) return bTopic - aTopic
                // Within a group, when the viewer's location is known, sort
                // nearest → farthest; items without coords sort after located ones.
                const aDist = distanceByEventId.get(a.id)
                const bDist = distanceByEventId.get(b.id)
                const aHas = aDist !== undefined
                const bHas = bDist !== undefined
                if (aHas !== bHas) return aHas ? -1 : 1
                if (aHas && bHas && aDist !== bDist) return aDist - bDist
                // Recurring events are city anchors — always float to top
                const aRecur = a._kind === 'event' && !!(a.series_id ?? a.recurrence_label) ? 1 : 0
                const bRecur = b._kind === 'event' && !!(b.series_id ?? b.recurrence_label) ? 1 : 0
                if (aRecur !== bRecur) return bRecur - aRecur
                const aLive = a._kind === 'event' && a.starts_at <= nowTs && (a.expires_at ?? 0) > nowTs
                const bLive = b._kind === 'event' && b.starts_at <= nowTs && (b.expires_at ?? 0) > nowTs
                if (aLive !== bLive) return aLive ? -1 : 1
                if (aLive && bLive) return a.starts_at - b.starts_at
                const aAct = a.last_activity_at ?? a.created_at ?? 0
                const bAct = b.last_activity_at ?? b.created_at ?? 0
                return bAct - aAct
              })

              const filtered = nowFilter === 'events'
                ? unified.filter(i => i._kind === 'event')
                : nowFilter === 'topics'
                  ? unified.filter(i => i._kind === 'topic')
                  : unified

              if (filtered.length === 0) {
                return (
                  <div className="events-empty-state">
                    <p className="events-empty-title">
                      {nowFilter === 'events' ? t('feed.noEvents') : t('feed.noHangouts')}
                    </p>
                    <p className="events-empty-sub">
                      {nowFilter === 'events' ? t('feed.noEventsSub', { city }) : t('feed.noHangoutsSub')}
                    </p>
                    {nowFilter === 'events'
                      ? <button className="events-empty-cta" onClick={openCreate}>{t('feed.createEvent')}</button>
                      : <button className="events-empty-cta" onClick={() => { setShowEventDrawer(false); openCreateHangout() }} style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.25)' }}>{t('feed.startHangout')}</button>
                    }
                  </div>
                )
              }

              return (
                <>
                  {filtered.map(item => item._kind === 'topic'
                    ? renderTopicRow(item)
                    : renderEventRow(item, 'hilads')
                  )}
                  {nowFilter !== 'topics' && publicEvents.length > 0 && (
                    <>
                      <p className="events-group-label events-group-label--city" style={{ padding: '18px 12px 2px' }}>{t('feed.groupPublicTicket')}</p>
                      {publicEvents.map(event => renderEventRow(event, 'public'))}
                    </>
                  )}
                </>
              )
            })()}
          </div>
          {/* Bottom action bar — single horizontal row:
              [ See what's coming 🔮 (flex:1) ] [+ (48×48 circle)]
              The + always opens the create chooser regardless of user mode,
              so both flows ("Start a pulse" / "Host your spot") sit behind
              one consistent picker UX. */}
          <div className="now-actions-bar">
            <button
              className="upcoming-cta upcoming-cta--inline"
              onClick={() => { setShowEventDrawer(false); setShowUpcomingEvents(true) }}
            >
              {t('feed.seeComing')}
            </button>
            <button
              className="now-create-btn"
              onClick={() => { setShowEventDrawer(false); setShowCreateChooser(true) }}
              aria-label={t('feed.createNew')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          {/* Discreet archive entry — muted text link under the upcoming pill. */}
          <button
            className="past-archive-link"
            onClick={() => {
              setShowEventDrawer(false)
              if (city) pushUrl(`/city/${cityToSlug(city)}/past`)
              if (typeof window !== 'undefined' && window.posthog) window.posthog.capture('past_archive_opened')
              setShowPastArchive(true)
            }}
          >
            {t('feed.seeHappened')} →
          </button>
        </div>
      )}

      {showUpcomingEvents && (
        <UpcomingEventsScreen
          channelId={channelId}
          timezone={cityTimezone}
          onBack={() => setShowUpcomingEvents(false)}
          onSelectEvent={(event) => { setShowUpcomingEvents(false); handleSelectEvent(event) }}
        />
      )}

      {showPastArchive && (
        <PastArchiveScreen
          channelId={channelId}
          timezone={cityTimezone}
          cityName={city}
          onBack={() => { setShowPastArchive(false); if (city) pushUrl(`/city/${cityToSlug(city)}`) }}
          onSelectEvent={(event) => { setShowPastArchive(false); handleSelectEvent(event) }}
          onSelectTopic={(topic) => { setShowPastArchive(false); setActiveTopic(topic) }}
          onSelectChallenge={(challenge) => { setShowPastArchive(false); setActiveChallenge(challenge) }}
        />
      )}

      {showPeopleDrawer && !viewingProfile && (() => {
        // ── helpers scoped to this render ──────────────────────────────────────
        const BADGE_FILTER_OPTIONS = [
          { key: 'fresh',   label: badgeLabel('fresh')   },
          { key: 'regular', label: badgeLabel('regular') },
          { key: 'host',    label: badgeLabel('host')    },
        ]
        const VIBE_FILTER_OPTIONS = Object.entries(VIBE_META).map(([k, v]) => ({ key: k, label: `${v.emoji} ${vibeLabel(k)}` }))
        const MODE_FILTER_OPTIONS = Object.entries(MODE_META).map(([k, v]) => ({ key: k, label: `${v.emoji} ${t(`mode.${k}.label`, { ns: 'common' })}` }))

        // Enrich HERE NOW users with badge/vibe from crew data (WS presence has no badges).
        // CityMember is now UserDTO with badges[], so we derive primaryBadge/contextBadge from it.
        const CONTEXT_BADGE_KEYS_WEB = new Set(['host'])
        const crewLookupMap = new Map(crewMembers.map(m => [m.id, m]))
        const enrichedOnline = onlineUsers.map(u => {
          if (!u.userId) return u // guest: no enrichment possible
          const crew = crewLookupMap.get(u.userId)
          if (!crew && !u.isMe) return u
          const primaryKey = (crew?.badges ?? []).find(k => !CONTEXT_BADGE_KEYS_WEB.has(k))
          const contextKey = (crew?.badges ?? []).find(k => CONTEXT_BADGE_KEYS_WEB.has(k))
          return {
            ...u,
            primaryBadge:  primaryKey ? { key: primaryKey, label: badgeLabel(primaryKey) } : u.primaryBadge,
            contextBadge:  contextKey ? { key: contextKey, label: badgeLabel(contextKey) } : u.contextBadge,
            vibe:          crew?.vibe ?? u.vibe,
            mode:          crew?.mode ?? u.mode,
            avatarUrl:     crew?.avatarUrl ?? (u.isMe ? account?.profile_photo_url : undefined) ?? u.avatarUrl,
          }
        })

        // Apply badge + vibe filters to the live list (small → client-side)
        const filteredOnline = enrichedOnline.filter(u => {
          if (filterBadge && !u.isMe) {
            const bk = u.primaryBadge?.key
            if (filterBadge === 'host') return u.contextBadge?.key === 'host'
            if (bk !== filterBadge) return false
          }
          if (filterVibe && !u.isMe && u.vibe !== filterVibe) return false
          if (filterMode && !u.isMe && u.mode !== filterMode) return false
          return true
        })

        const renderOnlineUser = (user) => {
          const [c1, c2] = avatarColors(user.nickname)
          const tappable = !user.isMe && user.isRegistered
          const handleTap = () => {
            if (user.isMe) return
            if (user.isRegistered) openProfile(user.userId, user.nickname)
          }
          return (
            <div
              key={user.id}
              className={`people-drawer-row${tappable ? ' people-drawer-row--tappable' : ''}`}
              onClick={(!user.isMe && (tappable || !account)) ? handleTap : undefined}
            >
              {user.avatarUrl
                ? <img className="online-avatar" src={user.avatarUrl} alt={user.nickname} style={{ objectFit: 'cover' }} data-me={user.isMe ? 'true' : undefined} />
                : <span className="online-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} data-me={user.isMe ? 'true' : undefined}>
                    {(user.nickname ?? '?')[0].toUpperCase()}
                  </span>
              }
              <div className="people-drawer-content">
                <span className="people-drawer-name">
                  {user.nickname}{user.isMe && <span className="people-drawer-you"> {t('here.you')}</span>}
                </span>
                <div className="people-drawer-meta">
                  {user.mode && MODE_META[user.mode] && (
                    <span className={`vibe-badge vibe-badge--${user.mode}`}>{MODE_META[user.mode].emoji}</span>
                  )}
                  {user.primaryBadge
                    ? <span className={`badge-pill badge-pill--${user.primaryBadge.key}`}>{badgeLabel(user.primaryBadge.key)}</span>
                    : user.isRegistered
                      ? <span className="badge-pill badge-pill--regular">{badgeLabel('regular')}</span>
                      : <span className="badge-pill badge-pill--ghost">{badgeLabel('ghost')}</span>
                  }
                  {user.contextBadge && (
                    <span className={`badge-pill badge-pill--${user.contextBadge.key}`}>{badgeLabel(user.contextBadge.key)}</span>
                  )}
                  {user.vibe && VIBE_META[user.vibe] && (
                    <span className="vibe-badge">{VIBE_META[user.vibe].emoji} {vibeLabel(user.vibe)}</span>
                  )}
                </div>
              </div>
              {!user.isMe && user.isRegistered && (
                <button className="people-dm-btn" aria-label={t('here.messageAria', { name: user.nickname })}
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
          const [c1, c2] = avatarColors(m.displayName)
          return (
            <div key={m.id} className="people-drawer-row people-drawer-row--tappable"
              onClick={() => openProfile(m.id, m.displayName)}
            >
              {m.avatarUrl
                ? <img className="online-avatar" src={m.avatarUrl} alt={m.displayName} style={{ objectFit: 'cover' }} />
                : <span className="online-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(m.displayName ?? '?')[0].toUpperCase()}
                  </span>
              }
              <div className="people-drawer-content">
                <span className="people-drawer-name">{m.displayName}</span>
                <div className="people-drawer-meta">
                  {m.mode && MODE_META[m.mode] && <span className={`vibe-badge vibe-badge--${m.mode}`}>{MODE_META[m.mode].emoji}</span>}
                  {(m.badges ?? []).map(k => (
                    <span key={k} className={`badge-pill badge-pill--${k}`}>{badgeLabel(k)}</span>
                  ))}
                  {m.vibe && VIBE_META[m.vibe] && <span className="vibe-badge">{VIBE_META[m.vibe].emoji} {vibeLabel(m.vibe)}</span>}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div className="full-page full-page--tab">
            <div className="tab-app-header">
              {renderAppHeader()}
            </div>
            <div className="page-header">
              <span className="page-title">{t('here.title')}</span>
            </div>

            {/* ── Filters ── */}
            <div className="here-filters">
              <div className="here-filter-row">
                <span className="here-filter-label">{t('here.filterBadge')}</span>
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
                <span className="here-filter-label">{t('here.filterVibe')}</span>
                <div className="here-filter-chips">
                  {VIBE_FILTER_OPTIONS.map(opt => (
                    <button key={opt.key}
                      className={`here-chip${filterVibe === opt.key ? ' here-chip--on' : ''}`}
                      onClick={() => setFilterVibe(v => v === opt.key ? null : opt.key)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="here-filter-row">
                <span className="here-filter-label">{t('here.filterMode')}</span>
                <div className="here-filter-chips">
                  {MODE_FILTER_OPTIONS.map(opt => (
                    <button key={opt.key}
                      className={`here-chip${filterMode === opt.key ? ` here-chip--on-${opt.key}` : ''}`}
                      onClick={() => setFilterMode(v => v === opt.key ? null : opt.key)}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="page-body people-page-body" ref={hereBodyRef}>

              {/* ── Section 1: Here now ── */}
              <div className="here-section-header">
                <span className="here-section-dot here-section-dot--live" />
                {t('here.hereNow')} · {filteredOnline.length}
              </div>
              {filteredOnline.length === 0
                ? <p className="here-section-empty">{t('here.noMatchLive')}</p>
                : filteredOnline.map(renderOnlineUser)
              }

              {/* ── Section 2: Local legends ── */}
              {legends.length > 0 && (
                <>
                  <div className="here-section-header here-section-header--legends" style={{ marginTop: 20 }}>
                    👑 {t('here.legends')}
                    <span className="here-legends-hook">{t('here.legendsSub')}</span>
                  </div>
                  {legends.map(m => {
                    const [c1, c2] = avatarColors(m.displayName)
                    return (
                      <div key={m.id} className="people-drawer-row people-drawer-row--tappable people-drawer-row--legend"
                        onClick={() => openProfile(m.id, m.displayName)}
                      >
                        {m.avatarUrl
                          ? <img className="online-avatar" src={m.avatarUrl} alt={m.displayName} style={{ objectFit: 'cover' }} />
                          : <span className="online-avatar online-avatar--legend" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                              {(m.displayName ?? '?')[0].toUpperCase()}
                            </span>
                        }
                        <div className="people-drawer-content">
                          <span className="people-drawer-name">{m.displayName}</span>
                          <div className="people-drawer-meta">
                            {(m.badges ?? []).map(k => (
                              <span key={k} className={`badge-pill badge-pill--${k}`}>{badgeLabel(k)}</span>
                            ))}
                            {m.vibe && VIBE_META[m.vibe] && <span className="vibe-badge">{VIBE_META[m.vibe].emoji} {vibeLabel(m.vibe)}</span>}
                          </div>
                          {m.ambassadorPicks && (() => {
                            const first = m.ambassadorPicks.tip ?? m.ambassadorPicks.restaurant ?? m.ambassadorPicks.spot ?? m.ambassadorPicks.story
                            return first ? <span className="legend-pick-preview">💡 {first}</span> : null
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}

              {/* ── Section 3: City crew ── */}
              <div className="here-section-header" style={{ marginTop: 20 }}>
                🏙️ {t('here.cityCrew')}
              </div>
              {crewLoading && crewMembers.length === 0
                ? <p className="here-section-empty">{t('loading', { ns: 'common' })}</p>
                : crewMembers.length === 0
                  ? <p className="here-section-empty">{t('here.noMatchCrew')}</p>
                  : crewMembers.map(renderCrewMember)
              }
              {crewHasMore && (
                <button className="here-load-more" onClick={loadMoreCrew} disabled={crewLoading}>
                  {crewLoading ? t('loading', { ns: 'common' }) : t('here.loadMore')}
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

      {viewingVenueId && (
        <VenueScreen
          venueId={viewingVenueId}
          onBack={() => {
            setViewingVenueId(null)
            // If the cold-load URL was /venue/, send user to home so the
            // landing flow takes over rather than a blank app shell.
            if (window.location.pathname.startsWith('/venue/')) {
              window.location.assign('/')
            }
          }}
          onOpenCity={(cityInfo) => {
            // Navigate to the venue's city page — full page nav, lets the
            // normal city deep-link flow handle join + render.
            window.location.assign(`/city/${cityInfo.slug}`)
          }}
        />
      )}

      {viewingProfile && (
        <PublicProfileScreen
          userId={viewingProfile.userId}
          cityName={city}
          cityCountry={cityCountry}
          account={account}
          guest={guest}
          onBack={() => setViewingProfile(null)}
          onViewProfile={(uid, nickname) => openProfile(uid, nickname)}
          onOpenHangout={(h) => { setViewingProfile(null); openHangout(h) }}
          onOpenChallenge={(c) => { setViewingProfile(null); setActiveChallenge(c) }}
          onOpenLightbox={setLightboxUrl}
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

      {showConversations && !activeDm && account && (
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
          friendRequestCount={friendReqCount}
          onOpenFriendRequests={() => { setShowProfileDrawer(false); setShowFriendRequests(true) }}
          cityTimezone={cityTimezone}
          tabMode
          renderAppHeader={renderAppHeader}
          onSave={setAccount}
          onViewFriend={(uid, nickname) => {
            setShowProfileDrawer(false)
            openProfile(uid, nickname)
          }}
          onSelectEvent={(ev) => { setShowProfileDrawer(false); handleSelectEvent(ev) }}
          onOpenHangout={(h) => { setShowProfileDrawer(false); openHangout(h) }}
          onOpenChallenge={(c) => { setShowProfileDrawer(false); setActiveChallenge(c) }}
          onOpenThreads={() => { setShowProfileDrawer(false); setShowThreadsList(true) }}
          onDeleteEvent={async (ev) => {
            try {
              await deleteEvent(ev.id, guest?.guestId ?? '')
              setMyEvents(prev => prev.filter(e => e.id !== ev.id))
              setEvents(prev => prev.filter(e => e.id !== ev.id))
              if (activeEvent?.id === ev.id) handleBackToCity()
            } catch (_) {}
          }}
          onSignOut={async () => {
            track('auth_logout')
            resetAnalytics()
            // Halt outbound work BEFORE invalidating auth so cleanup endpoints
            // still see a valid cookie:
            //   1. tear down the WS so the reconnect timer doesn't replay the
            //      old user's joinRoom/joinUser against a now-invalid session
            //      (1006 loop)
            //   2. unsubscribe push while the cookie is still good
            // Only THEN clear the auth flag and call authLogout().
            socketRef.current?.disconnect()
            socketRef.current = null
            await unregisterPush()
            await authLogout()
            localStorage.removeItem(AUTH_FLAG_KEY) // next boot is guest — skip authMe()
            setAccount(null)
            clearIdentity()       // prevent auto-rejoin on next boot
            // Reset geolocation so the next join triggers a fresh city resolution
            // rather than silently reusing the member's stale location.
            locPromiseRef.current = startGeolocation()
            // Clear all overlay state so authenticated screens don't re-mount
            // if the user re-enters the app as a guest in the same session.
            setShowConversations(false)
            setShowNotifications(false)
            setActiveDm(null)
            setViewingProfile(null)
            setStatus('onboarding')
            setShowProfileDrawer(false)
          }}
          onDeleteAccount={async () => {
            // Account is already soft-deleted + session cleared by the API.
            // Mirror the same client-side teardown as Sign out.
            track('account_deleted')
            resetAnalytics()
            // Account API has already invalidated the cookie, but the WS
            // reconnect timer would still replay joinRoom/joinUser against
            // a now-invalid session — tear it down before clearing state.
            socketRef.current?.disconnect()
            socketRef.current = null
            await unregisterPush()
            localStorage.removeItem(AUTH_FLAG_KEY)
            setAccount(null)
            clearIdentity()
            setShowConversations(false)
            setShowNotifications(false)
            setActiveDm(null)
            setViewingProfile(null)
            setStatus('onboarding')
            setShowProfileDrawer(false)
          }}
        />
      )}

      {showProfileDrawer && !showAuthScreen && !account && (
        <div className="full-page full-page--tab">
          <div className="tab-app-header">
            {renderAppHeader()}
          </div>
          <div className="page-header">
            <span className="page-title">Me</span>
          </div>
          <div className="page-body me-page-body" ref={meGuestBodyRef}>
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
                        <p className="me-hero-sub">{t('nickname.heroSub')}</p>
                      </div>
                    </div>
                  </div>
                )
              })()}
              <div className="me-card">
                <div className="modal-field">
                  <label className="modal-label">{t('nickname.label')}</label>
                  <input
                    className="modal-input"
                    type="text"
                    value={profileNickInput}
                    onChange={(e) => setProfileNickInput(e.target.value)}
                    maxLength={20}
                    placeholder={t('nickname.placeholder')}
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
                >{t('nickname.save')}</button>
              </div>
              <div className="me-card">
                <div className="me-upgrade">
                  <p className="me-upgrade-hint">{t('nickname.upgradeHint')}</p>
                  <button className="me-upgrade-btn" onClick={() => { setShowAuthScreenTab('signup'); setShowAuthScreen(true) }}>
                    {t('guestGate.createAccount')}
                  </button>
                  <p className="me-upgrade-signin-hint">{t('nickname.haveAccount')}</p>
                  <button className="me-upgrade-btn me-upgrade-btn--secondary" onClick={() => { setShowAuthScreenTab('login'); setShowAuthScreen(true) }}>
                    {t('guestGate.signIn')}
                  </button>
                </div>
              </div>
              {myEventsLoaded && myEvents.length > 0 && (
                <div className="me-card">
                  <p className="me-section-label">{t('nickname.myEvents')}</p>
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
                <p className="profile-hint">{t('nickname.anonymous')}</p>
            </>
          </div>
        </div>
      )}

      {showProfileDrawer && showAuthScreen && (
        <AuthScreen
          guestId={guest?.guestId}
          guestNickname={nickname}
          initialTab={showAuthScreenTab}
          onSuccess={(user, isSignup) => {
            localStorage.setItem(AUTH_FLAG_KEY, '1') // skip useless authMe() 401 on next boot
            accountRef.current = user // sync ref so closures see updated identity immediately
            setAccount(user)
            setShowAuthScreen(false)
            setShowProfileDrawer(false)
            if (isSignup) setShowAccountWelcome(true)
            identifyUser(user.id, { account_type: 'registered', username: user.display_name })
            setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null })
            track('user_authenticated')
          }}
          onBack={() => setShowAuthScreen(false)}
          onForgotPassword={() => { setShowAuthScreen(false); setShowForgotPassword(true) }}
        />
      )}

      {showForgotPassword && (
        <ForgotPasswordScreen
          onBack={() => { setShowForgotPassword(false); setShowAuthScreen(true); setShowAuthScreenTab('login') }}
        />
      )}

      {/* Friend requests inbox — full-screen page */}
      {showFriendRequests && (
        <FriendRequestsScreen
          wsClient={socketRef.current}
          onBack={() => setShowFriendRequests(false)}
          onViewProfile={(uid) => { setShowFriendRequests(false); openProfile(uid, '') }}
        />
      )}

      {/* Notifications — full-screen page */}
      {showNotifications && (
        <NotificationsScreen
          account={account}
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
            } else if (notif.type === 'mention') {
              // Route to the message's context: event chat, pulse, or city chat.
              if (d.eventId) {
                const ev = events.find(e => e.id === d.eventId) ?? cityEvents.find(e => e.id === d.eventId)
                if (ev) handleSelectEvent(ev); else setShowEventDrawer(true)
              } else if (d.topicId) {
                const t = (topics || []).find(tp => tp.id === d.topicId)
                if (t) setActiveTopic(t)
              }
              // city-channel mentions: closing the panel returns to the city chat.
            } else if (notif.type === 'friend_request_received') {
              setShowFriendRequests(true)
            } else if (notif.type === 'friend_request_accepted' && d.accepterUserId) {
              openProfile(d.accepterUserId, d.accepterName ?? '')
            } else if (notif.type === 'friend_added' && d.senderUserId) {
              // Legacy notifications from before the request flow shipped
              openProfile(d.senderUserId, d.senderName ?? '')
            } else if (notif.type === 'vibe_received') {
              setShowProfileDrawer(true)
            } else if (notif.type === 'profile_view' && d.viewerId) {
              openProfile(d.viewerId, d.viewerName ?? '')
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

      {/* Going list modal — public, no auth gate */}
      {showGoingModal && (
        <div className="modal-overlay" onClick={() => setShowGoingModal(false)}>
          <div className="modal-panel going-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                👥 {goingList.length || (activeEvent && (eventParticipants[activeEvent.id] ?? 0))} {membersNoun === 'in this hangout' ? t('goingModal.inThisHangout') : t('goingModal.going')}
              </span>
              <button className="going-modal-close" onClick={() => setShowGoingModal(false)}>✕</button>
            </div>
            <div className="going-modal-body">
              {goingListLoading ? (
                <p className="going-modal-empty">{t('goingModal.loading')}</p>
              ) : goingList.length === 0 ? (
                <p className="going-modal-empty">{t('goingModal.empty')}</p>
              ) : (
                goingList.map(p => {
                  const isRegistered = p.accountType === 'registered'
                  const [c1, c2] = avatarColors(p.id)
                  const badgeKey = p.badges?.[0]
                  return (
                    <div
                      key={p.id}
                      className={`people-drawer-row${isRegistered ? ' people-drawer-row--tappable' : ''}`}
                      onClick={isRegistered ? () => { setShowGoingModal(false); openProfile(p.id, p.displayName) } : undefined}
                    >
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} className="online-avatar" alt="" />
                      ) : (
                        <span className="online-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                          {(p.displayName ?? '?')[0].toUpperCase()}
                        </span>
                      )}
                      <div className="people-drawer-content">
                        <span className="people-drawer-name">{p.displayName}</span>
                        {(badgeKey || p.vibe) && (
                          <div className="people-drawer-meta">
                            {badgeKey && <span className={`badge-pill badge-pill--${badgeKey}`}>{badgeLabel(badgeKey)}</span>}
                            {p.vibe && VIBE_META[p.vibe] && (
                              <span className="vibe-badge">{VIBE_META[p.vibe].emoji} {vibeLabel(p.vibe)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Guest gate — shown when a ghost user tries a member-only action */}
      {guestGate && (() => {
        const reason   = GUEST_GATE_COPY[guestGate.reason] ? guestGate.reason : 'view_profile'
        const emoji    = GUEST_GATE_COPY[reason].emoji
        const openAuth = () => { setGuestGate(null); setShowProfileDrawer(true); setShowAuthScreen(true) }
        return (
          <div className="full-page">
            <div className="page-header">
              <BackButton onClick={() => setGuestGate(null)} />
              <span className="page-title">{t(`guestGate.${reason}.pageTitle`)}</span>
            </div>
            <div className="guest-gate">
              <span className="guest-gate-emoji">{emoji}</span>
              <h2 className="guest-gate-title">{t(`guestGate.${reason}.title`)}</h2>
              <p className="guest-gate-sub">{t(`guestGate.${reason}.sub`)}</p>
              <button className="modal-submit" onClick={openAuth}>{t('guestGate.createAccount')}</button>
              <button className="modal-submit modal-submit--secondary" onClick={openAuth}>{t('guestGate.signIn')}</button>
            </div>
          </div>
        )
      })()}

      {/* Create event — full-screen page */}
      {showCreateEvent && (
        <CreateEventPage
          channelId={channelId}
          guest={guest}
          nickname={activeNickname}
          cityTimezone={cityTimezone}
          account={account}
          onCreated={handleEventCreated}
          onLimitReached={() => {
            setShowCreateEvent(false)
            setCreateFromDrawer(false)
            setShowEventLimitReached(true)
          }}
          onBack={() => {
            setShowCreateEvent(false)
            if (createFromDrawer) { setShowEventDrawer(true) }
            setCreateFromDrawer(false)
          }}
        />
      )}

      {/* Create topic — full-screen page */}
      {(showCreateTopic || editTopic) && (
        <CreateTopicPage
          channelId={channelId}
          guest={guest}
          userLocation={userLocation}
          editTopic={editTopic}
          onCreated={handleTopicCreated}
          onUpdated={(t) => { setEditTopic(null); if (t) setActiveTopic(t) }}
          onGoToHangout={goToHangoutById}
          onBack={() => { setShowCreateTopic(false); setEditTopic(null) }}
        />
      )}

      {/* Challenge create / edit — orange-brand full-page modal. Same
          component handles both modes via the editChallenge prop. On create
          success, lands on the new challenge's detail page. On edit success,
          reopens the same detail page with the updated data. */}
      {(showCreateChallenge || editChallengeObj) && (
        <CreateChallengePage
          channelId={channelId}
          guest={guest}
          account={account}
          editChallenge={editChallengeObj}
          onCreated={(ch) => {
            setShowCreateChallenge(false)
            setActiveChallenge(ch)
            // Fire the post-create "seed it" modal so the creator is nudged
            // to invite city members or share externally right away.
            setPostCreateChallenge(ch)
          }}
          onUpdated={(ch) => { setEditChallengeObj(null); setActiveChallenge(ch) }}
          onBack={() => { setShowCreateChallenge(false); setEditChallengeObj(null) }}
        />
      )}

      {/* Post-create "seed it" floating modal. Two CTAs: invite city members
          to take it on (with push) OR share externally. Fires once per create. */}
      {postCreateChallenge && (
        <ChallengePostCreateModal
          challenge={postCreateChallenge}
          cityChannelId={channelId}
          cityName={city}
          currentUserId={account?.id ?? null}
          onClose={() => setPostCreateChallenge(null)}
          onShare={async () => {
            try {
              await navigator.share?.({
                title: postCreateChallenge.title,
                text:  postCreateChallenge.title,
                url:   `${window.location.origin}/challenge/${postCreateChallenge.id}`,
              })
            } catch {
              // Fallback: copy URL to clipboard.
              try { await navigator.clipboard?.writeText(`${window.location.origin}/challenge/${postCreateChallenge.id}`) } catch {}
            }
          }}
        />
      )}

      {/* Event limit reached — friendly full-page over the feed/drawer. */}
      {showEventLimitReached && (
        <EventLimitReachedScreen
          onClose={() => setShowEventLimitReached(false)}
          guest={guest}
          cityTimezone={cityTimezone}
          onSelectEvent={handleSelectEvent}
        />
      )}

      {/* Creation chooser bottom sheet — challenge (the new primary CTA) on
          top per the product spec, hangout (instant) in the middle, event
          (planned) at the bottom. Mirrors the mobile CreateSheet ordering. */}
      {showCreateChooser && (
        <div className="create-chooser-overlay" onClick={() => setShowCreateChooser(false)}>
          <div className="create-chooser-sheet" onClick={e => e.stopPropagation()}>
            <div className="create-chooser-handle" />
            <p className="create-chooser-title">{t('create.title')}</p>
            <button
              className="create-chooser-option create-chooser-option--challenge"
              onClick={() => {
                setShowCreateChooser(false)
                openCreateChallenge()
              }}
            >
              <span className="create-chooser-icon">🔥</span>
              <span className="create-chooser-label">
                <strong>{t('create.challengeTitle')}</strong>
                <span>{t('create.challengeSub')}</span>
              </span>
              <span className="create-chooser-arrow">→</span>
            </button>
            <button
              className="create-chooser-option"
              onClick={() => {
                setShowCreateChooser(false)
                openCreateHangout()
              }}
            >
              <span className="create-chooser-icon">🗣️</span>
              <span className="create-chooser-label">
                <strong>{t('create.hangoutTitle')}</strong>
                <span>{t('create.hangoutSub')}</span>
              </span>
              <span className="create-chooser-arrow">→</span>
            </button>
            <button
              className="create-chooser-option"
              onClick={() => { setShowCreateChooser(false); openCreateEvent() }}
            >
              <span className="create-chooser-icon">🎉</span>
              <span className="create-chooser-label">
                <strong>{t('create.eventTitle')}</strong>
                <span>{t('create.eventSub')}</span>
              </span>
              <span className="create-chooser-arrow">→</span>
            </button>
          </div>
        </div>
      )}

      {/* Topic chat — full-screen page */}
      {activeTopic && (
        <TopicChatPage
          topic={activeTopic}
          guest={guest}
          nickname={activeNickname}
          account={account}
          onBack={() => setActiveTopic(null)}
          onEdit={(t) => { setActiveTopic(null); setEditTopic(t) }}
          onDeleted={() => setActiveTopic(null)}
          socket={socketRef.current}
          sessionId={PAGE_SESSION_ID}
          onViewProfile={openProfile}
        />
      )}

      {/* Challenge chat — Phase 10 web-side detail screen. Reuses the
          topic-chat-page CSS skeleton for consistent layout; brand-orange
          accents come from the inline challenge-* classes (see App.css). */}
      {activeChallenge && (
        <ChallengeChatPage
          challenge={activeChallenge}
          guest={guest}
          nickname={activeNickname}
          account={account}
          onBack={() => {
            // Back lands on the Now feed (where the user usually arrives
            // from anyway), not the city chat — matches the mental model
            // "I was browsing challenges, take me back to browsing".
            setActiveChallenge(null)
            setShowEventDrawer(true)
          }}
          onEdit={(ch) => { setActiveChallenge(null); setEditChallengeObj(ch) }}
          onDeleted={() => setActiveChallenge(null)}
          onNeedAuth={(reason) => { setActiveChallenge(null); setGuestGate({ reason }) }}
          onOpenMyProfile={() => {
            // mode_required / mode_mismatch alert offers "Open my profile" —
            // the profile drawer is where you switch local/exploring.
            if (account?.id) {
              setActiveChallenge(null);
              setViewingProfile({ userId: account.id, nickname: account.display_name });
            }
          }}
          socket={socketRef.current}
          sessionId={PAGE_SESSION_ID}
        />
      )}

      {/* PR2 — per-acceptance 1:1 thread chat */}
      {activeThreadChannelId && (
        <ThreadChatPage
          threadChannelId={activeThreadChannelId}
          guest={guest}
          account={account}
          onBack={() => setActiveThreadChannelId(null)}
          onCancelled={() => setActiveThreadChannelId(null)}
          socket={socketRef.current}
          sessionId={PAGE_SESSION_ID}
        />
      )}

      {/* PR2 — "My challenge threads" index. Taps now route to the challenge
          channel (where the inline thread chat lives) — single surface, no
          intermediate /thread step. */}
      {showThreadsList && (
        <ThreadsListPage
          account={account}
          socket={socketRef.current}
          onBack={() => setShowThreadsList(false)}
          onOpenChallenge={(c) => { setShowThreadsList(false); setActiveChallenge(c) }}
        />
      )}

      {/* Desktop-only sidebar — always rendered to preserve 3-column layout */}
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

      {/* Lightbox */}
      {/* Guest got @mentioned while online — discreet, non-blocking signup nudge. */}
      {mentionNudge && !account && (
        <div className="mention-nudge" role="status">
          <span className="mention-nudge-text">👀 You're getting mentioned! Create an account so you never miss it.</span>
          <button className="mention-nudge-btn" onClick={() => { setMentionNudge(false); setShowAuthScreenTab('signup'); setShowAuthScreen(true) }}>Sign up</button>
          <button className="mention-nudge-dismiss" onClick={() => setMentionNudge(false)} aria-label="Dismiss">×</button>
        </div>
      )}

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />

      <ReactionBurstLayer
        bursts={reactionBursts}
        onDone={id => setReactionBursts(prev => prev.filter(b => b.id !== id))}
      />

      {/* "How challenges work" carousel — opened from the city-chat feed
          prompt. Independent of the first-time onboarding (which covers
          general intro). Can be triggered any time. */}
      {showChallengeIntro && (
        <ChallengeIntroCarousel onClose={() => setShowChallengeIntro(false)} />
      )}

      {/* First-time guest onboarding carousel (also re-openable via header "?"). */}
      {showOnboarding && (
        <OnboardingCarousel
          city={localizeCityName(city)}
          onSignup={() => {
            markOnboardingSeen()
            setShowOnboarding(false)
            setShowAuthScreenTab('signup')
            setShowProfileDrawer(true)
            setShowAuthScreen(true)
          }}
          onClose={() => {
            markOnboardingSeen()
            setShowOnboarding(false)
          }}
        />
      )}

      {/* One-time congrats screen, shown right after account creation (signup only). */}
      {showAccountWelcome && account && (
        <AccountWelcome
          username={account.username ?? account.display_name ?? ''}
          onClose={() => setShowAccountWelcome(false)}
        />
      )}
    </div>
  )
}
