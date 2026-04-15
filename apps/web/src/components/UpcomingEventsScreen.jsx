import { useState, useEffect } from 'react'
import BackButton from './BackButton'
import { fetchUpcomingEvents } from '../api'
import { formatTime, getEventLocation, getEventStatus } from '../eventUtils'

const EVENT_ICONS = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
}


function getDayLabel(unixTs, tz) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })

  const todayParts = formatter.formatToParts(new Date())
  const eventParts = formatter.formatToParts(new Date(unixTs * 1000))

  const toKey = parts => {
    const m = {}
    parts.forEach(p => { m[p.type] = p.value })
    return `${m.year}-${m.month}-${m.day}`
  }

  const todayKey = toKey(todayParts)
  const eventKey = toKey(eventParts)

  if (eventKey === todayKey) return 'Today'

  const todayDate = new Date(todayKey)
  const eventDate = new Date(eventKey)
  const diff = Math.round((eventDate - todayDate) / 86400000)
  if (diff === 1) return 'Tomorrow'

  return new Date(unixTs * 1000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'short', day: 'numeric',
  })
}

function groupByDay(events, tz) {
  const groups = []
  const seen = {}
  for (const event of events) {
    const label = getDayLabel(event.starts_at, tz)
    if (!(label in seen)) {
      seen[label] = groups.length
      groups.push({ label, events: [] })
    }
    groups[seen[label]].events.push(event)
  }
  return groups
}

export default function UpcomingEventsScreen({ channelId, timezone, onBack, onSelectEvent }) {
  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    setStatus('loading')
    fetchUpcomingEvents(channelId)
      .then(data => { setEvents(data.events ?? []); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [channelId])

  const tz = timezone || 'UTC'
  const now = Date.now() / 1000
  const groups = groupByDay(events, tz)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Next 7 days</span>
      </div>

      <div className="page-body">
        {status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <div className="loading-spinner" />
          </div>
        )}

        {status === 'error' && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">Couldn&apos;t load upcoming events</p>
            <button
              className="events-empty-cta"
              onClick={() => {
                setStatus('loading')
                fetchUpcomingEvents(channelId)
                  .then(data => { setEvents(data.events ?? []); setStatus('ok') })
                  .catch(() => setStatus('error'))
              }}
            >
              Retry
            </button>
          </div>
        )}

        {status === 'ok' && events.length === 0 && (
          <div className="events-empty-state" style={{ marginTop: 40 }}>
            <p className="events-empty-title">Nothing planned yet</p>
            <p className="events-empty-sub">Check back soon — the week is just getting started.</p>
          </div>
        )}

        {status === 'ok' && groups.map(group => (
          <div key={group.label}>
            <p className={`events-group-label${group.label === 'Today' ? '' : ' events-group-label--day'}`}
               style={{ padding: '14px 12px 4px' }}>
              {group.label}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px' }}>
              {group.events.map(event => {
                const isLive = event.starts_at <= now && event.expires_at > now
                const isPublic = event.source === 'ticketmaster'
                const location = getEventLocation(event)
                const icon = EVENT_ICONS[event.type] ?? '📌'
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
          </div>
        ))}
      </div>
    </div>
  )
}
