import { EVENT_ICONS } from '../cityMeta'
import { getEventStatus, getTimeLabel, getEventLocation } from '../eventUtils'

function isToday(unixTs, timezone) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const eventDay = new Date(unixTs * 1000).toLocaleDateString('en-CA', { timeZone: timezone })
  return today === eventDay
}

const STATUS_PRIORITY = { now: 0, soon: 1, scheduled: 2 }

function filterAndSort(events, tz) {
  return events
    .filter(e => isToday(e.starts_at, tz))
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[getEventStatus(a.starts_at)]
      const pb = STATUS_PRIORITY[getEventStatus(b.starts_at)]
      if (pa !== pb) return pa - pb
      return a.starts_at - b.starts_at
    })
}

const CATEGORY_ICONS = { general: '💬', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }

export default function EventsSidebar({ events, cityEvents, topics, activeEventId, cityTimezone, eventPresence, eventParticipants, onSelectEvent, onCreateClick, onCreateTopicClick }) {
  const tz = cityTimezone || 'UTC'
  const hiladsEvents = filterAndSort(events, tz)
  // City events: don't filter by today — TM events are upcoming (backend already prunes expired ones)
  const publicEvents = (cityEvents || []).sort((a, b) => a.starts_at - b.starts_at)
  const topicList   = topics || []
  const totalCount  = hiladsEvents.length + publicEvents.length + topicList.length

  function renderRow(event) {
    return (
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
          {eventPresence?.[event.id] > 0 && ` · 🔥 ${eventPresence[event.id]} here`}
          {eventParticipants?.[event.id] > 0 && ` · 🔥 ${eventParticipants[event.id]} going`}
          {event.recurrence_label && (
            <span className="recur-badge">↻ {event.recurrence_label}</span>
          )}
        </span>
        {getEventLocation(event) && (
          <span className="event-row-venue">📍 {getEventLocation(event)}</span>
        )}
      </button>
    )
  }

  function renderTopicRow(topic) {
    const icon    = CATEGORY_ICONS[topic.category] ?? '💬'
    const replies = topic.message_count ?? 0
    return (
      <div key={topic.id} className="event-row" style={{ cursor: 'default', borderColor: 'rgba(96,165,250,0.18)' }}>
        <span className="event-row-title">{icon} {topic.title}</span>
        <span className="event-row-location" style={{ color: '#60a5fa' }}>
          {replies > 0 ? `💬 ${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'No replies yet'}
        </span>
      </div>
    )
  }

  return (
    <aside className="events-sidebar">
      <div className="events-sidebar-header">
        <span className="events-sidebar-title">Now{totalCount > 0 ? ` (${totalCount})` : ''}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {onCreateTopicClick && (
            <button className="create-event-btn" onClick={onCreateTopicClick} title="Start a conversation" style={{ fontSize: 18 }}>💬</button>
          )}
          <button className="create-event-btn" onClick={onCreateClick} title="Create event">+</button>
        </div>
      </div>
      <div className="events-list">
        {topicList.length > 0 && (
          <>
            <p className="events-group-label">Conversations</p>
            {topicList.map(renderTopicRow)}
          </>
        )}
        <p className="events-group-label">Hilads Events</p>
        {hiladsEvents.length === 0
          ? <p className="events-empty">No events today</p>
          : hiladsEvents.map(renderRow)
        }
        {publicEvents.length > 0 && (
          <>
            <p className="events-group-label events-group-label--city">🎫 City Events</p>
            {publicEvents.map(renderRow)}
          </>
        )}
      </div>
    </aside>
  )
}
