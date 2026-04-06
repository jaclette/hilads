/**
 * ShareActionSheet — bottom sheet for share actions in chat composers.
 *
 * Actions:
 *   📸 Snap the vibe     → onSnap() — triggers file input in parent
 *   📍 Drop where you at → onSpot() — geolocation + send location message
 */

export default function ShareActionSheet({ onSnap, onSpot, onClose, spotLoading }) {
  return (
    <>
      <div className="share-sheet-overlay" onClick={onClose} />
      <div className="share-sheet">
        <p className="share-sheet-title">Share something 👀</p>
        <div className="share-sheet-actions">
          <button className="share-sheet-action" onClick={onSnap} disabled={spotLoading}>
            <span className="share-sheet-action-icon">📸</span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">Snap a photo</span>
              <span className="share-sheet-action-desc">Take or upload a photo</span>
            </div>
          </button>
          <button className="share-sheet-action" onClick={onSpot} disabled={spotLoading}>
            <span className="share-sheet-action-icon">
              {spotLoading ? <span className="share-sheet-spinner" /> : '📍'}
            </span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">Drop your spot</span>
              <span className="share-sheet-action-desc">
                {spotLoading ? 'Getting your location…' : 'Share your current spot'}
              </span>
            </div>
          </button>
        </div>
        <button className="share-sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </>
  )
}
