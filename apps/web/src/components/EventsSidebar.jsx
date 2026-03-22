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

export default function EventsSidebar({ events, activeEventId, cityTimezone, onSelectEvent, onCreateClick }) {
  const tz = cityTimezone || 'UTC'
  const todayEvents = events.filter(e => isToday(e.starts_at, tz))

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
              🕐 {formatTime(event.starts_at, tz)}
              {event.location_hint && ` · 📍 ${event.location_hint}`}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
