/**
 * ShareActionSheet - bottom sheet for share actions in chat composers.
 *
 * Actions:
 *   📸 Snap the vibe     → onSnap() - triggers file input in parent
 *   📍 Drop where you at → onSpot() - geolocation + send location message
 */

import { useTranslation } from 'react-i18next'

export default function ShareActionSheet({ onSnap, onSpot, onClose, spotLoading }) {
  const { t } = useTranslation('common')
  return (
    <>
      <div className="share-sheet-overlay" onClick={onClose} />
      <div className="share-sheet">
        <p className="share-sheet-title">{t('share.title')}</p>
        <div className="share-sheet-actions">
          <button className="share-sheet-action" onClick={onSnap} disabled={spotLoading}>
            <span className="share-sheet-action-icon">📸</span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">{t('share.snap')}</span>
              <span className="share-sheet-action-desc">{t('share.snapDesc')}</span>
            </div>
          </button>
          <button className="share-sheet-action" onClick={onSpot} disabled={spotLoading}>
            <span className="share-sheet-action-icon">
              {spotLoading ? <span className="share-sheet-spinner" /> : '📍'}
            </span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">{t('share.spot')}</span>
              <span className="share-sheet-action-desc">
                {spotLoading ? t('share.spotLoading') : t('share.spotDesc')}
              </span>
            </div>
          </button>
        </div>
        <button className="share-sheet-cancel" onClick={onClose}>{t('cancel')}</button>
      </div>
    </>
  )
}
