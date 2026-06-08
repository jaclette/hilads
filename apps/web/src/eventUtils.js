import i18n from './i18n'

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
  return new Date(unixTs * 1000).toLocaleTimeString(i18n.language || 'en', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
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

// Returns a Google Maps universal URL to open the venue. Prefers precise
// coordinates; falls back to a "venue name, address" text search. The universal
// URL opens the Google Maps app on mobile (universal link / intent) and a new
// tab on desktop.
export function getEventMapsUrl(event) {
  if (event.venue_lat && event.venue_lng) {
    return `https://www.google.com/maps/search/?api=1&query=${event.venue_lat},${event.venue_lng}`
  }
  const q = event.venue
    ? (event.location ? `${event.venue}, ${event.location}` : event.venue)
    : (event.location || event.location_hint)
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

// Day prefix for events outside today. Computed in the city's timezone so the
// day boundary matches the backend window.
//   compact (now feed): "" today / "Tomorrow · " / "{weekday} · "
//   full   (detail):    "Today · " / "Tomorrow · " / "{weekday}, {month} {day} · "
// Compact keeps today's feed cards clean; full spells out the date on the event
// detail so a one-shot's day is unambiguous however far out it is.
function eventDayPrefix(unixTs, timezone, full = false) {
  const opts = timezone ? { timeZone: timezone } : undefined
  const keyOf = (d) => d.toLocaleDateString('en-CA', opts)
  const todayKey = keyOf(new Date())
  const tomorrowKey = new Date(Date.parse(todayKey + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const startKey = keyOf(new Date(unixTs * 1000))
  if (startKey === todayKey)    return full ? `${i18n.t('time.today', { ns: 'common' })} · ` : ''
  if (startKey === tomorrowKey) return `${i18n.t('time.tomorrow', { ns: 'common' })} · `
  const fmt = full
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short' }
  const label = new Date(unixTs * 1000).toLocaleDateString(i18n.language || 'en', {
    ...fmt,
    ...(timezone ? { timeZone: timezone } : {}),
  })
  return `${label} · `
}

// `withDay` (now feed): compact day prefix on scheduled events.
// `withDate` (event detail, one-shot only): full date prefix so the day is clear.
// Other surfaces pass neither - they're single-event or already day-scoped.
export function getTimeLabel(unixTs, timezone, { withDay = false, withDate = false } = {}) {
  const status = getEventStatus(unixTs)
  if (status === 'now') return i18n.t('time.happeningNow', { ns: 'common' })
  if (status === 'soon') {
    const diffMin = (unixTs * 1000 - Date.now()) / 60000
    const rounded = Math.max(5, Math.round(diffMin / 5) * 5)
    return i18n.t('time.inMin', { ns: 'common', count: rounded })
  }
  const prefix = withDate ? eventDayPrefix(unixTs, timezone, true)
    : withDay ? eventDayPrefix(unixTs, timezone, false)
    : ''
  return `🕐 ${prefix}${formatTime(unixTs, timezone)}`
}
