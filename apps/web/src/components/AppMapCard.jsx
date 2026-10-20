import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import { deviceStore } from './map/spotsShared'
import { openAppModal } from './AppModal'
import Icon from './Icon'

/**
 * "See the spots on the map" (SPEC 9.10, web with 1.8.0): where the web used to
 * offer challenge creation, it now opens the web map of spots, with "Download
 * the app" below (photos are posted from the app), through the app modal.
 */
export default function AppMapCard({ city, placement, compact = false, onOpenMap }) {
  const { t } = useTranslation('challenge')
  const store = deviceStore()
  const click = () => { track('web_app_map_card_clicked', { store: store ?? 'desktop', placement }); openAppModal({ action: 'play', city, surface: `map_card_${placement}` }) }
  const openMap = () => { track('web_app_map_card_clicked', { store: 'web_map', placement }); onOpenMap?.() }

  return (
    <div className={`app-map-card${compact ? ' app-map-card--compact' : ''}`}>
      {!compact && <span className="amc-icon" aria-hidden="true" style={{ color: 'var(--primary-text)' }}><Icon name="map-outline" size={30} /></span>}
      <p className="amc-title">{city ? t('appMap.titleCity', { city }) : t('appMap.title')}</p>
      {!compact && <p className="amc-body">{t('appMap.body')}</p>}
      {onOpenMap && (
        <button type="button" className="amc-store amc-map" onClick={openMap}>{t('map.see')}</button>
      )}
      <div className="amc-stores">
        <button type="button" className={`amc-store${onOpenMap ? ' amc-store--ghost' : ''}`} onClick={click}>
          {t('appModal.download', { ns: 'common' })}
        </button>
      </div>
    </div>
  )
}
