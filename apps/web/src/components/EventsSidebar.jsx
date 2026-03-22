import { EVENT_ICONS } from '../cityMeta'

function isToday(unixTs, timezone) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const eventDay = new Date(unixTs * 1000).toLocaleDateString('en-CA', { timeZone: timezone })
  return today === eventDay
}

function formatTime(unixTs, timezone) {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const STATUS_PRIORITY = { now: 0, soon: 1, scheduled: 2 }

function getEventStatus(unixTs) {
  const diffMin = (unixTs * 1000 - Date.now()) / 60000
  if (diffMin >= -30 && diffMin <= 15) return 'now'
  if (diffMin > 15 && diffMin <= 60) return 'soon'
  return 'scheduled'
}

function getTimeLabel(unixTs, timezone) {
  const status = getEventStatus(unixTs)
  if (status === 'now') return '🔥 happening now'
  if (status === 'soon') return '🔥 starting soon'
  return formatTime(unixTs, timezone)
}

export default function EventsSidebar({ events, activeEventId, cityTimezone, onSelectEvent, onCreateClick }) {
  const tz = cityTimezone || 'UTC'
  const todayEvents = events
    .filter(e => isToday(e.starts_at, tz))
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[getEventStatus(a.starts_at)]
      const pb = STATUS_PRIORITY[getEventStatus(b.starts_at)]
      if (pa !== pb) return pa - pb
      return a.starts_at - b.starts_at
    })

  return (
    <aside className="events-sidebar">
      <div className="events-sidebar-header">
        <span className="events-sidebar-title">Events</span>
        <button className="create-event-btn" onClick={onCreateClick} title="Create event">+</button>
      </div>
      <div className="events-list">
        {todayEvents.length === 0 ? (
          <p className="events-empty">No events today</p>
        ) : todayEvents.map(event => (
          <button
            key={event.id}
            className={`event-row${activeEventId === event.id ? ' active' : ''}`}
            onClick={() => onSelectEvent(event)}
          >
            <span className="event-row-title">
              {EVENT_ICONS[event.type] ?? '📌'} {event.title}
            </span>
            <span className="event-row-location">
              🕐 {getTimeLabel(event.starts_at, tz)}
              {event.location_hint && ` · 📍 ${event.location_hint}`}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
