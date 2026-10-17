import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import { APP_STORE, PLAY_STORE, deviceStore } from './map/spotsShared'
import Icon from './Icon'

/**
 * "See the spots on the map" (SPEC 9.10, web with 1.8.0): where the web used to
 * offer challenge creation, it now opens the web map of spots, with the app
 * stores below (proofs are posted from the app). A phone sees its own store;
 * desktop sees both.
 */
export default function AppMapCard({ city, placement, compact = false, onOpenMap }) {
  const { t } = useTranslation('challenge')
  const store = deviceStore()
  const stores = store ? [store] : ['ios', 'android']
  const click = (s) => track('web_app_map_card_clicked', { store: s, placement })
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
        {stores.map(s => (
          <a key={s} className={`amc-store${onOpenMap ? ' amc-store--ghost' : ''}`} href={s === 'ios' ? APP_STORE : PLAY_STORE}
             target="_blank" rel="noopener noreferrer" onClick={() => click(s)}>
            {s === 'ios' ? 'App Store' : 'Google Play'}
          </a>
        ))}
      </div>
    </div>
  )
}
