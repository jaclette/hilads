import useAppPromotion from '../hooks/useAppPromotion'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

/**
 * Full-screen promo modal - gated OFF by default via appPromotion.interstitial.
 * The banner remains the primary surface; this is a louder variant we'll A/B
 * later. Mounted at App root behind the same hook.
 */
const PITCH_ROW = { display: 'flex', alignItems: 'center', gap: 10 }
const PITCH_ICON = { color: 'var(--primary-text)' }

export default function AppPromoInterstitial() {
  const { t } = useTranslation('common')
  const { shouldShowInterstitial, dismissInterstitial, trackCtaClick } = useAppPromotion()

  if (!shouldShowInterstitial) return null

  return (
    <div className="app-promo-interstitial-overlay" role="dialog" aria-modal="true" aria-label={t('appPromo.regionAndroid')}>
      <div className="app-promo-interstitial-card">
        <button
          type="button"
          className="app-promo-interstitial-skip-top"
          onClick={dismissInterstitial}
        >
          {t('appPromo.continueBrowser')}
        </button>

        <img className="app-promo-interstitial-icon" src="/logo/icon.svg" alt="" aria-hidden="true" />
        <h1 className="app-promo-interstitial-title">Play local. Compare global.</h1>

        <ul className="app-promo-interstitial-pitch">
          <li style={PITCH_ROW}><Icon name="notifications-outline" size={18} style={PITCH_ICON} />{t('appPromo.pitchPush')}</li>
          <li style={PITCH_ROW}><Icon name="flash-outline" size={18} style={PITCH_ICON} />{t('appPromo.pitchFast')}</li>
          <li style={PITCH_ROW}><Icon name="sparkles-outline" size={18} style={PITCH_ICON} />{t('appPromo.pitchAnim')}</li>
        </ul>

        <button
          type="button"
          className="app-promo-interstitial-cta"
          onClick={() => trackCtaClick('interstitial')}
        >
          {t('appPromo.ctaPlay')}
        </button>

        <button
          type="button"
          className="app-promo-interstitial-skip"
          onClick={dismissInterstitial}
        >
          {t('appPromo.continueBrowser')}
        </button>
      </div>
    </div>
  )
}
