import { EVENT_ICONS } from '../cityMeta'
import { getEventStatus, getTimeLabel } from '../eventUtils'

function isToday(unixTs, timezone) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const eventDay = new Date(unixTs * 1000).toLocaleDateString('en-CA', { timeZone: timezone })
  return today === eventDay
}

const STATUS_PRIORITY = { now: 0, soon: 1, scheduled: 2 }

export default function EventsSidebar({ events, activeEventId, cityTimezone, eventPresence, onSelectEvent, onCreateClick }) {
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
              {getTimeLabel(event.starts_at, tz)}
              {event.location_hint && ` · 📍 ${event.location_hint}`}
              {eventPresence?.[event.id] > 0 && ` · ${eventPresence[event.id]} here`}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
