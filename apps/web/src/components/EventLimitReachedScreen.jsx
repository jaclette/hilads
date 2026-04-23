/**
 * EventLimitReachedScreen — friendly full-page surface shown when a
 * non-Legend user hits the 1-event-per-day cap. Replaces the red error
 * that used to sit inside CreateEventModal.
 *
 * Rendered conditionally by App.jsx (state flag `showEventLimitReached`).
 * Uses the same `.full-page` wrapper as other drawers so it inherits the
 * existing slide animation and mobile-first layout.
 */

import { useState } from 'react'

export default function EventLimitReachedScreen({ onClose }) {
  const [showLegendInfo, setShowLegendInfo] = useState(false)

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
              at <a href="mailto:hello@hilads.live">hello@hilads.live</a>.
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
