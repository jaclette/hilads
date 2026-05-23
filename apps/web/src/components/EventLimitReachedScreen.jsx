/**
 * EventLimitReachedScreen — friendly full-page surface shown when a
 * non-Legend user hits the 1-event-per-day cap. Replaces the red error
 * that used to sit inside CreateEventModal.
 *
 * Surfaces the event that's blocking (tap to view / edit / delete).
 *
 * Rendered conditionally by App.jsx (state flag `showEventLimitReached`).
 * Uses the same `.full-page` wrapper as other drawers so it inherits the
 * existing slide animation and mobile-first layout.
 */

import { useEffect, useState } from 'react'
import { fetchMyEvents } from '../api'
import { EVENT_ICONS } from '../cityMeta'
import { getTimeLabel, getEventLocation } from '../eventUtils'

export default function EventLimitReachedScreen({ onClose, guest, cityTimezone, onSelectEvent }) {
  const [showLegendInfo, setShowLegendInfo] = useState(false)
  const [blockingEvent,  setBlockingEvent]  = useState(null)

  // Fetch the user's "today" event — same semantics as the backend rule
  // (EventRepository::guestCreatedEventTodayCount).
  useEffect(() => {
    const guestId = guest?.guestId
    if (!guestId) return
    let cancelled = false
    fetchMyEvents(guestId)
      .then(({ events }) => {
        if (cancelled) return
        const todays = pickTodaysEvent(events ?? [], cityTimezone ?? 'UTC')
        setBlockingEvent(todays)
      })
      .catch(() => { /* non-fatal — keep the screen useful without the card */ })
    return () => { cancelled = true }
  }, [guest?.guestId, cityTimezone])

  function handleEventTap() {
    if (!blockingEvent) return
    onClose?.()
    onSelectEvent?.(blockingEvent)
  }

  return (
    <>
      <div className="full-page">
        <div className="page-header">
          <button
            type="button"
            className="back-button"
            onClick={onClose}
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <div className="limit-hero">
          <div className="limit-emoji" aria-hidden="true">🎉</div>
          <h1 className="limit-title">You've already created your event today!</h1>
          <p className="limit-body">
            At Hilads, we keep things fresh — one event per day so every plan
            gets the attention it deserves. Come back tomorrow to create
            another one.
          </p>

          {/* Blocking event — tap to open, edit, or delete. Reuses the same
              .city-row.event-row-card classes the NOW feed uses. */}
          {blockingEvent && (
            <button
              type="button"
              className="city-row event-row-card limit-event-card"
              onClick={handleEventTap}
            >
              <div className="er-header">
                <span className="er-title">
                  {EVENT_ICONS[blockingEvent.event_type ?? blockingEvent.type] ?? '📌'} {blockingEvent.title}
                </span>
                <span className="er-going er-going--event">Your event</span>
              </div>
              <div className="er-badges">
                <span className="city-row-current">
                  {getTimeLabel(blockingEvent.starts_at, cityTimezone ?? 'UTC')}
                </span>
              </div>
              {getEventLocation(blockingEvent) && (
                <span className="er-location">📍 {getEventLocation(blockingEvent)}</span>
              )}
            </button>
          )}

          <button
            type="button"
            className="limit-legend-link"
            onClick={() => setShowLegendInfo(true)}
          >
            👑 Become a Legend to create unlimited events
          </button>
        </div>

        <div className="limit-footer">
          <button
            type="button"
            className="limit-primary-btn"
            onClick={onClose}
          >
            Back to Now
          </button>
        </div>
      </div>

      {showLegendInfo && (
        <div className="limit-legend-modal" role="dialog" aria-modal="true">
          <div className="limit-legend-modal-card">
            <div className="limit-legend-modal-emoji" aria-hidden="true">👑</div>
            <h2 className="limit-legend-modal-title">Become a Legend</h2>
            <p className="limit-legend-modal-body">
              Legends are locals chosen to keep their city alive — they can
              host as many events as they want. Want to become one? Reach out
              at <a href="mailto:contact@hilads.live">contact@hilads.live</a>.
            </p>
            <button
              type="button"
              className="limit-legend-modal-btn"
              onClick={() => setShowLegendInfo(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// Mirrors apps/mobile/app/event/limit-reached.tsx pickTodaysEvent — same
// semantics as the backend rule: count the event as "today" if its creation
// lands on the current calendar day in the city's timezone.
function pickTodaysEvent(events, tz) {
  const today = formatYmdInTz(new Date(), tz)
  const mine = events
    .filter(e => e.source !== 'ticketmaster' && e.source_type !== 'ticketmaster')
    .filter(e => formatYmdInTz(new Date((e.created_at ?? e.starts_at) * 1000), tz) === today)
  if (mine.length === 0) return null
  return mine.reduce((a, b) =>
    (a.created_at ?? a.starts_at) > (b.created_at ?? b.starts_at) ? a : b,
  )
}

function formatYmdInTz(d, tz) {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}
