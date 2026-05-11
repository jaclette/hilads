/**
 * Build a slug-style event URL path component from an event object.
 *
 *   eventSlug({ id: 'abc...', title: 'Công Cà Phê' }) → 'cong-ca-phe-abc...'
 *
 * The full 16-hex ID is always appended verbatim so any consumer can recover
 * the canonical ID with `extractEventHex(slug)`. Title-only slugs would need
 * uniqueness handling on the backend; appending the ID side-steps that
 * entirely without losing the keyword-in-URL SEO signal.
 *
 * Title is truncated at 60 chars to keep URLs reasonable in chat threads.
 */
export function eventSlug(event) {
  if (!event?.id) return ''
  const titleSlug = String(event.title || '')
    // NFD decomposes accented chars (ê → e + ◌̂) so we can strip combining
    // marks and end up with plain Latin slugs for Vietnamese / Spanish /
    // German titles. Without this step "Công Cà Phê" → "c-ng-c-ph" (broken).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return titleSlug ? `${titleSlug}-${event.id}` : event.id
}

/**
 * Extract the canonical 16-hex event ID from a slug URL path component.
 * Accepts either a bare hex ID or a slug ending in 16 hex chars.
 *
 *   extractEventHex('cong-ca-phe-2e617620a3f3b6f7') → '2e617620a3f3b6f7'
 *   extractEventHex('2e617620a3f3b6f7')             → '2e617620a3f3b6f7'
 *   extractEventHex('garbage')                      → null
 */
export function extractEventHex(input) {
  const m = String(input || '').match(/([a-f0-9]{16})$/i)
  return m ? m[1].toLowerCase() : null
}

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
