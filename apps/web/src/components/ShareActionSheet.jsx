/**
 * ShareActionSheet - bottom sheet for share actions in chat composers.
 *
 * Actions:
 *   Snap the vibe     → onSnap() - triggers file input in parent
 *   Drop where you at → onSpot() - geolocation + send location message
 *   Create a plan     → onPlan() - city Chat only (W3: plans are created here, as in the app)
 *   Hi now            → onHiNow() - city Chat only
 * Icons match the app's ShareSheet (camera / location / calendar / hand-left).
 */

import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import { useBackLayer } from '../lib/backLayers'

export default function ShareActionSheet({ onSnap, onSpot, onPlan, onHiNow, onClose, spotLoading }) {
  useBackLayer(true, onClose)   // browser back closes it
  const { t } = useTranslation('common')
  return (
    <>
      <div className="share-sheet-overlay" onClick={onClose} />
      <div className="share-sheet">
        <p className="share-sheet-title">{t('share.title')}</p>
        <div className="share-sheet-actions">
          <button className="share-sheet-action" onClick={onSnap} disabled={spotLoading}>
            <span className="share-sheet-action-icon" style={{ color: 'var(--primary-text)' }}><Icon name="camera-outline" size={26} /></span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">{t('share.snap')}</span>
              <span className="share-sheet-action-desc">{t('share.snapDesc')}</span>
            </div>
          </button>
          <button className="share-sheet-action" onClick={onSpot} disabled={spotLoading}>
            <span className="share-sheet-action-icon" style={{ color: 'var(--primary-text)' }}>
              {spotLoading ? <span className="share-sheet-spinner" /> : <Icon name="location-outline" size={26} />}
            </span>
            <div className="share-sheet-action-body">
              <span className="share-sheet-action-label">{t('share.spot')}</span>
              <span className="share-sheet-action-desc">
                {spotLoading ? t('share.spotLoading') : t('share.spotDesc')}
              </span>
            </div>
          </button>
          {onPlan && (
            <button className="share-sheet-action" onClick={onPlan} disabled={spotLoading}>
              <span className="share-sheet-action-icon" style={{ color: 'var(--primary-text)' }}><Icon name="calendar-outline" size={26} /></span>
              <div className="share-sheet-action-body">
                <span className="share-sheet-action-label">{t('share.plan')}</span>
                <span className="share-sheet-action-desc">{t('share.planDesc')}</span>
              </div>
            </button>
          )}
          {onHiNow && (
            <button className="share-sheet-action" onClick={onHiNow} disabled={spotLoading}>
              <span className="share-sheet-action-icon" style={{ color: 'var(--primary-text)' }}><Icon name="hand-left-outline" size={26} /></span>
              <div className="share-sheet-action-body">
                <span className="share-sheet-action-label">{t('share.hiNow')}</span>
                <span className="share-sheet-action-desc">{t('share.hiNowDesc')}</span>
              </div>
            </button>
          )}
        </div>
        <button className="share-sheet-cancel" onClick={onClose}>{t('cancel')}</button>
      </div>
    </>
  )
}
