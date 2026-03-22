export default function EventsSidebar({ events, activeEventId, onSelectEvent, onCreateClick }) {
  return (
    <aside className="events-sidebar">
      <div className="events-sidebar-header">
        <span className="events-sidebar-title">Events</span>
        <button className="create-event-btn" onClick={onCreateClick} title="Create event">+</button>
      </div>
      <div className="events-list">
        {events.length === 0 ? (
          <p className="events-empty">No events yet</p>
        ) : events.map(event => (
          <button
            key={event.id}
            className={`event-row${activeEventId === event.id ? ' active' : ''}`}
            onClick={() => onSelectEvent(event)}
          >
            <span className="event-row-title">{event.title}</span>
            {event.location_hint && (
              <span className="event-row-location">📍 {event.location_hint}</span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
