import { useEffect, useState } from 'react'
import { useDc } from '../daily/dailyShared'

/**
 * Seasonal events (Admin › Daily › Seasonal events), the app's
 * features/event: the server says which event is on today's challenge date
 * and its phase (GET /daily/today `event`); the look lives here by theme key.
 * An unknown key, no event or an error = the normal look.
 *
 * - teaser: the countdown banner under Today's hero, the event's day in the week strip
 * - live: the palette on the Daily screens (data-event, index.css), the hero's
 *   decorations, copy overrides, tile badges, the logo's hat
 * - recap (the day after): a touch on the Yesterday card
 * The web has no camera (photos are posted from the app): no bat burst.
 */
export const SEASONAL_THEMES = {
  halloween: {
    emoji: '🎃',
    // i18n keys under challenge:dc.
    copy: {
      teaser: 'event.halloween.teaser',
      cta: 'event.halloween.cta',
      ctaNoCity: 'event.halloween.ctaNoCity',
      played: 'event.halloween.played',
      represent: 'event.halloween.represent',
    },
  },
}

// Today's last answer: every Daily screen reads it.
let current = null
const listeners = new Set()

// Dev only (npm run dev): ?event=halloween&phase=teaser|live|recap forces a look
// without the back office. Production builds drop this (import.meta.env.DEV).
const forced = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const key = q.get('event')
  if (!key) return null
  const phase = ['teaser', 'live', 'recap'].includes(q.get('phase')) ? q.get('phase') : 'live'
  const today = new Date().toISOString().slice(0, 10)
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const start = phase === 'teaser' ? day(2) : phase === 'recap' ? day(-1) : today
  return { id: `dev-${key}`, theme: key, phase, start, end: start, startsInDays: phase === 'teaser' ? 2 : null, preview: true }
})()

/** Today's fetch: the event of the day, kept only when this build knows its theme. */
export function setSeasonalEvent(event) {
  if (forced) event = forced
  const theme = event ? SEASONAL_THEMES[event.theme] : null
  const next = event && theme ? { event, theme, key: event.theme } : null
  if (next?.event.id === current?.event.id && next?.event.phase === current?.event.phase
      && next?.event.startsInDays === current?.event.startsInDays) return
  current = next
  // Live: the whole app wears the palette (index.css html[data-event]): every
  // tab, the bottom bar, the sheets.
  if (typeof document !== 'undefined') {
    if (next?.event.phase === 'live') document.documentElement.setAttribute('data-event', next.key)
    else document.documentElement.removeAttribute('data-event')
  }
  listeners.forEach(l => l())
}

/** The event on today's challenge date with a known theme, else null. */
export function useSeasonal() {
  const [value, setValue] = useState(current)
  useEffect(() => {
    const l = () => setValue(current)
    listeners.add(l)
    l()
    return () => { listeners.delete(l) }
  }, [])
  return value
}

/** The live phase's theme, else null. */
export function useSeasonalLive() {
  const s = useSeasonal()
  return s?.event.phase === 'live' ? s : null
}

/** A date (YYYY-MM-DD) is one of the event's days (the week strip's icon). */
export function isEventDay(s, date) {
  return !!s && !!date && date >= s.event.start && date <= s.event.end
}

/** The live palette on a Daily screen's root: spread on its element (index.css [data-event]). */
export function useSeasonalAttr() {
  const live = useSeasonalLive()
  return live ? { 'data-event': live.key } : {}
}

/** Wraps a Daily screen: its live palette, without a box of its own (display: contents). */
export function SeasonalZone({ children }) {
  const attr = useSeasonalAttr()
  return <div className="seasonal-zone" {...attr}>{children}</div>
}

/** Teaser: the countdown banner under Today's hero ("🎃 Halloween hunt in 2 days..."). */
export function SeasonalTeaser() {
  const s = useSeasonal()
  const { t } = useDc()
  if (!s || s.event.phase !== 'teaser') return null
  return (
    <div className="seasonal-teaser" role="status">
      {s.key === 'halloween' && <Ghost size={22} />}
      <span>{t(s.theme.copy.teaser, { count: s.event.startsInDays ?? 1 })}</span>
    </div>
  )
}

/** The live hero's decorations: cobwebs in the top corners, 3 ghosts floating slowly (still with reduced motion). */
export function SeasonalHeroDecor() {
  const live = useSeasonalLive()
  if (live?.key !== 'halloween') return null
  return (
    <div className="seasonal-decor" aria-hidden="true">
      <Cobweb className="seasonal-web seasonal-web--left" />
      <Cobweb className="seasonal-web seasonal-web--right" />
      <span className="seasonal-ghost" style={{ left: '14%', top: '30%', '--d': '3.4s', '--delay': '0s' }}><Ghost size={26} /></span>
      <span className="seasonal-ghost" style={{ left: '72%', top: '22%', '--d': '4.1s', '--delay': '.7s' }}><Ghost size={20} /></span>
      <span className="seasonal-ghost" style={{ left: '48%', top: '12%', '--d': '3.8s', '--delay': '1.4s' }}><Ghost size={16} /></span>
    </div>
  )
}

/** A witch hat on the header's "Hi" mark (or the passport photo: `size`) while the event is live. */
export function LogoHat({ size = 25, className = 'seasonal-hat' }) {
  const live = useSeasonalLive()
  if (live?.key !== 'halloween') return null
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.2 18.2 12.6 3.4c.4-1 1.7-1.3 2.4-.4l.4.6-1.6 1 2.2 13.6z" fill="#3B2266" />
      <rect x="8.3" y="14.6" width="8.6" height="2.4" rx="0.6" fill="#FF8A1F" />
      <ellipse cx="12" cy="18.6" rx="10.5" ry="2.6" fill="#2A1850" />
    </svg>
  )
}

/** An event day's icon in the week strip (Halloween: a pumpkin, Ionicons' stroke), else null. */
export function SeasonalDayIcon({ themeKey, size }) {
  if (themeKey !== 'halloween') return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7c-1.2-.9-3-1.2-4.6-.6C4.6 7.5 3 10 3 13.1 3 17.2 5.9 20.5 9.3 20.5c1 0 1.9-.3 2.7-.8.8.5 1.7.8 2.7.8 3.4 0 6.3-3.3 6.3-7.4 0-3.1-1.6-5.6-4.4-6.7-1.6-.6-3.4-.3-4.6.6z" />
      <path d="M12 7c-1.5 1.6-2.3 3.9-2.3 6.3s.8 4.8 2.3 6.4" />
      <path d="M12 7c1.5 1.6 2.3 3.9 2.3 6.3s-.8 4.8-2.3 6.4" />
      <path d="M12 7c0-1.7.7-3 2.2-3.6" />
    </svg>
  )
}

/** A tab header's live touch (Hi, Map, Passport): a cobweb in the corner, ghosts floating over the drawing. */
export function SeasonalHeaderDecor() {
  const live = useSeasonalLive()
  if (live?.key !== 'halloween') return null
  return (
    <div className="seasonal-header-decor" aria-hidden="true">
      <Cobweb className="seasonal-web seasonal-web--right" />
      <span className="seasonal-ghost" style={{ right: '96px', top: '18px', '--d': '3.6s', '--delay': '0s' }}><Ghost size={24} /></span>
      <span className="seasonal-ghost" style={{ right: '40px', top: '52px', '--d': '4.2s', '--delay': '.9s' }}><Ghost size={15} /></span>
    </div>
  )
}

/** The bottom bar's live touch: a little ghost peeking over the active tab (hops in, then bobs). */
export function TabGhost() {
  const live = useSeasonalLive()
  if (live?.key !== 'halloween') return null
  return <span className="seasonal-tab-ghost" aria-hidden="true"><Ghost size={20} /></span>
}

/** The map's live sky: a crescent moon and bats crossing under the search bar. */
export function SeasonalMapSky() {
  const live = useSeasonalLive()
  if (live?.key !== 'halloween') return null
  return (
    <div className="seasonal-sky" aria-hidden="true">
      <svg className="seasonal-moon" width="54" height="54" viewBox="0 0 54 54">
        <circle cx="27" cy="27" r="24" fill="#FFE7B0" opacity="0.18" />
        <path d="M33 8a19 19 0 1 0 13 30A16 16 0 0 1 33 8z" fill="#FFD27A" />
      </svg>
      <span className="seasonal-bat" style={{ top: '24px', '--d': '9s', '--delay': '0s' }}><Bat size={44} /></span>
      <span className="seasonal-bat" style={{ top: '78px', '--d': '12.5s', '--delay': '3.2s' }}><Bat size={32} /></span>
      <span className="seasonal-bat" style={{ top: '48px', '--d': '15s', '--delay': '6.8s' }}><Bat size={24} /></span>
    </div>
  )
}

function Bat({ size }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 24 14.4">
      <path d="M12 4.2c-.5-1.3-1.3-2-2-2.2.3.7.3 1.4 0 1.9C8.4 2.6 5.6 1.6 1 3.4c1.9.6 3 1.9 3.2 3.6 1.6-.9 3.3-.6 4.4.5.9.9 1.7 2.3 3.4 4.3 1.7-2 2.5-3.4 3.4-4.3 1.1-1.1 2.8-1.4 4.4-.5.2-1.7 1.3-3 3.2-3.6-4.6-1.8-7.4-.8-9 .5-.3-.5-.3-1.2 0-1.9-.7.2-1.5.9-2 2.2z"
            fill="#2A1850" stroke="#C3B5DE" strokeWidth="0.6" strokeLinejoin="round" />
      <circle cx="11.1" cy="4.9" r="0.45" fill="#FF8A1F" />
      <circle cx="12.9" cy="4.9" r="0.45" fill="#FF8A1F" />
    </svg>
  )
}

function Ghost({ size }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 24 27.6" aria-hidden="true">
      <path d="M12 1.5C6.8 1.5 3.5 5.4 3.5 10.4V26l2.8-2.1 2.9 2.1 2.8-2.1 2.8 2.1 2.9-2.1 2.8 2.1V10.4c0-5-3.3-8.9-8.5-8.9z"
            fill="#FFFFFF" fillOpacity="0.92" />
      <ellipse cx="9.2" cy="11" rx="1.4" ry="1.9" fill="#1A1030" />
      <ellipse cx="14.8" cy="11" rx="1.4" ry="1.9" fill="#1A1030" />
      <path d="M10.4 15.2c.9.9 2.3.9 3.2 0" stroke="#1A1030" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

// A corner cobweb: 5 threads from the corner, 3 sagging rings.
const WEB = (() => {
  const angles = [0, 22.5, 45, 67.5, 90].map(a => (a * Math.PI) / 180)
  const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)]
  const threads = angles.map(a => { const [x, y] = pt(64, a); return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}` })
  const rings = [18, 34, 50].map(r => angles.slice(1).reduce((d, a, i) => {
    const [x0, y0] = pt(r, angles[i])
    const [x1, y1] = pt(r, a)
    const [cx, cy] = pt(r * 0.82, (angles[i] + a) / 2)   // sags toward the corner
    return `${d}${i === 0 ? `M${x0.toFixed(1)} ${y0.toFixed(1)}` : ''}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }, ''))
  return [...threads, ...rings]
})()

function Cobweb({ className }) {
  return (
    <svg className={className} width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="1.3" aria-hidden="true">
      {WEB.map(d => <path key={d} d={d} />)}
    </svg>
  )
}
