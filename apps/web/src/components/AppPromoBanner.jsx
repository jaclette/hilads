import useAppPromotion from '../hooks/useAppPromotion'
import { useTranslation } from 'react-i18next'

/**
 * Thin top bar inviting Android/iOS visitors to install the native app.
 *
 * Renders only when the hook decides to (on a supported OS, not in-app, not
 * dismissed within cooldown, store URL present). On other platforms or after
 * dismissal this returns null and contributes zero DOM. CTA copy adapts to the
 * detected OS.
 */
export default function AppPromoBanner() {
  const { t } = useTranslation('common')
  const { shouldShowBanner, dismissBanner, trackCtaClick, os } = useAppPromotion()

  if (!shouldShowBanner) return null

  const ctaLabel    = os === 'ios' ? t('appPromo.ctaIos') : t('appPromo.ctaAndroid')
  const regionLabel = os === 'ios' ? t('appPromo.regionIos') : t('appPromo.regionAndroid')

  function handleCtaClick(e) {
    e.stopPropagation()
    trackCtaClick('banner')
  }

  function handleDismiss(e) {
    e.stopPropagation()
    dismissBanner()
  }

  return (
    <aside
      className="app-promo-banner"
      role="region"
      aria-label={regionLabel}
      onClick={() => trackCtaClick('banner')}
    >
      <img className="app-promo-icon" src="/logo/icon.svg" alt="" aria-hidden="true" />
      <span className="app-promo-text">{t('appPromo.text')}</span>
      <button
        type="button"
        className="app-promo-cta"
        onClick={handleCtaClick}
      >
        {ctaLabel}
      </button>
      <button
        type="button"
        className="app-promo-dismiss"
        aria-label={t('a11y.dismiss')}
        onClick={handleDismiss}
      >
        ×
      </button>
    </aside>
  )
}
