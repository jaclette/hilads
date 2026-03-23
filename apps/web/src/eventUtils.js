export function formatTime(unixTs, timezone) {
  return new Date(unixTs * 1000).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function getEventStatus(unixTs) {
  const diffMin = (unixTs * 1000 - Date.now()) / 60000
  if (diffMin >= -30 && diffMin <= 15) return 'now'
  if (diffMin > 15 && diffMin <= 60) return 'soon'
  return 'scheduled'
}

// Returns a human-readable location string for any event type.
// TM events have venue + location (city); hilads events have location_hint.
export function getEventLocation(event) {
  if (event.venue && event.location) return `${event.venue} · ${event.location}`
  if (event.venue) return event.venue
  if (event.location) return event.location
  if (event.location_hint) return event.location_hint
  return null
}

// Returns a maps URL to open the venue. Prefers precise coordinates, falls back to text search.
export function getEventMapsUrl(event) {
  if (event.venue_lat && event.venue_lng) {
    return `https://maps.google.com/?q=${event.venue_lat},${event.venue_lng}`
  }
  const q = event.venue
    ? (event.location ? `${event.venue}, ${event.location}` : event.venue)
    : (event.location || event.location_hint)
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : null
}

export function getTimeLabel(unixTs, timezone) {
  const status = getEventStatus(unixTs)
  if (status === 'now') return '🔥 happening now'
  if (status === 'soon') {
    const diffMin = (unixTs * 1000 - Date.now()) / 60000
    const rounded = Math.max(5, Math.round(diffMin / 5) * 5)
    return `🔥 in ${rounded} min`
  }
  return `🕐 ${formatTime(unixTs, timezone)}`
}
