import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import BackButton from './BackButton'
import { fetchUpcomingEvents, fetchCalendarSummary } from '../api'
import { formatTime, getEventLocation } from '../eventUtils'

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}

// Strip reaches 90 days; modal calendar 180 — same asymmetry as native.
const STRIP_DAYS = 90
const MAX_MODAL  = 180

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_TINY  = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// ── Date helpers (operate in local browser tz; we only render city tz on cards)

function startOfDay(d) {
  const c = new Date(d); c.setHours(0, 0, 0, 0); return c
}
function addDays(d, n)   { const c = new Date(d); c.setDate(c.getDate() + n); return c }
function isSameDay(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate() }
function localYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

// ── Month modal — full-month grid w/ event dots ───────────────────────────────

function MonthModal({ visibleMonth, summary, selected, onPick, onClose }) {
  const [view, setView] = useState(() => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1))
  const today    = startOfDay(new Date())
  const maxDate  = startOfDay(addDays(today, MAX_MODAL))
  const monthLbl = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const firstDow    = new Date(view.getFullYear(), view.getMonth(), 1).getDay()
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)

  const prevDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth()
  const nextDisabled = view.getFullYear() === maxDate.getFullYear() && view.getMonth() === maxDate.getMonth()

  return (
    <div className="upc-modal-overlay" onClick={onClose}>
      <div className="upc-modal-box" onClick={e => e.stopPropagation()}>
        <div className="upc-modal-header">
          <button
            type="button"
            className="upc-modal-nav"
            disabled={prevDisabled}
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          >‹</button>
          <span className="upc-modal-title">{monthLbl}</span>
          <button
            type="button"
            className="upc-modal-nav"
            disabled={nextDisabled}
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          >›</button>
        </div>
        <div className="upc-modal-row">
          {DOW_TINY.map(d => <span key={d} className="upc-modal-dow">{d}</span>)}
        </div>
        {Array.from({ length: cells.length / 7 }).map((_, row) => (
          <div className="upc-modal-row" key={row}>
            {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
              if (!cell) return <span key={i} className="upc-modal-cell" />
              const disabled = cell < today || cell > maxDate
              const isSel    = isSameDay(cell, selected)
              const dot      = (summary[localYmd(cell)] ?? 0) > 0
              return (
                <button
                  key={i}
                  type="button"
                  className={`upc-modal-cell${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                  disabled={disabled}
                  onClick={() => { onPick(cell); onClose() }}
                >
                  <span className="upc-modal-cell-num">{cell.getDate()}</span>
                  {dot && <span className={`upc-modal-cell-dot${isSel ? ' selected' : ''}`} />}
                </button>
              )
            })}
          </div>
        ))}
        <button type="button" className="upc-modal-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function UpcomingEventsScreen({ channelId, timezone, onBack, onSelectEvent }) {
  const tz = timezone || 'UTC'

  const [selected, setSelected] = useState(() => startOfDay(new Date()))
  const [events,   setEvents]   = useState([])
  const [summary,  setSummary]  = useState({})
  const [status,   setStatus]   = useState('loading')
  const [showMonth,setShowMonth]= useState(false)

  const stripRef = useRef(null)

  const stripDates = useMemo(() => {
    const out = []
    const anchor = startOfDay(new Date())
    for (let i = 0; i <= STRIP_DAYS; i++) out.push(addDays(anchor, i))
    return out
  }, [])

  // Fetch events for the selected day (single-day range — backend materializes
  // any series occurrences on that date).
  const loadDay = useCallback(async (date) => {
    if (!channelId) return
    setStatus('loading')
    try {
      const ymd = localYmd(date)
      const data = await fetchUpcomingEvents(channelId, { from: ymd, to: ymd })
      setEvents(data.events ?? [])
      setStatus('ok')
    } catch {
      setStatus('error')
    }
  }, [channelId])

  // Fetch the strip-summary once. Range covers the full strip.
  const loadSummary = useCallback(async () => {
    if (!channelId) return
    try {
      const from = localYmd(stripDates[0])
      const to   = localYmd(stripDates[stripDates.length - 1])
      const s = await fetchCalendarSummary(channelId, from, to)
      setSummary(s)
    } catch {
      // soft-fail — strip works without dots
    }
  }, [channelId, stripDates])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadDay(selected) }, [selected, loadDay])

  // Auto-scroll the selected cell into view when the strip mounts.
  useEffect(() => {
    if (!stripRef.current) return
    const idx = stripDates.findIndex(d => isSameDay(d, selected))
    if (idx >= 0) {
      const cellW = 64
      stripRef.current.scrollLeft = Math.max(0, idx * cellW - 16)
    }
    // Only scroll on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pickDate(d) {
    const day = startOfDay(d)
    setSelected(day)
    if (typeof window !== 'undefined' && window.posthog) {
      window.posthog.capture('calendar_day_tapped', { date: localYmd(day) })
    }
  }

  const now = Date.now() / 1000

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">What's coming</span>
        <button
          type="button"
          className="upc-cal-btn"
          aria-label="Open calendar"
          onClick={() => setShowMonth(true)}
        >📅</button>
      </div>

      {/* Day strip */}
      <div className="upc-strip" ref={stripRef}>
        {stripDates.map(d => {
          const isSel  = isSameDay(d, selected)
          const isToday = isSameDay(d, startOfDay(new Date()))
          const dot     = (summary[localYmd(d)] ?? 0) > 0
          return (
            <button
              key={localYmd(d)}
              type="button"
              className={`upc-day${isSel ? ' selected' : ''}`}
              onClick={() => pickDate(d)}
            >
              <span className="upc-day-dow">{isToday ? 'Today' : DOW_SHORT[d.getDay()]}</span>
              <span className="upc-day-num">{d.getDate()}</span>
              <span className="upc-day-dot-slot">
                {dot && <span className={`upc-day-dot${isSel ? ' selected' : ''}`} />}
              </span>
            </button>
          )
        })}
      </div>

      <div className="page-body">
        {status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div className="loading-spinner" />
          </div>
        )}

        {status === 'error' && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">Couldn&apos;t load events for this day</p>
            <button className="events-empty-cta" onClick={() => loadDay(selected)}>Retry</button>
          </div>
        )}

        {status === 'ok' && events.length === 0 && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">Nothing scheduled</p>
            <p className="events-empty-sub">No events on this day yet.</p>
          </div>
        )}

        {status === 'ok' && events.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px' }}>
            {events.map(event => {
              const isLive = event.starts_at <= now && event.expires_at > now
              const isPublic = event.source === 'ticketmaster' || event.source_type === 'ticketmaster'
              const location = getEventLocation(event)
              const icon = EVENT_ICONS[event.type ?? event.event_type] ?? '📌'
              const going = event.participant_count ?? 0

              return (
                <button
                  key={event.id}
                  className={`city-row event-row-card${isLive ? ' event-row--live' : ''}`}
                  onClick={() => onSelectEvent(event)}
                >
                  <div className="er-header">
                    <span className="er-title">{icon} {event.title}</span>
                    {isPublic
                      ? <span className="er-going er-going--public">Public</span>
                      : going > 0 && <span className="er-going">🙌 {going} going</span>}
                  </div>
                  <div className="er-badges">
                    <span className="city-row-current">
                      {isLive ? '🔥 Live now' : `🕐 ${formatTime(event.starts_at, tz)}`}
                      {event.ends_at ? ` → ${formatTime(event.ends_at, tz)}` : ''}
                    </span>
                    {event.recurrence_label && (
                      <span className="recur-badge">↻ {event.recurrence_label}</span>
                    )}
                  </div>
                  {location && <span className="er-location">📍 {location}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showMonth && (
        <MonthModal
          visibleMonth={selected}
          summary={summary}
          selected={selected}
          onPick={pickDate}
          onClose={() => setShowMonth(false)}
        />
      )}
    </div>
  )
}
